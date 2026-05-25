package com.examportal.attempt;

import com.examportal.exam.Exam;
import com.examportal.exam.ExamService;
import com.examportal.exam.ExamStatus;
import com.examportal.question.Question;
import com.examportal.question.QuestionDTO;
import com.examportal.question.QuestionService;
import com.examportal.user.User;
import com.examportal.user.UserService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

/**
 * AttemptService
 * CHANGE: buildSession() now reads masterSectionMap from the Exam to build
 *   section groupings keyed by sectionName instead of subjectName.
 *   This supports multi-subject sections and removes subject-name exposure
 *   from the exam UI.
 */
@Service
@RequiredArgsConstructor
public class AttemptService {

    private final AttemptRepository attemptRepository;
    private final ExamService examService;
    private final QuestionService questionService;
    private final UserService userService;
    private final ObjectMapper objectMapper;

    @Value("${exam.proctor.max-violations:3}")
    private int maxViolations;

    @Transactional
    public ExamSessionDTO startExam(Long examId, String studentEmail) {
        Exam exam = examService.getEntity(examId);
        User student = userService.findByEmail(studentEmail);
        validateExamActive(exam);

        Optional<ExamAttempt> existing = attemptRepository.findByStudentIdAndExamId(student.getId(), examId);
        if (existing.isPresent()) {
            ExamAttempt attempt = existing.get();
            if (attempt.getStatus() == AttemptStatus.SUBMITTED
                    || attempt.getStatus() == AttemptStatus.AUTO_SUBMITTED
                    || attempt.getStatus() == AttemptStatus.EVALUATED) {
                throw new IllegalStateException("You have already submitted this exam");
            }
            return buildSession(attempt, exam);
        }

        List<Long> masterIds = examService.getMasterQuestionIds(exam);
        List<Long> shuffledIds = new ArrayList<>(masterIds);
        Collections.shuffle(shuffledIds);

        Map<String, Map<Integer, Integer>> optionOrderMap = new HashMap<>();
        boolean shuffleOptions = exam.getBlueprint() == null || Boolean.TRUE.equals(exam.getBlueprint().getOptionShuffle());
        for (Long qId : shuffledIds) {
            Question q = questionService.getEntityById(qId);
            List<Integer> indices = IntStream.range(0, q.getOptions().size()).boxed().collect(Collectors.toList());
            if (shuffleOptions) {
                Collections.shuffle(indices);
            }
            Map<Integer, Integer> mapping = new HashMap<>();
            for (int displayIndex = 0; displayIndex < indices.size(); displayIndex++) {
                mapping.put(displayIndex, indices.get(displayIndex));
            }
            optionOrderMap.put(String.valueOf(qId), mapping);
        }

        Optional<ExamAttempt> retry = attemptRepository.findByStudentIdAndExamId(student.getId(), examId);
        if (retry.isPresent()) return buildSession(retry.get(), exam);

        ExamAttempt attempt;
        try {
            attempt = ExamAttempt.builder()
                    .student(student).exam(exam)
                    .status(AttemptStatus.IN_PROGRESS)
                    .questionOrder(objectMapper.writeValueAsString(shuffledIds))
                    .optionOrder(objectMapper.writeValueAsString(optionOrderMap))
                    .serverStartTime(LocalDateTime.now())
                    .build();
            attempt = attemptRepository.save(attempt);
        } catch (Exception e) {
            Optional<ExamAttempt> existingAttempt = attemptRepository.findByStudentIdAndExamId(student.getId(), examId);
            if (existingAttempt.isPresent()) {
                attempt = existingAttempt.get();
            } else {
                throw new IllegalStateException("Failed to initialize exam session");
            }
        }
        return buildSession(attempt, exam);
    }

    @Transactional
    public Map<String, String> saveAnswers(Long attemptId, SaveAnswerRequest request, String studentEmail) {
        ExamAttempt attempt = getAttemptForStudent(attemptId, studentEmail);
        // Race-condition hardening:
        // If proctoring has just set AUTO_SUBMITTED, allow one final save flush from
        // the frontend so the latest selected answer is not lost before evaluation.
        // Do not allow saves after explicit SUBMITTED/EVALUATED terminal states.
        if (attempt.getStatus() == AttemptStatus.SUBMITTED
                || attempt.getStatus() == AttemptStatus.EVALUATED) {
            return Map.of("status", "ALREADY_SUBMITTED", "message", "Exam already submitted");
        }

        Map<String, Integer> incomingAnswers = request.getAnswers() == null
                ? new HashMap<>()
                : request.getAnswers();

        LocalDateTime now = LocalDateTime.now();
        long elapsed = ChronoUnit.SECONDS.between(attempt.getServerStartTime(), now);
        long examRemaining = ChronoUnit.SECONDS.between(now, attempt.getExam().getScheduledEnd());
        long allowed = Math.min(attempt.getExam().getDurationMinutes() * 60L, examRemaining) + 30L;
        if (elapsed > allowed) {
            try {
                // Persist latest client state before forced timeout submit.
                attempt.setAnswers(objectMapper.writeValueAsString(incomingAnswers));
                if (request.getMarkedForReview() != null) {
                    attempt.setMarkedForReview(objectMapper.writeValueAsString(request.getMarkedForReview()));
                }
            } catch (Exception ignored) {
                // Keep timeout auto-submit robust even if serialization fails.
            }
            attempt.setStatus(AttemptStatus.AUTO_SUBMITTED);
            attempt.setSubmittedAt(LocalDateTime.now());
            attemptRepository.save(attempt);
            return Map.of("status", "AUTO_SUBMITTED", "message", "Time expired. Exam auto-submitted.");
        }
        try {
            // Request carries the full latest answer map from client.
            // Replace stored answers so changed and cleared responses are both persisted.
            attempt.setAnswers(objectMapper.writeValueAsString(incomingAnswers));
            if (request.getMarkedForReview() != null) {
                attempt.setMarkedForReview(objectMapper.writeValueAsString(request.getMarkedForReview()));
            }
            attemptRepository.save(attempt);
            return Map.of("status", "SAVED", "message", "Answers saved successfully");
        } catch (Exception e) {
            throw new IllegalStateException("Failed to save answers");
        }
    }

    @Transactional
    public void submitExam(Long attemptId, String studentEmail) {
        ExamAttempt attempt = getAttemptForStudent(attemptId, studentEmail);
        if (attempt.getStatus() == AttemptStatus.SUBMITTED
                || attempt.getStatus() == AttemptStatus.AUTO_SUBMITTED
                || attempt.getStatus() == AttemptStatus.EVALUATED) {
            return;
        }
        attempt.setStatus(AttemptStatus.SUBMITTED);
        attempt.setSubmittedAt(LocalDateTime.now());
        attemptRepository.save(attempt);
    }

    public ExamAttempt findById(Long id) {
        return attemptRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Attempt not found: " + id));
    }

    public List<ExamAttempt> findByStudent(String studentEmail) {
        User student = userService.findByEmail(studentEmail);
        return attemptRepository.findByStudentId(student.getId());
    }

    private void validateExamActive(Exam exam) {
        if (exam.getStatus() != ExamStatus.PUBLISHED)
            throw new IllegalStateException("This exam is not currently active");
        LocalDateTime now = LocalDateTime.now();
        if (now.isBefore(exam.getScheduledStart())) throw new IllegalStateException("Exam has not started yet");
        if (now.isAfter(exam.getScheduledEnd())) throw new IllegalStateException("Exam has ended");
    }

    private ExamAttempt getAttemptForStudent(Long attemptId, String studentEmail) {
        ExamAttempt attempt = findById(attemptId);
        User student = userService.findByEmail(studentEmail);
        if (!attempt.getStudent().getId().equals(student.getId()))
            throw new IllegalArgumentException("Access denied to this attempt");
        return attempt;
    }

    /**
     * CHANGE: buildSession now builds sections from masterSectionMap.
     *
     * masterSectionMap = { "Section 1 – MCQ": [42, 17, 88, ...], "Section 2": [...] }
     * After per-student question shuffle, we map each question to its section by
     * checking which section in masterSectionMap contains that question ID.
     * This keeps section structure even after shuffle reordering.
     *
     * If masterSectionMap is absent (legacy exam), falls back to a single section.
     * Subject name is no longer included in QuestionDTO sent to students.
     */
    private ExamSessionDTO buildSession(ExamAttempt attempt, Exam exam) {
        try {
            List<Long> qOrder = objectMapper.readValue(attempt.getQuestionOrder(),
                    new TypeReference<List<Long>>() {});
            Map<String, Map<Integer, Integer>> optOrder = objectMapper.readValue(attempt.getOptionOrder(),
                    new TypeReference<Map<String, Map<Integer, Integer>>>() {});
            Map<String, Integer> savedAnswers = attempt.getAnswers() == null ? new HashMap<>()
                    : objectMapper.readValue(attempt.getAnswers(), new TypeReference<Map<String, Integer>>() {});
            List<Long> markedIds = attempt.getMarkedForReview() == null ? new ArrayList<>()
                    : objectMapper.readValue(attempt.getMarkedForReview(), new TypeReference<List<Long>>() {});

            // CHANGE: Build reverse lookup — questionId -> sectionName from masterSectionMap
            Map<Long, String> questionToSection = new LinkedHashMap<>();
            List<String> sectionOrder = new ArrayList<>();
            Map<String, List<Long>> masterSectionMap = examService.getMasterSectionMap(exam);

            if (!masterSectionMap.isEmpty()) {
                for (Map.Entry<String, List<Long>> e : masterSectionMap.entrySet()) {
                    sectionOrder.add(e.getKey());
                    for (Long qId : e.getValue()) {
                        questionToSection.put(qId, e.getKey());
                    }
                }
            }

            List<QuestionDTO> questions = new ArrayList<>();
            Map<String, List<Integer>> sections = new LinkedHashMap<>();

            for (Long qId : qOrder) {
                Question question = questionService.getEntityById(qId);
                // CHANGE: hide correct answer AND subject name from exam session
                QuestionDTO qDto = questionService.toDTO(question, false);
                // Clear subject name so it is NOT sent to the frontend
                qDto.setSubjectName(null);

                // Apply option shuffle
                Map<Integer, Integer> shuffle = optOrder.get(String.valueOf(qId));
                List<String> original = qDto.getOptions();
                List<String> shuffled = new ArrayList<>(Collections.nCopies(original.size(), ""));
                for (Map.Entry<Integer, Integer> entry : shuffle.entrySet()) {
                    shuffled.set(entry.getKey(), original.get(entry.getValue()));
                }
                qDto.setOptions(shuffled);

                // CHANGE: group by section name, not subject name
                String sectionName = questionToSection.getOrDefault(qId, "Questions");
                if (!sections.containsKey(sectionName)) {
                    sections.put(sectionName, new ArrayList<>());
                    if (!sectionOrder.contains(sectionName)) sectionOrder.add(sectionName);
                }
                sections.get(sectionName).add(questions.size());
                questions.add(qDto);
            }

            LocalDateTime now = LocalDateTime.now();
            long elapsed = ChronoUnit.SECONDS.between(attempt.getServerStartTime(), now);
            long examRemaining = ChronoUnit.SECONDS.between(now, exam.getScheduledEnd());
            long remaining = Math.max(0, Math.min(exam.getDurationMinutes() * 60L - elapsed, examRemaining));

            return ExamSessionDTO.builder()
                    .attemptId(attempt.getId())
                    .examId(exam.getId())
                    .examTitle(exam.getTitle())
                    .durationMinutes(exam.getDurationMinutes())
                    .serverStartTime(attempt.getServerStartTime())
                    .timeRemainingSeconds(remaining)
                    .questions(questions)
                    .sections(sections)
                    .sectionOrder(sectionOrder)
                    .savedAnswers(savedAnswers)
                    .markedForReview(markedIds)
                    .status(attempt.getStatus())
                    .build();

        } catch (Exception e) {
            throw new IllegalStateException("Failed to build exam session: " + e.getMessage());
        }
    }
}
