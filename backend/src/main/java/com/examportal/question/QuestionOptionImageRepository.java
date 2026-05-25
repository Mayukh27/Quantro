package com.examportal.question;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface QuestionOptionImageRepository extends JpaRepository<QuestionOptionImage, Long> {

    List<QuestionOptionImage> findByQuestionIdOrderByOptionIndex(Long questionId);

    @Query("SELECT i.optionIndex FROM QuestionOptionImage i WHERE i.question.id = :questionId ORDER BY i.optionIndex")
    List<Integer> findOptionIndexes(Long questionId);

    @Modifying
    @Transactional
    @Query("DELETE FROM QuestionOptionImage i WHERE i.question.id = :questionId")
    void deleteByQuestionId(Long questionId);
}