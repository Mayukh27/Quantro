package com.examportal.exam;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.List;

/**
 * ExamBlueprint - Defines exam structure: subject-wise question count and duration.
 * One blueprint may be reused across multiple exams.
 * When an exam is published, the engine draws questions according to this blueprint.
 */
@Entity
@Table(name = "exam_blueprints")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ExamBlueprint {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    private String description;

    @OneToMany(cascade = CascadeType.ALL, fetch = FetchType.EAGER, orphanRemoval = true)
    @JoinColumn(name = "blueprint_id")
    private List<BlueprintEntry> entries;

    @Column(nullable = false)
    private Integer durationMinutes;

    private Integer totalMarks;

    @Builder.Default
    private Boolean optionShuffle = true;

    @Column(updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() { createdAt = LocalDateTime.now(); }
}
