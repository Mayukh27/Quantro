package com.examportal.proctor;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ViolationLogRepository extends JpaRepository<ViolationLog, Long> {
    List<ViolationLog> findByAttemptId(Long attemptId);
    long deleteByAttemptId(Long attemptId);
    long countByAttemptId(Long attemptId);

    @Modifying
    @Query("DELETE FROM ViolationLog v WHERE v.attemptId IN (SELECT a.id FROM ExamAttempt a WHERE a.exam.id = :examId)")
    int deleteByExamId(Long examId);
}
