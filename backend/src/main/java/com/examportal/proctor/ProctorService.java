package com.examportal.proctor;

import com.examportal.attempt.AttemptRepository;
import com.examportal.attempt.AttemptStatus;
import com.examportal.attempt.ExamAttempt;
import com.examportal.common.FeatureDisabledException;
import com.examportal.config.FeatureFlags;
import com.examportal.user.User;
import com.examportal.user.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * ProctorService — reviewed and extended proctoring enforcement.
 *
 * VIOLATION CATEGORIES (reviewed):
 *
 * Category A — Hard violations → increment violationCount → auto-submit at threshold:
 *   TAB_SWITCH, WINDOW_BLUR, COPY_PASTE, CONTEXT_MENU, KEYBOARD_SHORTCUT,
 *   MOUSE_LEAVE, DEVTOOLS_OPEN
 *
 * Category B — Fullscreen exit → increment fullscreenExitCount (separate counter):
 *   FULLSCREEN_EXIT — shows warning modal with grace countdown; auto-submits at
 *   max-fullscreen-exits threshold (default 3)
 *
 * Design rationale for MOUSE_LEAVE:
 *   Mouse leaving the window is a strong signal the student is looking at another
 *   screen. Logged as a hard violation since it indicates active distraction.
 *
 * Design rationale for DEVTOOLS_OPEN:
 *   Developer tools opened during an exam is a strong indicator of cheating.
 *   Treated as a hard violation.
 */
@Service
@RequiredArgsConstructor
public class ProctorService {

    private final ViolationLogRepository violationLogRepository;
    private final AttemptRepository attemptRepository;
    private final FeatureFlags featureFlags;
    private final UserService userService;

    @Value("${exam.proctor.max-violations:3}")
    private int maxViolations;

    @Value("${exam.proctor.max-fullscreen-exits:3}")
    private int maxFullscreenExits;

    @Value("${exam.proctor.fullscreen-grace-seconds:10}")
    private int fullscreenGraceSeconds;

    /** All violation types treated as hard violations (violationCount++) */
    private static final Set<ViolationType> HARD_VIOLATIONS = Set.of(
        ViolationType.TAB_SWITCH,
        ViolationType.WINDOW_BLUR,
        //ViolationType.COPY_PASTE,
        //ViolationType.CONTEXT_MENU,
        ViolationType.KEYBOARD_SHORTCUT,
        //ViolationType.MOUSE_LEAVE, [DISABLED]
        ViolationType.DEVTOOLS_OPEN
    );

    @Transactional
    public Map<String, Object> logViolation(ViolationRequest request, String studentEmail) {
        if (!featureFlags.isProctor()) throw new FeatureDisabledException("proctor");

        User student = userService.findByEmail(studentEmail);
        ExamAttempt attempt = attemptRepository.findById(request.getAttemptId())
            .orElseThrow(() -> new IllegalArgumentException("Attempt not found"));

        if (!attempt.getStudent().getId().equals(student.getId())) {
            throw new IllegalArgumentException("Access denied");
        }
        if (attempt.getStatus() != AttemptStatus.IN_PROGRESS) {
            return Map.of(
                "status", "ALREADY_SUBMITTED",
                "violationCount", attempt.getViolationCount(),
                "fullscreenExitCount", attempt.getFullscreenExitCount()
            );
        }

        // Always log for audit trail regardless of category
        violationLogRepository.save(ViolationLog.builder()
            .attemptId(attempt.getId())
            .studentId(student.getId())
            .violationType(request.getViolationType())
            .details(request.getDetails())
            .build());

        if (request.getViolationType() == ViolationType.FULLSCREEN_EXIT) {
            return handleFullscreenExit(attempt);
        } else {
            return handleHardViolation(attempt, request.getViolationType());
        }
    }

    private Map<String, Object> handleFullscreenExit(ExamAttempt attempt) {
        attempt.setFullscreenExitCount(attempt.getFullscreenExitCount() + 1);
        int exitsRemaining = Math.max(0, maxFullscreenExits - attempt.getFullscreenExitCount());
        boolean autoSubmitted = attempt.getFullscreenExitCount() >= maxFullscreenExits;
        if (autoSubmitted) attempt.setStatus(AttemptStatus.AUTO_SUBMITTED);
        attemptRepository.save(attempt);

        return Map.of(
            "violationType", "FULLSCREEN_EXIT",
            "fullscreenExitCount", attempt.getFullscreenExitCount(),
            "maxFullscreenExits", maxFullscreenExits,
            "exitsRemaining", exitsRemaining,
            "autoSubmitted", autoSubmitted,
            "graceSeconds", autoSubmitted ? 0 : fullscreenGraceSeconds,
            "message", autoSubmitted
                ? "Exam auto-submitted: maximum fullscreen exits exceeded."
                : "Warning: Please return to fullscreen. " + exitsRemaining + " exit(s) remaining."
        );
    }

    private Map<String, Object> handleHardViolation(ExamAttempt attempt, ViolationType type) {
        attempt.setViolationCount(attempt.getViolationCount() + 1);
        boolean autoSubmitted = attempt.getViolationCount() >= maxViolations;
        if (autoSubmitted) attempt.setStatus(AttemptStatus.AUTO_SUBMITTED);
        attemptRepository.save(attempt);

        return Map.of(
            "violationType", type.name(),
            "violationCount", attempt.getViolationCount(),
            "maxViolations", maxViolations,
            "autoSubmitted", autoSubmitted,
            "warningsRemaining", Math.max(0, maxViolations - attempt.getViolationCount()),
            "graceSeconds", 0
        );
    }

    public ProctorStateDTO getState(Long attemptId, String studentEmail) {
        if (!featureFlags.isProctor()) throw new FeatureDisabledException("proctor");

        User student = userService.findByEmail(studentEmail);
        ExamAttempt attempt = attemptRepository.findById(attemptId)
            .orElseThrow(() -> new IllegalArgumentException("Attempt not found: " + attemptId));

        if (!attempt.getStudent().getId().equals(student.getId())) {
            throw new IllegalArgumentException("Access denied");
        }

        return ProctorStateDTO.builder()
            .attemptId(attemptId)
            .fullscreenExitCount(attempt.getFullscreenExitCount())
            .maxFullscreenExits(maxFullscreenExits)
            .fullscreenWarningsLeft(Math.max(0, maxFullscreenExits - attempt.getFullscreenExitCount()))
            .violationCount(attempt.getViolationCount())
            .maxViolations(maxViolations)
            .autoSubmitted(attempt.getStatus() == AttemptStatus.AUTO_SUBMITTED)
            .requiresFullscreen(true)
            .build();
    }

    public List<ViolationLog> getViolationsForAttempt(Long attemptId) {
        return violationLogRepository.findByAttemptId(attemptId);
    }
}
