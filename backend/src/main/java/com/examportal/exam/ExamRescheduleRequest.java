package com.examportal.exam;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ExamRescheduleRequest {
    @NotNull
    private LocalDateTime scheduledStart;

    @NotNull
    private LocalDateTime scheduledEnd;
}