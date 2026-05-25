package com.examportal.reporting;

import com.examportal.common.ApiResponse;
import com.examportal.common.FeatureDisabledException;
import com.examportal.evaluation.EvaluationResult;
import com.examportal.evaluation.EvaluationService;
import com.examportal.user.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

/**
 * ReportController - PDF download endpoint.
 * GET /api/reports/result/{attemptId} - Download result as PDF.
 * Returns 503 when features.pdf=false.
 */
@RestController
@RequestMapping("/reports")
@RequiredArgsConstructor
public class ReportController {

    private final ReportService reportService;
    private final EvaluationService evaluationService;
    private final UserService userService;

    @GetMapping("/result/{attemptId}")
    @PreAuthorize("hasAnyRole('STUDENT', 'ADMIN')")
    public ResponseEntity<?> downloadResult(
            @PathVariable Long attemptId,
            @AuthenticationPrincipal UserDetails userDetails) {
        try {
            EvaluationResult result = evaluationService.findByAttemptId(attemptId);
            assertStudentOwnsAttemptIfStudent(result, userDetails);
            byte[] pdfBytes = reportService.generateResultPdf(attemptId);
            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=result_" + attemptId + ".pdf")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes);
        } catch (FeatureDisabledException e) {
            return ResponseEntity.status(503).body(ApiResponse.error(e.getMessage()));
        }
    }

    private void assertStudentOwnsAttemptIfStudent(EvaluationResult result, UserDetails userDetails) {
        if (userDetails == null) return;

        boolean isStudent = userDetails.getAuthorities().stream()
                .anyMatch(a -> "ROLE_STUDENT".equals(a.getAuthority()));
        if (!isStudent) return;

        com.examportal.user.User student = userService.findByEmail(userDetails.getUsername());
        if (!student.getId().equals(result.getStudentId())) {
            throw new AccessDeniedException("You can only access your own result");
        }
    }
}
