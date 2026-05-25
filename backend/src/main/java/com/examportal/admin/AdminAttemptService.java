package com.examportal.admin;

import com.examportal.attempt.AttemptRepository;
import com.examportal.attempt.ExamAttempt;
import com.examportal.evaluation.EvaluationRepository;
import com.examportal.proctor.ViolationLogRepository;
import com.examportal.user.User;
import com.examportal.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

@Service
@RequiredArgsConstructor
public class AdminAttemptService {

    private final AttemptRepository attemptRepository;
    private final EvaluationRepository evaluationRepository;
    private final ViolationLogRepository violationLogRepository;
    private final UserRepository userRepository;

    @Transactional
    public Map<String, Object> deleteAttempt(Long attemptId, String enrollmentNo, String email, Long examId) {
        ExamAttempt attempt = resolveAttempt(attemptId, enrollmentNo, email, examId);

        Long resolvedAttemptId = attempt.getId();
        Long studentId = attempt.getStudent().getId();
        Long resolvedExamId = attempt.getExam().getId();

        long deletedResults = evaluationRepository.deleteByAttemptId(resolvedAttemptId);
        long deletedViolations = violationLogRepository.deleteByAttemptId(resolvedAttemptId);
        attemptRepository.deleteById(resolvedAttemptId);

        return Map.of(
                "attemptId", resolvedAttemptId,
                "studentId", studentId,
                "examId", resolvedExamId,
                "deletedResults", deletedResults,
                "deletedViolations", deletedViolations
        );
    }

    private ExamAttempt resolveAttempt(Long attemptId, String enrollmentNo, String email, Long examId) {
        if (attemptId != null) {
            return attemptRepository.findById(attemptId)
                    .orElseThrow(() -> new IllegalArgumentException("Attempt not found: " + attemptId));
        }

        String normalizedEnrollment = trimToNull(enrollmentNo);
        String normalizedEmail = trimToNull(email);

        if (examId == null) {
            throw new IllegalArgumentException("examId is required when attemptId is not provided");
        }
        if (normalizedEnrollment == null && normalizedEmail == null) {
            throw new IllegalArgumentException("enrollmentNo or email is required when attemptId is not provided");
        }

        User student = normalizedEnrollment != null
                ? userRepository.findByEnrollmentNo(normalizedEnrollment)
                    .orElseThrow(() -> new IllegalArgumentException("Student not found for enrollment: " + normalizedEnrollment))
                : userRepository.findByEmail(normalizedEmail)
                    .orElseThrow(() -> new IllegalArgumentException("Student not found for email: " + normalizedEmail));

        return attemptRepository.findByStudentIdAndExamId(student.getId(), examId)
                .orElseThrow(() -> new IllegalArgumentException("Attempt not found for student and exam"));
    }

    private String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
