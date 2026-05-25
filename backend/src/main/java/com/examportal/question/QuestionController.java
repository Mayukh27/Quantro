package com.examportal.question;

import com.examportal.common.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * QuestionController - Question bank endpoints.
 *
 * TEXT ENDPOINTS (unchanged):
 *   GET  /api/questions/subject/{id}       - All questions for a subject (ADMIN/TEACHER, includes answers).
 *
 * SINGLE UPLOAD (multipart/form-data):
 *   POST /api/questions/upload             - Upload question + optional images.
 *     Fields:
 *       questionText     (String)
 *       options          (String[4])
 *       correctOptionIndex (int)
 *       difficulty       (String, optional)
 *       marks            (int, optional)
 *       negativeMarks    (double, optional)
 *       subjectId        (long)
 *       questionImage    (file, optional)
 *       optionImage_0    (file, optional) — image for option A
 *       optionImage_1    (file, optional) — image for option B
 *       optionImage_2    (file, optional) — image for option C
 *       optionImage_3    (file, optional) — image for option D
 *
 * EXCEL UPLOAD (backward compatible):
 *   POST /api/questions/excel              - Bulk upload via .xls/.xlsx/.xlsm/.xltx/.xltm (TEACHER/ADMIN).
 *     file      : required Excel
 *     imageZip  : optional ZIP containing images referenced in extra image columns
 *
 * IMAGE SERVING (public, no auth – needed during active exam):
 *   GET  /api/questions/{id}/image         - Serve question body image.
 *   GET  /api/questions/{id}/option-image/{optionIndex} - Serve option image.
 *
 * NOTE: Image endpoints are opened in SecurityConfig to permit access without
 * JWT during exams (images are referenced by question ID which is already
 * revealed to the student in the exam session).
 */
@RestController
@RequestMapping({"/questions", "/api/questions"})
@RequiredArgsConstructor
public class QuestionController {

    private final QuestionService questionService;

    // ── List questions by subject ─────────────────────────────────────────
    @GetMapping("/subject/{subjectId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'TEACHER')")
    public ResponseEntity<ApiResponse<List<QuestionDTO>>> getBySubject(@PathVariable Long subjectId) {
        return ResponseEntity.ok(ApiResponse.success(questionService.findBySubject(subjectId)));
    }

    // ── Single question upload (multipart) ────────────────────────────────
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('TEACHER', 'ADMIN')")
    public ResponseEntity<ApiResponse<QuestionDTO>> upload(
            // text fields
            @RequestParam("subjectId")          Long subjectId,
            @RequestParam("questionText")       String questionText,
            @RequestParam("options")            List<String> options,
            @RequestParam("correctOptionIndex") int correctOptionIndex,
            @RequestParam(value = "difficulty",    defaultValue = "MEDIUM") String difficulty,
            @RequestParam(value = "marks",         defaultValue = "1")      int marks,
            @RequestParam(value = "negativeMarks", defaultValue = "0.25")   double negativeMarks,
            // optional images
            @RequestParam(value = "questionImage",  required = false) MultipartFile questionImage,
            @RequestParam(value = "optionImage_0",  required = false) MultipartFile optionImage0,
            @RequestParam(value = "optionImage_1",  required = false) MultipartFile optionImage1,
            @RequestParam(value = "optionImage_2",  required = false) MultipartFile optionImage2,
            @RequestParam(value = "optionImage_3",  required = false) MultipartFile optionImage3,
            @AuthenticationPrincipal UserDetails userDetails) {

        QuestionDTO dto = QuestionDTO.builder()
                .subjectId(subjectId)
                .questionText(questionText)
                .options(options)
                .correctOptionIndex(correctOptionIndex)
                .difficulty(parseDifficulty(difficulty))
                .marks(marks)
                .negativeMarks(negativeMarks)
                .build();

        MultipartFile[] optionImages = { optionImage0, optionImage1, optionImage2, optionImage3 };

        return ResponseEntity.ok(ApiResponse.success("Question uploaded",
                questionService.upload(dto, questionImage, optionImages, userDetails.getUsername())));
    }

        // ── Excel bulk upload (Excel only OR Excel + ZIP images) ─────────────
    @PostMapping("/excel")
    @PreAuthorize("hasAnyRole('TEACHER', 'ADMIN')")
    public ResponseEntity<ApiResponse<String>> uploadExcel(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "imageZip", required = false) MultipartFile imageZip,
            @AuthenticationPrincipal UserDetails userDetails) {

        questionService.uploadQuestionsFromExcel(file, imageZip, userDetails.getUsername());
        return ResponseEntity.ok(ApiResponse.success(
            "Questions uploaded successfully."));
    }

    // ── Serve question body image ─────────────────────────────────────────
    @GetMapping("/{id}/image")
    public ResponseEntity<byte[]> getQuestionImage(@PathVariable Long id) {
        byte[] data = questionService.getQuestionImage(id);
        String mime = questionService.getQuestionImageType(id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, mime)
                .header(HttpHeaders.CACHE_CONTROL, "max-age=86400")
                .body(data);
    }

    @GetMapping("/{id}/combined-option-image")
    public ResponseEntity<byte[]> getCombinedOptionImage(@PathVariable Long id) {
        byte[] data = questionService.getCombinedOptionImage(id);
        String mime = questionService.getCombinedOptionImageType(id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, mime)
                .header(HttpHeaders.CACHE_CONTROL, "max-age=86400")
                .body(data);
    }

    // ── Serve option image ────────────────────────────────────────────────
    @GetMapping("/{id}/option-image/{optionIndex}")
    public ResponseEntity<byte[]> getOptionImage(
            @PathVariable Long id,
            @PathVariable int optionIndex) {

        QuestionOptionImage img = questionService.getOptionImage(id, optionIndex);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, img.getImageType())
                .header(HttpHeaders.CACHE_CONTROL, "max-age=86400")
                .body(img.getImageData());
    }

    // ── Helper ────────────────────────────────────────────────────────────
    private Difficulty parseDifficulty(String s) {
        try { return Difficulty.valueOf(s.toUpperCase()); }
        catch (Exception e) { return Difficulty.MEDIUM; }
    }
}