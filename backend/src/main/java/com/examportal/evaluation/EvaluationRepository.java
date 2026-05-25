package com.examportal.evaluation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface EvaluationRepository extends JpaRepository<EvaluationResult, Long> {
    Optional<EvaluationResult> findByAttemptId(Long attemptId);
    long deleteByAttemptId(Long attemptId);
    long deleteByExamId(Long examId);
    List<EvaluationResult> findByStudentId(Long studentId);
    List<EvaluationResult> findByExamId(Long examId);

    /** CHANGE: All evaluated results for a given exam, newest first */
    @Query("SELECT r FROM EvaluationResult r WHERE r.examId = :examId ORDER BY r.totalScore DESC")
    List<EvaluationResult> findByExamIdOrderByScoreDesc(Long examId);

    /** CHANGE: All evaluated results for a student across all exams */
    @Query("SELECT r FROM EvaluationResult r WHERE r.studentId = :studentId ORDER BY r.evaluatedAt DESC")
    List<EvaluationResult> findByStudentIdOrderByDateDesc(Long studentId);
}
