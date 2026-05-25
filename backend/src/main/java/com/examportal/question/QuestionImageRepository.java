package com.examportal.question;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface QuestionImageRepository extends JpaRepository<QuestionImage, Long> {
    Optional<QuestionImage> findByQuestionId(Long questionId);

    @Query("SELECT (qi.questionImage IS NOT NULL) FROM QuestionImage qi WHERE qi.question.id = :questionId")
    Boolean hasQuestionImage(Long questionId);

    @Query("SELECT (qi.combinedOptionImage IS NOT NULL) FROM QuestionImage qi WHERE qi.question.id = :questionId")
    Boolean hasCombinedOptionImage(Long questionId);
}
