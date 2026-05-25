package com.examportal.attempt;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface AttemptRepository extends JpaRepository<ExamAttempt, Long> {
    Optional<ExamAttempt> findByStudentIdAndExamId(Long studentId, Long examId);
    List<ExamAttempt> findByStudentId(Long studentId);
    List<ExamAttempt> findByExamId(Long examId);
    boolean existsByStudentIdAndExamId(Long studentId, Long examId);
    long countByExamId(Long examId);

    @Modifying
    @Query("DELETE FROM ExamAttempt a WHERE a.exam.id = :examId")
    int deleteByExamId(Long examId);
}
