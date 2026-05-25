package com.examportal.evaluation;

import com.examportal.attempt.AttemptRepository;
import com.examportal.attempt.AttemptStatus;
import com.examportal.attempt.ExamAttempt;
import com.examportal.exam.Exam;
import com.examportal.exam.ExamRepository;
import com.examportal.proctor.ViolationLog;
import com.examportal.proctor.ViolationLogRepository;
import com.examportal.question.Question;
import com.examportal.question.QuestionService;
import com.examportal.user.User;
import com.examportal.user.UserRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.util.*;
import java.util.stream.Collectors;

/**
 * EvaluationService
 * CHANGE: Added getExamResultsForAdmin() — builds ExamResultDetailDTO list for
 *         Admin/Teacher results table including violation logs per student.
 */
@Service
@RequiredArgsConstructor
public class EvaluationService {

    private final AttemptRepository attemptRepository;
    private final EvaluationRepository evaluationRepository;
    private final QuestionService questionService;
    private final ViolationLogRepository violationLogRepository;
    private final UserRepository userRepository;
    private final ExamRepository examRepository;
    private final ObjectMapper objectMapper;

    /**
     * Evaluate all SUBMITTED/AUTO_SUBMITTED attempts for an exam.
     * NOT @Transactional at the method level — each evaluate() call is independent
     * so locks don't accumulate and block concurrent saveAnswers() calls from IN_PROGRESS students.
     * This prevents the "evaluating while exam is on doesn't accept answers" issue.
     */
    public int evaluateExam(Long examId) {
        List<ExamAttempt> attempts = attemptRepository.findByExamId(examId);
        int evaluatedCount = 0;

        for (ExamAttempt attempt : attempts) {
            if (attempt.getSubmittedAt() != null
                    && (attempt.getStatus() == AttemptStatus.SUBMITTED
                    || attempt.getStatus() == AttemptStatus.AUTO_SUBMITTED)
                    && evaluationRepository.findByAttemptId(attempt.getId()).isEmpty()) {
                try {
                    evaluate(attempt);
                    evaluatedCount++;
                } catch (Exception e) {
                    // Log and continue so one failed evaluation doesn't block others
                    System.err.println("Evaluation failed for attempt " + attempt.getId() + ": " + e.getMessage());
                }
            }
        }

        return evaluatedCount;
    }

    @Transactional
    public EvaluationResult evaluate(ExamAttempt attempt) {
        Optional<EvaluationResult> existing = evaluationRepository.findByAttemptId(attempt.getId());
        if (existing.isPresent()) return existing.get();

        try {
            List<Long> qOrder = objectMapper.readValue(attempt.getQuestionOrder(), new TypeReference<List<Long>>() {});
            Map<String, Map<Integer,Integer>> optOrder = objectMapper.readValue(attempt.getOptionOrder(), new TypeReference<Map<String, Map<Integer,Integer>>>() {});
            Map<String, Integer> answers = attempt.getAnswers() == null ? new HashMap<>()
                : objectMapper.readValue(attempt.getAnswers(), new TypeReference<Map<String, Integer>>() {});

            int correct = 0, wrong = 0, unattempted = 0;
            double totalScore = 0;
            Map<String, SubjectBreakdown> bdMap = new LinkedHashMap<>();

            for (Long qId : qOrder) {
                Question q = questionService.getEntityById(qId);
                String subjectName = q.getSubject().getName();
                bdMap.putIfAbsent(subjectName, new SubjectBreakdown());
                SubjectBreakdown bd = bdMap.get(subjectName);
                bd.total++;

                Integer studentShuffled = answers.get(String.valueOf(qId));
                if (studentShuffled == null || studentShuffled == -1) {
                    unattempted++; bd.unattempted++; continue;
                }

                Map<Integer,Integer> shuffle = optOrder.get(String.valueOf(qId));
                if (shuffle == null || !shuffle.containsKey(studentShuffled)) {
                    throw new IllegalStateException("Invalid shuffle mapping for question " + qId);
                }
                int originalIndex = shuffle.get(studentShuffled);

                if (originalIndex == q.getCorrectOptionIndex()) {
                    correct++; bd.correct++;
                    totalScore += q.getMarks(); bd.score += q.getMarks();
                } else {
                    wrong++; bd.wrong++;
                    totalScore -= q.getNegativeMarks(); bd.score -= q.getNegativeMarks();
                }
            }

            Map<String, Object> breakdownJson = new LinkedHashMap<>();
            bdMap.forEach((subject, bd) -> {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("correct", bd.correct);
                entry.put("wrong", bd.wrong);
                entry.put("unattempted", bd.unattempted);
                entry.put("score", bd.score);
                entry.put("total", bd.total);
                breakdownJson.put(subject, entry);
            });

            EvaluationResult result = EvaluationResult.builder()
                .attemptId(attempt.getId())
                .studentId(attempt.getStudent().getId())
                .examId(attempt.getExam().getId())
                .totalScore(Math.max(0, totalScore))
                .totalQuestions(qOrder.size())
                .attempted(correct + wrong)
                .correct(correct).wrong(wrong).unattempted(unattempted)
                .subjectWiseBreakdown(objectMapper.writeValueAsString(breakdownJson))
                .build();

            attempt.setStatus(AttemptStatus.EVALUATED);
            attempt.setScore(result.getTotalScore());
            attemptRepository.save(attempt);

            return evaluationRepository.save(result);
        } catch (Exception e) {
            throw new IllegalStateException("Evaluation error: " + e.getMessage());
        }
    }

    public EvaluationResult findByAttemptId(Long attemptId) {
        return evaluationRepository.findByAttemptId(attemptId)
            .orElseThrow(() -> new IllegalArgumentException("Result not yet available for attempt: " + attemptId));
    }

    public List<EvaluationResult> findByStudent(Long studentId) {
        return evaluationRepository.findByStudentId(studentId);
    }

    /**
     * CHANGE: Build full result detail list for Admin/Teacher results table.
     * Returns all students who attempted a given exam, with subject-wise breakdown
     * and complete violation log per student.
     * Used by GET /api/results/exam/{examId}/students
     */
    public List<ExamResultDetailDTO> getExamResultsForAdmin(Long examId) {
        List<EvaluationResult> results = evaluationRepository.findByExamIdOrderByScoreDesc(examId);
        Exam exam = examRepository.findById(examId)
            .orElseThrow(() -> new IllegalArgumentException("Exam not found: " + examId));

        return results.stream().map(r -> {
            User student = userRepository.findById(r.getStudentId()).orElse(null);
            ExamAttempt attempt = attemptRepository.findById(r.getAttemptId()).orElse(null);

            Map<String, Object> breakdown = new LinkedHashMap<>();
            try {
                if (r.getSubjectWiseBreakdown() != null) {
                    breakdown = objectMapper.readValue(r.getSubjectWiseBreakdown(), new TypeReference<Map<String, Object>>() {});
                }
            } catch (Exception e) { /* ignore parse error */ }

            List<ViolationLog> violations = violationLogRepository.findByAttemptId(r.getAttemptId());
            List<ExamResultDetailDTO.ViolationLogDTO> violationDTOs = violations.stream()
                .map(v -> ExamResultDetailDTO.ViolationLogDTO.builder()
                    .violationType(v.getViolationType() != null ? v.getViolationType().name() : "UNKNOWN")
                    .details(v.getDetails())
                    .occurredAt(v.getOccurredAt())
                    .build())
                .collect(Collectors.toList());

            return ExamResultDetailDTO.builder()
                .attemptId(r.getAttemptId())
                .studentId(r.getStudentId())
                .studentName(student != null ? student.getFullName() : "Unknown")
                .studentEmail(student != null ? student.getEmail() : "")
                .studentStream(student != null ? student.getStream() : null)
                .studentSection(student != null ? student.getSection() : null)
                .studentYear(student != null ? student.getStudentYear() : null)
                .examId(examId)
                .examTitle(exam.getTitle())
                .totalScore(r.getTotalScore())
                .totalQuestions(r.getTotalQuestions())
                .correct(r.getCorrect())
                .wrong(r.getWrong())
                .unattempted(r.getUnattempted())
                .attempted(r.getAttempted())
                .subjectWiseBreakdown(breakdown)
                .violations(violationDTOs)
                .violationCount(attempt != null ? attempt.getViolationCount() : 0)
                .fullscreenExitCount(attempt != null ? attempt.getFullscreenExitCount() : 0)
                .submittedAt(attempt != null ? attempt.getSubmittedAt() : null)
                .evaluatedAt(r.getEvaluatedAt())
                .status(attempt != null ? attempt.getStatus().name() : "EVALUATED")
                .build();
        }).collect(Collectors.toList());
    }

    public byte[] downloadExamResultsExcel(Long examId) {
        List<ExamResultDetailDTO> rows = getExamResultsForAdmin(examId);

        try (Workbook wb = new XSSFWorkbook(); ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Detailed Results");

            Row header = sheet.createRow(0);
            String[] cols = {
                "Rank",
                "Student Name",
                "Enrollment Number",
                "Stream",
                "Section",
                "Year",
                "Exam Title",
                "Total Score",
                "Total Questions",
                "Attempted",
                "Correct",
                "Wrong",
                "Unattempted",
                "Hard Violations",
                "Fullscreen Exits",
                "Submitted At",
                "Evaluated At",
                "Subject Breakdown",
                "Violation Details"
            };
            for (int i = 0; i < cols.length; i++) {
                header.createCell(i).setCellValue(cols[i]);
            }

            int rowIndex = 1;
            for (int i = 0; i < rows.size(); i++) {
                ExamResultDetailDTO r = rows.get(i);
                Row row = sheet.createRow(rowIndex++);

                row.createCell(0).setCellValue(i + 1);
                row.createCell(1).setCellValue(nullSafe(r.getStudentName()));
                row.createCell(2).setCellValue(nullSafe(r.getStudentId() != null ? r.getStudentId().toString() : ""));
                row.createCell(3).setCellValue(nullSafe(r.getStudentStream()));
                row.createCell(4).setCellValue(nullSafe(r.getStudentSection()));
                row.createCell(5).setCellValue(nullSafe(r.getStudentYear()));
                row.createCell(6).setCellValue(nullSafe(r.getStudentEmail()));
                row.createCell(7).setCellValue(nullSafe(r.getExamTitle()));
                row.createCell(8).setCellValue(r.getTotalScore() != null ? r.getTotalScore() : 0.0);
                row.createCell(9).setCellValue(r.getTotalQuestions() != null ? r.getTotalQuestions() : 0);
                row.createCell(10).setCellValue(r.getAttempted() != null ? r.getAttempted() : 0);
                row.createCell(11).setCellValue(r.getCorrect() != null ? r.getCorrect() : 0);
                row.createCell(12).setCellValue(r.getWrong() != null ? r.getWrong() : 0);
                row.createCell(13).setCellValue(r.getUnattempted() != null ? r.getUnattempted() : 0);
                row.createCell(14).setCellValue(r.getViolationCount() != null ? r.getViolationCount() : 0);
                row.createCell(15).setCellValue(r.getFullscreenExitCount() != null ? r.getFullscreenExitCount() : 0);
                row.createCell(16).setCellValue(r.getSubmittedAt() != null ? r.getSubmittedAt().toString() : "");
                row.createCell(17).setCellValue(r.getEvaluatedAt() != null ? r.getEvaluatedAt().toString() : "");
                row.createCell(18).setCellValue(safeJson(r.getSubjectWiseBreakdown()));
                row.createCell(19).setCellValue(violationSummary(r.getViolations()));
            }

            for (int i = 0; i < cols.length; i++) {
                sheet.autoSizeColumn(i);
            }

            wb.write(bos);
            return bos.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to generate detailed results Excel: " + e.getMessage());
        }
    }

    private String safeJson(Object value) {
        if (value == null) return "";
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    private String violationSummary(List<ExamResultDetailDTO.ViolationLogDTO> violations) {
        if (violations == null || violations.isEmpty()) return "";
        return violations.stream()
                .map(v -> {
                    String t = v.getViolationType() != null ? v.getViolationType() : "UNKNOWN";
                    String d = v.getDetails() != null ? v.getDetails() : "";
                    String at = v.getOccurredAt() != null ? v.getOccurredAt().toString() : "";
                    return t + (d.isBlank() ? "" : (": " + d)) + (at.isBlank() ? "" : (" @" + at));
                })
                .collect(Collectors.joining(" | "));
    }

    private String nullSafe(String value) {
        return value != null ? value : "";
    }

    private static class SubjectBreakdown {
        int correct = 0, wrong = 0, unattempted = 0, total = 0;
        double score = 0;
    }
}
