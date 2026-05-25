package com.examportal.exam;

import com.examportal.attempt.AttemptRepository;
import com.examportal.common.FeatureDisabledException;
import com.examportal.config.FeatureFlags;
import com.examportal.evaluation.EvaluationRepository;
import com.examportal.proctor.ViolationLogRepository;
import com.examportal.prefetch.ImagePrefetchService;
import com.examportal.question.Question;
import com.examportal.question.QuestionService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ExamService {

    private final ExamRepository examRepository;
    private final BlueprintRepository blueprintRepository;
    private final QuestionService questionService;
    private final AttemptRepository attemptRepository;
    private final EvaluationRepository evaluationRepository;
    private final ViolationLogRepository violationLogRepository;
    private final FeatureFlags featureFlags;
    private final ObjectMapper objectMapper;
    private final ImagePrefetchService imagePrefetchService;

    public ExamDTO create(ExamDTO dto) {
        if (!featureFlags.isBlueprint()) throw new FeatureDisabledException("blueprint");
        ExamBlueprint blueprint = blueprintRepository.findById(dto.getBlueprintId())
                .orElseThrow(() -> new IllegalArgumentException("Blueprint not found: " + dto.getBlueprintId()));
        Exam exam = Exam.builder()
                .title(dto.getTitle())
                .description(dto.getDescription())
                .blueprint(blueprint)
                .scheduledStart(dto.getScheduledStart())
                .scheduledEnd(dto.getScheduledEnd())
                .durationMinutes(dto.getDurationMinutes() != null
                        ? dto.getDurationMinutes() : blueprint.getDurationMinutes())
                .build();
        return toDTO(examRepository.save(exam));
    }

    public BlueprintDTO createBlueprint(BlueprintDTO dto) {
        if (!featureFlags.isBlueprint()) throw new FeatureDisabledException("blueprint");
        List<BlueprintEntry> entries = toBlueprintEntries(dto.getEntries());
        int totalMarks = calculateTotalMarks(entries);

        ExamBlueprint blueprint = ExamBlueprint.builder()
                .name(dto.getName())
                .description(dto.getDescription())
                .durationMinutes(dto.getDurationMinutes())
                .totalMarks(totalMarks)
                .optionShuffle(dto.getOptionShuffle() == null || dto.getOptionShuffle())
                .entries(entries)
                .build();
        blueprint = blueprintRepository.save(blueprint);
        return toBlueprintDTO(blueprint);
    }

    @Transactional
    public BlueprintDTO updateBlueprint(Long blueprintId, BlueprintDTO dto) {
        if (!featureFlags.isBlueprint()) throw new FeatureDisabledException("blueprint");
        ExamBlueprint blueprint = blueprintRepository.findById(blueprintId)
                .orElseThrow(() -> new IllegalArgumentException("Blueprint not found: " + blueprintId));

        assertBlueprintEditable(blueprintId);

        List<BlueprintEntry> entries = toBlueprintEntries(dto.getEntries());
        int totalMarks = calculateTotalMarks(entries);

        blueprint.setName(dto.getName());
        blueprint.setDescription(dto.getDescription());
        blueprint.setDurationMinutes(dto.getDurationMinutes());
        blueprint.setTotalMarks(totalMarks);
        blueprint.setOptionShuffle(dto.getOptionShuffle() == null || dto.getOptionShuffle());

        if (blueprint.getEntries() == null) {
            blueprint.setEntries(new ArrayList<>());
        }
        blueprint.getEntries().clear();
        blueprint.getEntries().addAll(entries);

        return toBlueprintDTO(blueprintRepository.save(blueprint));
    }

    public List<BlueprintDTO> getAllBlueprints() {
        return blueprintRepository.findAll().stream().map(this::toBlueprintDTO).toList();
    }

    @Transactional
    public void deleteBlueprint(Long blueprintId) {
        ExamBlueprint blueprint = blueprintRepository.findById(blueprintId)
                .orElseThrow(() -> new IllegalArgumentException("Blueprint not found: " + blueprintId));
        List<Exam> using = examRepository.findByBlueprintId(blueprintId);
        if (!using.isEmpty()) {
            throw new IllegalStateException(
                    "Cannot delete blueprint: " + using.size() + " exam(s) reference it.");
        }
        blueprintRepository.delete(blueprint);
    }

    private void assertBlueprintEditable(Long blueprintId) {
        List<Exam> using = examRepository.findByBlueprintId(blueprintId);
        if (using.isEmpty()) return;
        boolean hasLocked = using.stream()
                .anyMatch(e -> e.getStatus() != ExamStatus.DRAFT && e.getStatus() != ExamStatus.CANCELLED);
        if (hasLocked) {
            throw new IllegalStateException("Cannot edit blueprint: published or completed exams reference it.");
        }
    }

    private List<BlueprintEntry> toBlueprintEntries(List<BlueprintEntryDTO> entries) {
        if (entries == null || entries.isEmpty()) {
            throw new IllegalArgumentException("Blueprint must contain at least one entry");
        }
        return new ArrayList<>(entries.stream()
                .map(e -> BlueprintEntry.builder()
                        .subjectId(e.getSubjectId())
                        .sectionName(e.getSectionName())
                        .subjectIds(String.valueOf(e.getSubjectId()))
                        .questionCount(e.getQuestionCount())
                        .marksPerQuestion(e.getMarksPerQuestion() != null ? e.getMarksPerQuestion() : 1)
                        .negativeMarks(e.getNegativeMarks() != null ? e.getNegativeMarks() : 0.25)
                        .build())
            .toList());
    }

        private int calculateTotalMarks(List<BlueprintEntry> entries) {
        return entries.stream()
                .mapToInt(e -> (e.getQuestionCount() != null ? e.getQuestionCount() : 0)
                        * (e.getMarksPerQuestion() != null ? e.getMarksPerQuestion() : 0))
                .sum();
    }

    /**
     * Publish: draw random questions from each entry's subject.
     * masterSectionMap groups question IDs by section name (if provided).
     * If no entry has a sectionName, masterSectionMap will be empty and
     * the exam UI shows a flat question list.
     */
    @Transactional
    public ExamDTO publish(Long examId) {
        Exam exam = getEntity(examId);
        if (exam.getStatus() != ExamStatus.DRAFT)
            throw new IllegalStateException("Only DRAFT exams can be published");
        if (exam.getScheduledStart().isAfter(exam.getScheduledEnd()))
            throw new IllegalStateException("Start time must be before end time");

        List<Long> allMasterIds = new ArrayList<>();
        Map<String, List<Long>> sectionMap = new LinkedHashMap<>();

        for (BlueprintEntry entry : exam.getBlueprint().getEntries()) {
            Integer marksPerQuestion = entry.getMarksPerQuestion() != null ? entry.getMarksPerQuestion() : 1;
            Double negativeMarks = entry.getNegativeMarks() != null ? entry.getNegativeMarks() : 0.25;

            List<Question> selected = questionService.fetchRandom(
                entry.getSubjectId(),
                entry.getQuestionCount(),
                marksPerQuestion,
                negativeMarks
            );
            if (selected.size() < entry.getQuestionCount()) {
            String sectionLabel = entry.getSectionName() != null && !entry.getSectionName().isBlank()
                ? entry.getSectionName()
                : "(no section)";
                throw new IllegalStateException(
                        "Insufficient questions for subject ID " + entry.getSubjectId() +
                    " in section " + sectionLabel +
                    " with marks=" + marksPerQuestion +
                    " and negativeMarks=" + negativeMarks +
                                ". Required: " + entry.getQuestionCount() +
                                ", Available: " + selected.size());
            }
            List<Long> ids = selected.stream().map(Question::getId).collect(Collectors.toList());
            allMasterIds.addAll(ids);

            // Only build section map if this entry has a non-blank sectionName
            String sec = entry.getSectionName();
            if (sec != null && !sec.isBlank()) {
                sectionMap.computeIfAbsent(sec, k -> new ArrayList<>()).addAll(ids);
            }
        }

        try {
            exam.setMasterQuestionIds(objectMapper.writeValueAsString(allMasterIds));
            exam.setMasterSectionMap(objectMapper.writeValueAsString(sectionMap));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize question list");
        }

        exam.setStatus(ExamStatus.PUBLISHED);
        Exam saved = examRepository.save(exam);

        // Warm nginx cache for all images belonging to the published exam.
        imagePrefetchService.prefetchExamImagesAsync(saved.getId(), allMasterIds);

        return toDTO(saved);
    }

    @Transactional
    public ExamDTO cancel(Long examId) {
        Exam exam = getEntity(examId);
        if (exam.getStatus() != ExamStatus.PUBLISHED) {
            throw new IllegalStateException("Only PUBLISHED exams can be cancelled");
        }
        exam.setStatus(ExamStatus.CANCELLED);
        return toDTO(examRepository.save(exam));
    }

    @Transactional
    public ExamDTO reschedule(Long examId, LocalDateTime start, LocalDateTime end) {
        Exam exam = getEntity(examId);
        if (exam.getStatus() != ExamStatus.PUBLISHED) {
            throw new IllegalStateException("Only PUBLISHED exams can be rescheduled");
        }
        if (start == null || end == null) {
            throw new IllegalArgumentException("Start and end time are required");
        }
        if (start.isAfter(end)) {
            throw new IllegalArgumentException("Start time must be before end time");
        }
        exam.setScheduledStart(start);
        exam.setScheduledEnd(end);
        return toDTO(examRepository.save(exam));
    }

    public List<ExamDTO> findActiveExams() {
        return examRepository.findActiveExams(LocalDateTime.now())
                .stream().map(this::toDTO).collect(Collectors.toList());
    }

    public List<ExamDTO> findUpcomingExams() {
        return examRepository.findUpcomingExams(LocalDateTime.now())
                .stream().map(this::toDTO).collect(Collectors.toList());
    }

    public List<ExamDTO> findAll() {
        return examRepository.findAll().stream().map(this::toDTO).collect(Collectors.toList());
    }

    public ExamDTO findById(Long id) { return toDTO(getEntity(id)); }

    @Transactional
    public Map<String, Object> deleteExam(Long examId) {
        Exam exam = getEntity(examId);
        if (exam.getStatus() == ExamStatus.PUBLISHED) {
            LocalDateTime now = LocalDateTime.now();
            if (!now.isBefore(exam.getScheduledStart()) && !now.isAfter(exam.getScheduledEnd())) {
                throw new IllegalStateException("Cannot delete an active exam. Cancel it first.");
            }
        }

        int deletedViolations = violationLogRepository.deleteByExamId(examId);
        long deletedResults = evaluationRepository.deleteByExamId(examId);
        int deletedAttempts = attemptRepository.deleteByExamId(examId);
        examRepository.deleteById(examId);

        return Map.of(
                "examId", examId,
                "deletedAttempts", deletedAttempts,
                "deletedResults", deletedResults,
                "deletedViolations", deletedViolations
        );
    }

    public Exam getEntity(Long id) {
        return examRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Exam not found: " + id));
    }

    public List<Long> getMasterQuestionIds(Exam exam) {
        try {
            List<Long> ids = objectMapper.readValue(
                    exam.getMasterQuestionIds(), new TypeReference<List<Long>>() {});
            Collections.shuffle(ids);
            return ids;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse master question list for exam: " + exam.getId());
        }
    }

    public Map<String, List<Long>> getMasterSectionMap(Exam exam) {
        try {
            if (exam.getMasterSectionMap() == null || exam.getMasterSectionMap().isBlank())
                return Map.of();
            return objectMapper.readValue(exam.getMasterSectionMap(),
                    new TypeReference<LinkedHashMap<String, List<Long>>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    @Scheduled(fixedDelay = 60000)
    @Transactional
    public void expireFinishedExams() {
        List<Exam> expired = examRepository.findExpiredExams(LocalDateTime.now().minusSeconds(30));
        expired.forEach(e -> e.setStatus(ExamStatus.COMPLETED));
        if (!expired.isEmpty()) examRepository.saveAll(expired);
    }

    private ExamDTO toDTO(Exam e) {
        return ExamDTO.builder()
                .id(e.getId()).title(e.getTitle()).description(e.getDescription())
                .blueprintId(e.getBlueprint() != null ? e.getBlueprint().getId() : null)
                .status(e.getStatus()).scheduledStart(e.getScheduledStart())
                .scheduledEnd(e.getScheduledEnd()).durationMinutes(e.getDurationMinutes())
                .build();
    }

    private BlueprintDTO toBlueprintDTO(ExamBlueprint b) {
        List<BlueprintEntryDTO> entries = b.getEntries().stream()
                .map(e -> BlueprintEntryDTO.builder()
                        .subjectId(e.getSubjectId())
                        .sectionName(e.getSectionName())
                        .questionCount(e.getQuestionCount())
                        .marksPerQuestion(e.getMarksPerQuestion())
                        .negativeMarks(e.getNegativeMarks())
                        .build())
                .toList();
        return BlueprintDTO.builder()
                .id(b.getId()).name(b.getName()).description(b.getDescription())
            .durationMinutes(b.getDurationMinutes()).totalMarks(b.getTotalMarks())
                .optionShuffle(Boolean.TRUE.equals(b.getOptionShuffle()))
                .entries(entries).build();
    }
}