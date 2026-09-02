package com.examportal.question;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface QuestionRepository extends JpaRepository<Question, Long> {

    List<Question> findBySubjectId(Long subjectId);
    List<Question> findBySubjectIdAndActive(Long subjectId, boolean active);
    long countBySubjectId(Long subjectId);
    long countBySubjectIdAndActive(Long subjectId, boolean active);

    @Query(value = "SELECT * FROM questions WHERE subject_id = :subjectId AND active = true ORDER BY RANDOM()", nativeQuery = true)
    List<Question> findRandomBySubjectId(Long subjectId, Pageable pageable);

        @Query(value = """
                        SELECT *
                        FROM questions
                        WHERE subject_id = :subjectId
                            AND active = true
                            AND marks = :marks
                            AND ABS(negative_marks - :negativeMarks) < 0.000001
                        ORDER BY RANDOM()
                        """, nativeQuery = true)
        List<Question> findRandomBySubjectIdAndMarks(Long subjectId, Integer marks, Double negativeMarks, Pageable pageable);

    /** CHANGE: Used by SubjectService.delete() to cascade question removal */
    @Modifying
    @Query("DELETE FROM Question q WHERE q.subject.id = :subjectId")
    int deleteBySubjectId(Long subjectId);
}
