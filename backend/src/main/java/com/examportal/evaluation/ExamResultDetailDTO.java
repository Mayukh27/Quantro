package com.examportal.evaluation;

import com.examportal.proctor.ViolationLog;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * ExamResultDetailDTO
 * Returned by GET /api/results/exam/{examId}/students
 * Contains all per-student result data including violations.
 * Used for the Admin/Teacher "View Results" table with expandable rows.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ExamResultDetailDTO {
    private Long attemptId;
    private Long studentId;
    private String studentName;
    private String studentEmail;
    private String studentStream;
    private String studentSection;
    private String studentYear;
    private Long examId;
    private String examTitle;
    private Double totalScore;
    private Integer totalQuestions;
    private Integer correct;
    private Integer wrong;
    private Integer unattempted;
    private Integer attempted;
    /** subjectName -> { correct, wrong, unattempted, score, total } */
    private Map<String, Object> subjectWiseBreakdown;
    /** All violation events logged for this attempt */
    private List<ViolationLogDTO> violations;
    private Integer violationCount;
    private Integer fullscreenExitCount;
    private LocalDateTime submittedAt;
    private LocalDateTime evaluatedAt;
    private String status;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ViolationLogDTO {
        private String violationType;
        private String details;
        private LocalDateTime occurredAt;
    }
}
