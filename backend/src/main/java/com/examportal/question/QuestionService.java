package com.examportal.question;

import com.examportal.subject.Subject;
import com.examportal.subject.SubjectService;
import com.examportal.user.User;
import com.examportal.user.UserService;
import lombok.RequiredArgsConstructor;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.hssf.usermodel.HSSFClientAnchor;
import org.apache.poi.hssf.usermodel.HSSFPatriarch;
import org.apache.poi.hssf.usermodel.HSSFPicture;
import org.apache.poi.hssf.usermodel.HSSFPictureData;
import org.apache.poi.hssf.usermodel.HSSFShape;
import org.apache.poi.hssf.usermodel.HSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFClientAnchor;
import org.apache.poi.xssf.usermodel.XSSFDrawing;
import org.apache.poi.xssf.usermodel.XSSFPicture;
import org.apache.poi.xssf.usermodel.XSSFPictureData;
import org.apache.poi.xssf.usermodel.XSSFShape;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * QuestionService - Question bank management.
 *
 * IMAGE SUPPORT:
 *   Single upload  : multipart/form-data endpoint receives optional questionImage
 *                    and up to 4 optionImage_0 … optionImage_3 files. Raw bytes are
 *                    stored as BYTEA in PostgreSQL via QuestionOptionImage rows.
 *
 *   Excel upload   : Supports both original 10-column text layout, compact layout
 *                    (one question column + one options column), and extended layout
 *                    with optional image path columns:
 *                    K question_image, L option1_image, M option2_image,
 *                    N option3_image, O option4_image.
 *                    If image paths are used, an optional ZIP can be posted as imageZip.
 *
 *   Image serving  : GET /api/questions/{id}/image          → question body image
 *                    GET /api/questions/{id}/option-image/{i} → option i image
 *
 * Questions are uploaded by teachers. Active questions feed the blueprint engine.
 * includeAnswer=false strips correctOptionIndex before sending to students.
 */
@Service
@RequiredArgsConstructor
public class QuestionService {

    private final QuestionRepository questionRepository;
    private final QuestionImageRepository questionImageRepository;
    private final QuestionOptionImageRepository optionImageRepository;
    private final SubjectService subjectService;
    private final UserService userService;

    // ─────────────────────────────────────────────────────────────────────
    // SINGLE QUESTION UPLOAD  (multipart/form-data)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Upload a single question with optional images.
     *
     * @param dto            Question metadata and text options.
     * @param questionImage  Optional image for the question body (may be null/empty).
     * @param optionImages   Array of 4 slots; each element may be null if that option
     *                       has no image.
     * @param uploaderEmail  Authenticated teacher's email.
     */
    @Transactional
    public QuestionDTO upload(QuestionDTO dto,
                              MultipartFile questionImage,
                              MultipartFile[] optionImages,
                              String uploaderEmail) {

        Subject subject = subjectService.getEntityById(dto.getSubjectId());
        User uploader = userService.findByEmail(uploaderEmail);

        // ── Build question entity ─────────────────────────────────────────
        Question.QuestionBuilder builder = Question.builder()
                .subject(subject)
                .uploadedBy(uploader)
                .questionText(dto.getQuestionText() != null ? dto.getQuestionText() : "")
                .options(dto.getOptions() != null ? dto.getOptions() : List.of("", "", "", ""))
                .correctOptionIndex(dto.getCorrectOptionIndex())
                .difficulty(dto.getDifficulty() != null ? dto.getDifficulty() : Difficulty.MEDIUM)
                .marks(dto.getMarks() != null ? dto.getMarks() : 1)
                .negativeMarks(dto.getNegativeMarks() != null ? dto.getNegativeMarks() : 0.25);

        byte[] questionImageBytes = null;
        String questionImageType = null;

        // ── Capture question image (stored in question_images table) ─────
        if (questionImage != null && !questionImage.isEmpty()) {
            try {
                questionImageBytes = questionImage.getBytes();
                questionImageType = questionImage.getContentType();
            } catch (Exception e) {
                throw new IllegalArgumentException("Failed to read question image: " + e.getMessage());
            }
        }

        Question question = questionRepository.save(builder.build());

        if (questionImageBytes != null) {
            upsertQuestionImage(question, questionImageBytes, questionImageType, null, null, false);
        }

        // ── Attach option images ──────────────────────────────────────────
        if (optionImages != null) {
            List<QuestionOptionImage> imgRows = new ArrayList<>();
            for (int i = 0; i < optionImages.length && i < 4; i++) {
                MultipartFile f = optionImages[i];
                if (f != null && !f.isEmpty()) {
                    try {
                        imgRows.add(QuestionOptionImage.builder()
                                .question(question)
                                .optionIndex(i)
                                .imageData(f.getBytes())
                                .imageType(f.getContentType())
                                .build());
                    } catch (Exception e) {
                        throw new IllegalArgumentException(
                                "Failed to read option image " + i + ": " + e.getMessage());
                    }
                }
            }
            optionImageRepository.saveAll(imgRows);
        }

        return toDTO(question, true);
    }

    // ─────────────────────────────────────────────────────────────────────
    // EXCEL BULK UPLOAD  (text-only OR text + image ZIP)
    // ─────────────────────────────────────────────────────────────────────

    @Transactional
    public void uploadQuestionsFromExcel(MultipartFile file, String uploaderEmail) {
        uploadQuestionsFromExcel(file, null, uploaderEmail);
    }

    /**
     * Upload questions from an Excel file (.xls/.xlsx/.xlsm) and optionally bind images from a ZIP.
     *
     * Base columns (A..J) remain unchanged and backward compatible.
     * Optional image path columns:
     *   K (10) question_image, L..O (11..14) option1..option4 image paths,
     *   P (15) combined_option_image (single image containing all options)
     */
    @Transactional
    public void uploadQuestionsFromExcel(MultipartFile file, MultipartFile imageZip, String uploaderEmail) {

        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("No file provided. Please select an Excel file.");
        }

        String filename = file.getOriginalFilename() != null
                ? file.getOriginalFilename().toLowerCase(Locale.ROOT)
                : "";

        byte[] excelBytes;
        Map<String, ZipImageData> zipImages;

        if (filename.endsWith(".zip")) {
            if (imageZip != null && !imageZip.isEmpty()) {
                throw new IllegalArgumentException("When primary file is a ZIP bundle, do not provide imageZip separately.");
            }
            BundlePayload bundle = loadBundleZip(file);
            excelBytes = bundle.excelBytes();
            zipImages = bundle.images();
        } else if (isExcelFilename(filename)) {
            try {
                excelBytes = file.getBytes();
            } catch (Exception e) {
                throw new IllegalArgumentException("Failed to read Excel file: " + e.getMessage());
            }
            zipImages = loadZipImages(imageZip);
        } else {
            throw new IllegalArgumentException("Invalid file type. Upload an Excel file (.xls/.xlsx/.xlsm/.xltx/.xltm) or a .zip bundle containing one Excel file.");
        }

        try (InputStream is = new ByteArrayInputStream(excelBytes);
             Workbook workbook = WorkbookFactory.create(is)) {

            Sheet sheet = workbook.getSheetAt(0);
            Row headerRow = sheet.getRow(0);
            Map<String, Integer> headers = buildHeaderIndexMap(headerRow);
            Map<String, ZipImageData> embeddedImages = extractEmbeddedImages(sheet);
            User uploader = userService.findByEmail(uploaderEmail);
            int uploaded = 0;

            for (Row row : sheet) {
                if (row.getRowNum() == 0) continue; // skip header

                Cell subjectCell = getCellByHeaders(row, headers, "subject_code", "subject_id");
                if (subjectCell == null || subjectCell.toString().isBlank()) continue;

                try {
                    Subject subject = resolveSubject(subjectCell);

                    Cell qTextCell = getCellByHeaders(row, headers, "question", "question_text");
                    String rawQuestionValue = getCellString(qTextCell).trim();
                    String questionText = isLikelyImagePath(rawQuestionValue) ? "" : rawQuestionValue;
                    boolean hasImageInput = hasAnyImageInput(row, headers, zipImages, embeddedImages);
                    if (questionText.isBlank() && !hasImageInput) continue;

                    List<String> options = readOptions(row, headers, zipImages, embeddedImages, row.getRowNum());

                    Cell correctCell = getCellByHeaders(row, headers, "correct", "correct_option");
                    if (correctCell == null) continue;
                        int correctIndex = parseCorrectOption(correctCell, row.getRowNum());
                    if (correctIndex < 0 || correctIndex > 3) {
                        throw new IllegalArgumentException(
                                "Row " + (row.getRowNum() + 1) +
                                        ": correct_option must be 0,1,2 or 3. Got: " + correctIndex);
                    }

                    Difficulty difficulty = Difficulty.MEDIUM;
                    Cell diffCell = getCellByHeaders(row, headers, "difficulty");
                    if (diffCell != null && !diffCell.toString().isBlank()) {
                        try { difficulty = Difficulty.valueOf(diffCell.toString().trim().toUpperCase()); }
                        catch (Exception ignored) {}
                    }

                    int marks = 1;
                    Cell marksCell = getCellByHeaders(row, headers, "marks");
                    if (marksCell != null && !marksCell.toString().isBlank()) {
                        marks = Math.max(1, (int) Math.round(parseNumericCell(marksCell, "marks", row.getRowNum())));
                    }

                    double negativeMarks = 0.25;
                    Cell negCell = getCellByHeaders(row, headers, "negative", "negative_marks");
                    if (negCell != null && !negCell.toString().isBlank()) {
                        negativeMarks = Math.max(0, parseNumericCell(negCell, "negative", row.getRowNum()));
                    }

                    Question question = questionRepository.save(Question.builder()
                            .subject(subject)
                            .uploadedBy(uploader)
                            .questionText(questionText)
                            .options(options)
                            .correctOptionIndex(correctIndex)
                            .difficulty(difficulty)
                            .marks(marks)
                            .negativeMarks(negativeMarks)
                            .build());

                    attachImagesFromRow(row, headers, zipImages, embeddedImages, question);
                    uploaded++;

                } catch (IllegalArgumentException ex) {
                    throw ex;
                } catch (Exception rowEx) {
                    throw new IllegalArgumentException(
                            "Error on row " + (row.getRowNum() + 1) + ": " + rowEx.getMessage());
                }
            }

            if (uploaded == 0) {
                throw new IllegalArgumentException(
                        "No valid questions found in the file. " +
                                "Check that column A contains a valid subject ID/code.");
            }

        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception e) {
            e.printStackTrace();
            throw new IllegalStateException("Excel upload failed: " + e.getMessage(), e);
        }
    }

    private Subject resolveSubject(Cell subjectCell) {
        if (subjectCell.getCellType() == CellType.NUMERIC) {
            Long subjectId = (long) subjectCell.getNumericCellValue();
            return subjectService.getEntityById(subjectId);
        }

        String subjectCode = subjectCell.toString().trim();
        if (subjectCode.isBlank()) {
            throw new IllegalArgumentException("Subject value cannot be blank");
        }

        // Backward-compatible: allow either numeric internal id or subject code.
        try {
            return subjectService.getEntityById(Long.parseLong(subjectCode));
        } catch (NumberFormatException ignored) {
            return subjectService.getEntityByCode(subjectCode);
        }
    }

    private void attachImagesFromRow(
            Row row,
            Map<String, Integer> headers,
            Map<String, ZipImageData> zipImages,
            Map<String, ZipImageData> embeddedImages,
            Question question
    ) {
        String qPath = readImageReferenceCell(row, headers, zipImages, "question_image");
        if (qPath.isBlank()) {
            qPath = readLikelyImagePathCell(row, headers, "question", "question_text");
        }

        String combinedOptPath = readImageReferenceCell(row, headers, zipImages, "combined_option_image");
        if (combinedOptPath.isBlank()) {
            combinedOptPath = readLikelyImagePathCell(row, headers, "options", "options_text", "option");
        }

        ZipImageData qImg = null;
        ZipImageData combinedImg = null;

        qImg = findEmbeddedImage(embeddedImages, row.getRowNum(), headers, "question_image", "question", "question_text");
        if (qImg == null && !qPath.isBlank()) {
            qImg = findZipImage(zipImages, qPath, row.getRowNum());
        }

        // combined_option_image is now stored separately and rendered in exam page
        // below the question text.
        combinedImg = findEmbeddedImage(embeddedImages, row.getRowNum(), headers, "combined_option_image", "options", "options_text", "option");
        if (combinedImg == null && !combinedOptPath.isBlank()) {
            combinedImg = findZipImage(zipImages, combinedOptPath, row.getRowNum());
        }

        if (qImg != null || combinedImg != null) {
            upsertQuestionImage(
                    question,
                    qImg != null ? qImg.data() : null,
                    qImg != null ? qImg.mimeType() : null,
                    combinedImg != null ? combinedImg.data() : null,
                    combinedImg != null ? combinedImg.mimeType() : null,
                    true
            );
        }

        List<QuestionOptionImage> optionImages = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            String optPath = readImageReferenceCell(row, headers, zipImages, "option" + (i + 1) + "_image");
            if (optPath.isBlank()) {
                optPath = readImageReferenceCell(row, headers, zipImages, optionTextHeaderAliases(i));
            }
            ZipImageData optImg = null;
            optImg = findEmbeddedImage(embeddedImages, row.getRowNum(), headers, "option" + (i + 1) + "_image");
            if (optImg == null) {
                optImg = findEmbeddedImage(embeddedImages, row.getRowNum(), headers, optionTextHeaderAliases(i));
            }
            if (optImg == null && !optPath.isBlank()) {
                optImg = findZipImage(zipImages, optPath, row.getRowNum());
            }
            if (optImg == null) continue;
            optionImages.add(QuestionOptionImage.builder()
                    .question(question)
                    .optionIndex(i)
                    .imageData(optImg.data())
                    .imageType(optImg.mimeType())
                    .build());
        }
        if (!optionImages.isEmpty()) {
            optionImageRepository.saveAll(optionImages);
        }
    }

        private boolean hasAnyImageInput(
            Row row,
            Map<String, Integer> headers,
            Map<String, ZipImageData> zipImages,
            Map<String, ZipImageData> embeddedImages
        ) {
        if (findEmbeddedImage(embeddedImages, row.getRowNum(), headers,
                "question_image", "question", "question_text") != null) {
            return true;
        }
        if (!readLikelyImagePathCell(row, headers,
                "question_image", "question", "question_text").isBlank()) {
            return true;
        }

        if (findEmbeddedImage(embeddedImages, row.getRowNum(), headers,
                "combined_option_image", "options", "options_text", "option") != null) {
            return true;
        }
        if (!readImageReferenceCell(row, headers, zipImages,
                "combined_option_image").isBlank()) {
            return true;
        }
        if (!readLikelyImagePathCell(row, headers,
                "combined_option_image", "options", "options_text", "option").isBlank()) {
            return true;
        }

        for (int i = 0; i < 4; i++) {
            if (findEmbeddedImage(embeddedImages, row.getRowNum(), headers,
                    "option" + (i + 1) + "_image") != null) {
                return true;
            }
            if (!readImageReferenceCell(row, headers, zipImages,
                    "option" + (i + 1) + "_image").isBlank()) {
                return true;
            }

            if (findEmbeddedImage(embeddedImages, row.getRowNum(), headers, optionTextHeaderAliases(i)) != null) {
                return true;
            }
            if (!readImageReferenceCell(row, headers, zipImages, optionTextHeaderAliases(i)).isBlank()) {
                return true;
            }
        }

        return false;
    }

    private Map<String, ZipImageData> loadZipImages(MultipartFile imageZip) {
        Map<String, ZipImageData> images = new HashMap<>();
        if (imageZip == null || imageZip.isEmpty()) return images;

        String filename = imageZip.getOriginalFilename();
        if (filename == null || !filename.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            throw new IllegalArgumentException("imageZip must be a .zip file");
        }

        try (ZipInputStream zis = new ZipInputStream(imageZip.getInputStream())) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String key = normalizeZipPath(entry.getName());
                if (key.isBlank()) continue;
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                while ((n = zis.read(buffer)) > 0) {
                    bos.write(buffer, 0, n);
                }
                images.put(key, new ZipImageData(bos.toByteArray(), detectMimeType(key)));
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to read imageZip: " + e.getMessage());
        }

        return images;
    }

    private ZipImageData findZipImage(Map<String, ZipImageData> zipImages, String imagePath, int rowNum) {
        if (zipImages.isEmpty()) {
            throw new IllegalArgumentException("Row " + (rowNum + 1) + ": image path provided but imageZip is missing");
        }

        String key = normalizeZipPath(imagePath);
        ZipImageData data = zipImages.get(key);

        // Fallback: if Excel provides only file name, resolve uniquely across nested folders.
        if (data == null) {
            String fileName = key.contains("/") ? key.substring(key.lastIndexOf('/') + 1) : key;
            String fileStem = fileName.contains(".") ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
            List<ZipImageData> matches = zipImages.entrySet().stream()
                .filter(e -> {
                String candidate = e.getKey();
                String candidateName = candidate.contains("/") ? candidate.substring(candidate.lastIndexOf('/') + 1) : candidate;
                String candidateStem = candidateName.contains(".")
                    ? candidateName.substring(0, candidateName.lastIndexOf('.'))
                    : candidateName;
                return candidate.equals(key)
                    || candidateName.equals(fileName)
                    || candidateStem.equals(fileStem)
                    || candidate.endsWith("/" + fileName)
                    || candidate.endsWith("/" + fileStem);
                })
                    .map(Map.Entry::getValue)
                    .toList();
            if (matches.size() == 1) {
                data = matches.get(0);
            } else if (matches.size() > 1) {
                throw new IllegalArgumentException("Row " + (rowNum + 1) + ": ambiguous image file name in ZIP: " + imagePath);
            }
        }

        if (data == null) {
            throw new IllegalArgumentException("Row " + (rowNum + 1) + ": image not found in ZIP: " + imagePath);
        }
        return data;
    }

    private BundlePayload loadBundleZip(MultipartFile bundleZip) {
        Map<String, ZipImageData> images = new HashMap<>();
        byte[] excel = null;

        try (ZipInputStream zis = new ZipInputStream(bundleZip.getInputStream())) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String key = normalizeZipPath(entry.getName());
                if (key.isBlank()) continue;

                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                while ((n = zis.read(buffer)) > 0) {
                    bos.write(buffer, 0, n);
                }
                byte[] content = bos.toByteArray();

                if (isExcelFilename(key)) {
                    if (excel != null) {
                        throw new IllegalArgumentException("ZIP bundle must contain only one Excel file.");
                    }
                    excel = content;
                    continue;
                }

                images.put(key, new ZipImageData(content, detectMimeType(key)));
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to read ZIP bundle: " + e.getMessage());
        }

        if (excel == null) {
            throw new IllegalArgumentException("ZIP bundle must contain one Excel file (.xls/.xlsx/.xlsm/.xltx/.xltm) at root or inside folders.");
        }

        return new BundlePayload(excel, images);
    }

    private boolean isExcelFilename(String filename) {
        if (filename == null) return false;
        String lower = filename.toLowerCase(Locale.ROOT);
        return lower.endsWith(".xls")
                || lower.endsWith(".xlsx")
                || lower.endsWith(".xlsm")
                || lower.endsWith(".xltx")
                || lower.endsWith(".xltm");
    }

    private String getCellString(Cell cell) {
        return cell == null ? "" : cell.toString().trim();
    }

    private String readLikelyImagePathCell(Row row, Map<String, Integer> headers, String... headerNames) {
        String value = getCellString(getCellByHeaders(row, headers, headerNames));
        return isLikelyImagePath(value) ? value : "";
    }

    private String readImageReferenceCell(
            Row row,
            Map<String, Integer> headers,
            Map<String, ZipImageData> zipImages,
            String... headerNames
    ) {
        String value = getCellString(getCellByHeaders(row, headers, headerNames));
        return isImageReferenceValue(value, zipImages) ? value : "";
    }

    private boolean isImageReferenceValue(String value, Map<String, ZipImageData> zipImages) {
        if (value == null) return false;
        String trimmed = value.trim();
        if (trimmed.isBlank()) return false;
        if (isLikelyImagePath(trimmed)) return true;
        return canResolveZipImage(zipImages, trimmed);
    }

    private boolean canResolveZipImage(Map<String, ZipImageData> zipImages, String imagePath) {
        if (zipImages == null || zipImages.isEmpty() || imagePath == null || imagePath.isBlank()) {
            return false;
        }

        String key = normalizeZipPath(imagePath);
        if (zipImages.containsKey(key)) {
            return true;
        }

        String fileName = key.contains("/") ? key.substring(key.lastIndexOf('/') + 1) : key;
        String fileStem = fileName.contains(".") ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;

        return zipImages.keySet().stream().anyMatch(candidate -> {
            String candidateName = candidate.contains("/") ? candidate.substring(candidate.lastIndexOf('/') + 1) : candidate;
            String candidateStem = candidateName.contains(".")
                    ? candidateName.substring(0, candidateName.lastIndexOf('.'))
                    : candidateName;
            return candidateName.equals(fileName)
                    || candidateStem.equals(fileStem)
                    || candidate.endsWith("/" + fileName)
                    || candidate.endsWith("/" + fileStem);
        });
    }

    private boolean isLikelyImagePath(String value) {
        if (value == null) return false;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.isBlank()) return false;

        return normalized.endsWith(".png")
                || normalized.endsWith(".jpg")
                || normalized.endsWith(".jpeg")
                || normalized.endsWith(".webp")
                || normalized.endsWith(".gif")
                || normalized.endsWith(".bmp")
                || normalized.endsWith(".svg");
    }

    private String[] optionTextHeaderAliases(int index) {
        return switch (index) {
            case 0 -> new String[]{"option1", "option_a"};
            case 1 -> new String[]{"option2", "option_b"};
            case 2 -> new String[]{"option3", "option_c"};
            case 3 -> new String[]{"option4", "option_d"};
            default -> new String[0];
        };
    }

    private List<String> readOptions(
            Row row,
            Map<String, Integer> headers,
            Map<String, ZipImageData> zipImages,
            Map<String, ZipImageData> embeddedImages,
            int rowNum
    ) {
        List<String> options = new ArrayList<>(List.of("", "", "", ""));

        for (int i = 0; i < options.size(); i++) {
            String[] aliases = optionTextHeaderAliases(i);
            String value = getCellString(getCellByHeaders(row, headers, aliases));
            if (value.isBlank()) {
                continue;
            }

            if (findEmbeddedImage(embeddedImages, row.getRowNum(), headers, aliases) != null) {
                continue;
            }

            if (isImageReferenceValue(value, zipImages)) {
                continue;
            }

            options.set(i, value);
        }

        for (int i = 0; i < options.size(); i++) {
            if (isLikelyImagePath(options.get(i))) {
                options.set(i, "");
            }
        }

        boolean hasMultiColumnOptions = options.stream().anyMatch(v -> !v.isBlank());
        if (hasMultiColumnOptions) {
            return options;
        }

        String packed = getCellString(getCellByHeaders(row, headers, "options", "options_text", "option"));
        if (packed.isBlank()) {
            return options;
        }

        if (isLikelyImagePath(packed)) {
            return options;
        }

        List<String> parsed = splitPackedOptions(packed);
        if (parsed.size() != 4) {
            throw new IllegalArgumentException(
                    "Row " + (rowNum + 1) + ": options column must contain exactly 4 options " +
                            "separated by newline, |, or ;");
        }

        return parsed;
    }

    private List<String> splitPackedOptions(String packed) {
        String normalized = packed == null ? "" : packed.trim();
        if (normalized.isBlank()) {
            return List.of();
        }

        String delimiterRegex;
        if (normalized.contains("\n") || normalized.contains("\r")) {
            delimiterRegex = "\\r?\\n";
        } else if (normalized.contains("|")) {
            delimiterRegex = "\\|";
        } else {
            delimiterRegex = ";";
        }

        List<String> parts = new ArrayList<>();
        for (String part : normalized.split(delimiterRegex)) {
            String value = part.trim();
            if (!value.isBlank()) {
                parts.add(value);
            }
        }
        return parts;
    }

    private Map<String, Integer> buildHeaderIndexMap(Row headerRow) {
        if (headerRow == null) {
            throw new IllegalArgumentException("Excel header row is missing");
        }

        Map<String, Integer> headers = new HashMap<>();
        for (Cell cell : headerRow) {
            String key = normalizeHeader(cell.toString());
            if (!key.isBlank()) headers.put(key, cell.getColumnIndex());
        }

        if (!headers.containsKey("question") && !headers.containsKey("question_text")) {
            throw new IllegalArgumentException("Excel header must contain 'question' or 'question_text'");
        }
        if (!headers.containsKey("subject_code") && !headers.containsKey("subject_id")) {
            throw new IllegalArgumentException("Excel header must contain 'subject_code' or 'subject_id'");
        }
        if (!headers.containsKey("correct") && !headers.containsKey("correct_option")) {
            throw new IllegalArgumentException("Excel header must contain 'correct' or 'correct_option'");
        }

        boolean hasMultiOptions = headers.containsKey("option1") || headers.containsKey("option_a");
        boolean hasSingleOptions = headers.containsKey("options") || headers.containsKey("options_text") || headers.containsKey("option");
        if (!hasMultiOptions && !hasSingleOptions) {
            throw new IllegalArgumentException(
                    "Excel header must contain either option1..option4 (or option_a..option_d), " +
                            "or a single 'options'/'options_text'/'option' column");
        }

        return headers;
    }

    private Cell getCellByHeaders(Row row, Map<String, Integer> headers, String... headerNames) {
        for (String name : headerNames) {
            Integer idx = headers.get(normalizeHeader(name));
            if (idx != null) {
                return row.getCell(idx);
            }
        }
        return null;
    }

    private String normalizeHeader(String header) {
        return header == null ? "" : header.trim().toLowerCase(Locale.ROOT);
    }

    private int parseCorrectOption(Cell cell, int rowNum) {
        if (cell.getCellType() == CellType.NUMERIC) {
            return (int) Math.round(cell.getNumericCellValue());
        }

        String raw = cell.toString().trim().toUpperCase(Locale.ROOT);
        if (raw.isBlank()) {
            throw new IllegalArgumentException("Row " + (rowNum + 1) + ": correct_option is blank");
        }
        if (raw.matches("^[0-3]$")) {
            return Integer.parseInt(raw);
        }
        return switch (raw) {
            case "A" -> 0;
            case "B" -> 1;
            case "C" -> 2;
            case "D" -> 3;
            default -> throw new IllegalArgumentException(
                    "Row " + (rowNum + 1) + ": correct_option must be 0/1/2/3 or A/B/C/D. Got: " + raw);
        };
    }

    private double parseNumericCell(Cell cell, String fieldName, int rowNum) {
        if (cell.getCellType() == CellType.NUMERIC) {
            return cell.getNumericCellValue();
        }

        String raw = cell.toString().trim();
        if (raw.isBlank()) {
            throw new IllegalArgumentException("Row " + (rowNum + 1) + ": " + fieldName + " is blank");
        }
        try {
            return Double.parseDouble(raw);
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(
                    "Row " + (rowNum + 1) + ": invalid numeric value for " + fieldName + ": " + raw);
        }
    }

    private String normalizeZipPath(String raw) {
        if (raw == null) return "";
        String normalized = raw.trim().replace('\\', '/');
        while (normalized.startsWith("./")) {
            normalized = normalized.substring(2);
        }
        return normalized.toLowerCase(Locale.ROOT);
    }

    private String embeddedKey(int row, int col) {
        return row + ":" + col;
    }

    private Map<String, ZipImageData> extractEmbeddedImages(Sheet sheet) {
        Map<String, ZipImageData> embedded = new HashMap<>();
        if (sheet instanceof XSSFSheet xssfSheet) {
            XSSFDrawing drawing = xssfSheet.getDrawingPatriarch();
            if (drawing == null) return embedded;

            for (XSSFShape shape : drawing.getShapes()) {
                if (!(shape instanceof XSSFPicture picture)) continue;
                if (!(picture.getAnchor() instanceof XSSFClientAnchor anchor)) continue;

                int row = anchor.getRow1();
                int col = anchor.getCol1();
                if (row < 1 || col < 0) continue; // ignore header-row/unanchored artifacts

                XSSFPictureData data = picture.getPictureData();
                if (data == null || data.getData() == null || data.getData().length == 0) continue;

                String ext = data.suggestFileExtension();
                String mime = detectMimeType(ext == null ? "" : ("file." + ext));
                embedded.putIfAbsent(embeddedKey(row, col), new ZipImageData(data.getData(), mime));
            }
            return embedded;
        }

        if (sheet instanceof HSSFSheet hssfSheet) {
            HSSFPatriarch drawing = hssfSheet.getDrawingPatriarch();
            if (drawing == null) return embedded;

            for (HSSFShape shape : drawing.getChildren()) {
                if (!(shape instanceof HSSFPicture picture)) continue;
                HSSFClientAnchor anchor = picture.getClientAnchor();
                if (anchor == null) continue;

                int row = anchor.getRow1();
                int col = anchor.getCol1();
                if (row < 1 || col < 0) continue; // ignore header-row/unanchored artifacts

                HSSFPictureData data = picture.getPictureData();
                if (data == null || data.getData() == null || data.getData().length == 0) continue;

                String mime = data.getMimeType();
                embedded.putIfAbsent(embeddedKey(row, col), new ZipImageData(data.getData(), mime));
            }
        }

        return embedded;
    }

    private ZipImageData findEmbeddedImage(
            Map<String, ZipImageData> embeddedImages,
            int rowNum,
            Map<String, Integer> headers,
            String... headerNames
    ) {
        for (String headerName : headerNames) {
            Integer col = headers.get(normalizeHeader(headerName));
            if (col == null) continue;
            ZipImageData image = embeddedImages.get(embeddedKey(rowNum, col));
            if (image != null) return image;
        }
        return null;
    }

    private String detectMimeType(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".bmp")) return "image/bmp";
        return "application/octet-stream";
    }

    private record ZipImageData(byte[] data, String mimeType) {}

    private record BundlePayload(byte[] excelBytes, Map<String, ZipImageData> images) {}

    // ─────────────────────────────────────────────────────────────────────
    // IMAGE SERVING
    // ─────────────────────────────────────────────────────────────────────

    /** Returns raw bytes + MIME type for the question's body image. */
    public byte[] getQuestionImage(Long questionId) {
        QuestionImage img = questionImageRepository.findByQuestionId(questionId).orElse(null);
        if (img != null && img.getQuestionImage() != null) {
            return img.getQuestionImage();
        }

        throw new IllegalArgumentException("Question " + questionId + " has no image.");
    }

    public String getQuestionImageType(Long questionId) {
        QuestionImage img = questionImageRepository.findByQuestionId(questionId).orElse(null);
        if (img != null && img.getQuestionImage() != null) {
            return img.getQuestionImageType() != null ? img.getQuestionImageType() : "application/octet-stream";
        }

        return "application/octet-stream";
    }

    public byte[] getCombinedOptionImage(Long questionId) {
        QuestionImage img = questionImageRepository.findByQuestionId(questionId).orElse(null);
        if (img != null && img.getCombinedOptionImage() != null) {
            return img.getCombinedOptionImage();
        }

        throw new IllegalArgumentException("Question " + questionId + " has no combined option image.");
    }

    public String getCombinedOptionImageType(Long questionId) {
        QuestionImage img = questionImageRepository.findByQuestionId(questionId).orElse(null);
        if (img != null && img.getCombinedOptionImage() != null) {
            return img.getCombinedOptionImageType() != null
                    ? img.getCombinedOptionImageType()
                    : "application/octet-stream";
        }

        return "application/octet-stream";
    }

    /** Returns raw bytes + MIME type for the image of a specific option slot. */
    public QuestionOptionImage getOptionImage(Long questionId, int optionIndex) {
        return optionImageRepository.findByQuestionIdOrderByOptionIndex(questionId)
                .stream()
                .filter(img -> img.getOptionIndex() == optionIndex)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "No image for question " + questionId + " option " + optionIndex));
    }

    // ─────────────────────────────────────────────────────────────────────
    // QUERY HELPERS
    // ─────────────────────────────────────────────────────────────────────

    public List<QuestionDTO> findBySubject(Long subjectId) {
        return questionRepository.findBySubjectIdAndActive(subjectId, true)
                .stream()
                .map(q -> toDTO(q, true))
                .collect(Collectors.toList());
    }

    public List<Question> fetchRandom(Long subjectId, int count) {
        return questionRepository.findRandomBySubjectId(subjectId, PageRequest.of(0, count));
    }

    public List<Question> fetchRandom(Long subjectId, int count, Integer marks, Double negativeMarks) {
        int effectiveMarks = marks != null ? marks : 1;
        double effectiveNegative = negativeMarks != null ? negativeMarks : 0.25;
        return questionRepository.findRandomBySubjectIdAndMarks(
                subjectId,
                effectiveMarks,
                effectiveNegative,
                PageRequest.of(0, count)
        );
    }

    public List<Question> fetchAllActive(Long subjectId) {
        return questionRepository.findBySubjectIdAndActive(subjectId, true);
    }

    public List<QuestionDTO> findByIds(List<Long> ids, boolean includeAnswer) {
        return questionRepository.findAllById(ids)
                .stream()
                .map(q -> toDTO(q, includeAnswer))
                .toList();
    }

    public Question getEntityById(Long id) {
        return questionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Question not found: " + id));
    }

    // ─────────────────────────────────────────────────────────────────────
    // DTO CONVERSION
    // ─────────────────────────────────────────────────────────────────────

    public QuestionDTO toDTO(Question q, boolean includeAnswer) {
        // Build per-option image flags
        List<QuestionOptionImage> imgs =
                q.getOptionImages() != null ? q.getOptionImages() : Collections.emptyList();

        int optCount = q.getOptions() != null ? q.getOptions().size() : 4;
        List<Boolean> hasImg = new ArrayList<>(Collections.nCopies(optCount, false));
        for (QuestionOptionImage img : imgs) {
            int idx = img.getOptionIndex();
            if (idx >= 0 && idx < optCount) hasImg.set(idx, true);
        }

        QuestionImage qImg = questionImageRepository.findByQuestionId(q.getId()).orElse(null);
        boolean hasQuestionImage = qImg != null && qImg.getQuestionImage() != null;
        boolean hasCombinedOptionImage = qImg != null && qImg.getCombinedOptionImage() != null;

        return QuestionDTO.builder()
                .id(q.getId())
                .subjectId(q.getSubject().getId())
                .subjectName(q.getSubject().getName())
                .questionText(q.getQuestionText())
                .options(q.getOptions())
                .correctOptionIndex(includeAnswer ? q.getCorrectOptionIndex() : null)
                .difficulty(q.getDifficulty())
                .marks(q.getMarks())
                .negativeMarks(q.getNegativeMarks())
                .hasQuestionImage(hasQuestionImage)
                .hasCombinedOptionImage(hasCombinedOptionImage)
                .optionHasImage(hasImg)
                .build();
    }

    private void upsertQuestionImage(
            Question question,
            byte[] questionBytes,
            String questionMime,
            byte[] combinedBytes,
            String combinedMime,
            boolean copyCombinedToQuestionWhenMissing
    ) {
        QuestionImage image = questionImageRepository.findByQuestionId(question.getId())
                .orElseGet(() -> QuestionImage.builder().question(question).build());

        if (questionBytes != null) {
            image.setQuestionImage(questionBytes);
            image.setQuestionImageType(questionMime);
        }

        if (combinedBytes != null) {
            image.setCombinedOptionImage(combinedBytes);
            image.setCombinedOptionImageType(combinedMime);

            if (copyCombinedToQuestionWhenMissing && image.getQuestionImage() == null) {
                image.setQuestionImage(combinedBytes);
                image.setQuestionImageType(combinedMime);
            }
        }

        questionImageRepository.save(image);
    }
}