package com.examportal.exam;

import com.examportal.common.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/exams")
@RequiredArgsConstructor
public class ExamController {

    private final ExamService examService;

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<ExamDTO>> createExam(@Valid @RequestBody ExamDTO dto) {

        return ResponseEntity.ok(
                ApiResponse.success("Exam created", examService.create(dto))
        );
    }

    @PostMapping("/{id}/publish")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<ExamDTO>> publishExam(@PathVariable Long id) {

        return ResponseEntity.ok(
                ApiResponse.success("Exam published", examService.publish(id))
        );
    }

    @PostMapping("/{id}/cancel")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<ExamDTO>> cancelExam(@PathVariable Long id) {

        return ResponseEntity.ok(
                ApiResponse.success("Exam cancelled", examService.cancel(id))
        );
    }

    @PostMapping("/{id}/reschedule")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<ExamDTO>> rescheduleExam(
            @PathVariable Long id,
            @Valid @RequestBody ExamRescheduleRequest request) {

        return ResponseEntity.ok(
                ApiResponse.success("Exam rescheduled",
                        examService.reschedule(id, request.getScheduledStart(), request.getScheduledEnd()))
        );
    }

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<List<ExamDTO>>> getAll() {

        return ResponseEntity.ok(
                ApiResponse.success(examService.findAll())
        );
    }
    @GetMapping("/upcoming")
    public ResponseEntity<ApiResponse<List<ExamDTO>>> getUpcoming() {

        return ResponseEntity.ok(
                ApiResponse.success(examService.findUpcomingExams())
        );
    }
    @GetMapping("/active")
    public ResponseEntity<ApiResponse<List<ExamDTO>>> getActive() {

        return ResponseEntity.ok(
                ApiResponse.success(examService.findActiveExams())
        );
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<ExamDTO>> getById(@PathVariable Long id) {

        return ResponseEntity.ok(
                ApiResponse.success(examService.findById(id))
        );
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<Map<String, Object>>> deleteExam(@PathVariable Long id) {

        return ResponseEntity.ok(
                ApiResponse.success("Exam deleted", examService.deleteExam(id))
        );
    }
}