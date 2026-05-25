package com.examportal.admin;

import com.examportal.common.ApiResponse;
import com.examportal.common.FeatureDisabledException;
import com.examportal.config.FeatureFlags;
import com.examportal.user.Role;
import com.examportal.user.User;
import com.examportal.user.UserDTO;
import com.examportal.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.apache.poi.ss.usermodel.*;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.util.stream.Collectors;

/**
 * AdminController - Platform administration. All routes require ADMIN role.
 *
 * GET  /api/admin/teachers/pending   - Unapproved teacher accounts.
 * GET  /api/admin/teachers           - All teachers.
 * GET  /api/admin/students           - All students.
 * PUT  /api/admin/teachers/{id}/approve - Approve a teacher.
 * GET  /api/admin/stats              - Platform statistics.
 */
@RestController
@RequestMapping("/admin")
@RequiredArgsConstructor
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {

    private final UserRepository userRepository;
    private final FeatureFlags featureFlags;
    private final PasswordEncoder passwordEncoder;
    private final AdminAttemptService adminAttemptService;

    @GetMapping("/teachers/pending")
    public ResponseEntity<ApiResponse<List<UserDTO>>> getPendingTeachers() {
        if (!featureFlags.isAdmin()) throw new FeatureDisabledException("admin");
        List<UserDTO> pending = userRepository.findByRole(Role.TEACHER).stream()
            .filter(u -> !u.isApproved())
            .map(this::toDTO).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.success(pending));
    }

    @GetMapping("/teachers")
    public ResponseEntity<ApiResponse<List<UserDTO>>> getAllTeachers() {
        if (!featureFlags.isAdmin()) throw new FeatureDisabledException("admin");
        List<UserDTO> teachers = userRepository.findByRole(Role.TEACHER)
            .stream().map(this::toDTO).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.success(teachers));
    }

    @GetMapping("/students")
    public ResponseEntity<ApiResponse<List<UserDTO>>> getAllStudents() {
        if (!featureFlags.isAdmin()) throw new FeatureDisabledException("admin");
        List<UserDTO> students = userRepository.findByRole(Role.STUDENT)
            .stream().map(this::toDTO).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.success(students));
    }

    @PutMapping("/teachers/{id}/approve")
    public ResponseEntity<ApiResponse<UserDTO>> approveTeacher(@PathVariable Long id) {
        if (!featureFlags.isAdmin()) throw new FeatureDisabledException("admin");
        User teacher = userRepository.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("User not found: " + id));
        if (teacher.getRole() != Role.TEACHER) {
            throw new IllegalArgumentException("User is not a teacher");
        }
        teacher.setApproved(true);
        return ResponseEntity.ok(ApiResponse.success("Teacher approved", toDTO(userRepository.save(teacher))));
    }

    @GetMapping("/stats")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getStats() {
        if (!featureFlags.isAnalytics()) throw new FeatureDisabledException("analytics");
        return ResponseEntity.ok(ApiResponse.success(Map.of(
            "totalStudents", userRepository.countByRole(Role.STUDENT),
            "totalTeachers", userRepository.countByRole(Role.TEACHER),
            "totalAdmins", userRepository.countByRole(Role.ADMIN)
        )));
    }

    @PostMapping(value = "/students/bulk-register", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<Map<String, Object>>> bulkRegisterStudents(
            @RequestParam("file") MultipartFile file
    ) {
        if (!featureFlags.isAdmin()) throw new FeatureDisabledException("admin");
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Please upload an Excel or CSV file");
        }

        List<Map<String, String>> records = parseRecords(file);
        int created = 0;
        int skipped = 0;
        List<String> errors = new ArrayList<>();

        for (int i = 0; i < records.size(); i++) {
            Map<String, String> record = records.get(i);
            int rowNum = i + 2;
            try {
                String enrollmentNo = trimToNull(record.get("enrollment_no"));
                String fullName = trimToNull(record.get("full_name"));
                String stream = trimToNull(record.get("stream"));
                String section = trimToNull(record.get("section"));
                String studentYear = trimToNull(record.get("student_year"));
                String classRollNo = trimToNull(record.get("class_roll_no"));
                String dobRaw = trimToNull(record.get("date_of_birth"));

                if (enrollmentNo == null && fullName == null && stream == null && section == null && classRollNo == null && dobRaw == null) {
                    continue;
                }

                if (enrollmentNo == null || fullName == null || stream == null || section == null || studentYear == null || classRollNo == null || dobRaw == null) {
                    skipped++;
                    errors.add("Row " + rowNum + ": missing one or more required fields");
                    continue;
                }

                if (userRepository.existsByEnrollmentNo(enrollmentNo)) {
                    skipped++;
                    errors.add("Row " + rowNum + ": enrollment already exists (" + enrollmentNo + ")");
                    continue;
                }

                LocalDate dob = parseDateFlexible(dobRaw);
                String email = resolveStudentEmail(record.get("email"), enrollmentNo);

                User user = User.builder()
                        .email(email)
                    .password(passwordEncoder.encode(dob.format(DateTimeFormatter.ofPattern("ddMMyyyy"))))
                        .fullName(fullName)
                        .enrollmentNo(enrollmentNo)
                        .stream(stream)
                        .section(section)
                        .studentYear(studentYear)
                        .classRollNo(classRollNo)
                        .dateOfBirth(dob)
                        .role(Role.STUDENT)
                        .approved(true)
                        .enabled(true)
                        .build();
                userRepository.save(user);
                created++;

            } catch (Exception ex) {
                skipped++;
                errors.add("Row " + rowNum + ": " + ex.getMessage());
            }
        }

        Map<String, Object> result = new HashMap<>();
        result.put("created", created);
        result.put("skipped", skipped);
        result.put("totalRows", records.size());
        result.put("errors", errors);

        return ResponseEntity.ok(ApiResponse.success("Bulk registration completed", result));
    }

    @DeleteMapping("/attempts")
    public ResponseEntity<ApiResponse<Map<String, Object>>> deleteAttempt(
            @RequestParam(value = "attemptId", required = false) Long attemptId,
            @RequestParam(value = "enrollmentNo", required = false) String enrollmentNo,
            @RequestParam(value = "email", required = false) String email,
            @RequestParam(value = "examId", required = false) Long examId
    ) {
        if (!featureFlags.isAdmin()) throw new FeatureDisabledException("admin");
        Map<String, Object> result = adminAttemptService.deleteAttempt(attemptId, enrollmentNo, email, examId);
        return ResponseEntity.ok(ApiResponse.success("Attempt deleted", result));
    }

    private UserDTO toDTO(User u) {
        return UserDTO.builder().id(u.getId()).email(u.getEmail())
            .enrollmentNo(u.getEnrollmentNo())
            .fullName(u.getFullName())
            .stream(u.getStream())
            .section(u.getSection())
            .studentYear(u.getStudentYear())
            .classRollNo(u.getClassRollNo())
            .dateOfBirth(u.getDateOfBirth())
            .role(u.getRole())
            .approved(u.isApproved())
            .createdAt(u.getCreatedAt())
            .build();
    }

    private List<Map<String, String>> parseRecords(MultipartFile file) {
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase(Locale.ROOT);
        if (name.endsWith(".csv")) {
            return parseCsv(file);
        }
        if (name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xltx") || name.endsWith(".xltm")) {
            return parseExcel(file);
        }
        throw new IllegalArgumentException("Unsupported file type. Use .csv, .xls, or .xlsx");
    }

    private List<Map<String, String>> parseCsv(MultipartFile file) {
        List<Map<String, String>> rows = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
            String headerLine = br.readLine();
            if (headerLine == null) return rows;

            String[] rawHeaders = splitCsv(headerLine);
            List<String> headers = new ArrayList<>();
            for (String raw : rawHeaders) {
                headers.add(canonicalHeader(raw));
            }

            String line;
            while ((line = br.readLine()) != null) {
                String[] parts = splitCsv(line);
                Map<String, String> row = new HashMap<>();
                for (int i = 0; i < headers.size(); i++) {
                    row.put(headers.get(i), i < parts.length ? cleanCsv(parts[i]) : "");
                }
                rows.add(row);
            }
            return rows;
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to parse CSV: " + e.getMessage());
        }
    }

    private List<Map<String, String>> parseExcel(MultipartFile file) {
        List<Map<String, String>> rows = new ArrayList<>();
        DataFormatter formatter = new DataFormatter();

        try (Workbook wb = WorkbookFactory.create(new ByteArrayInputStream(file.getBytes()))) {
            Sheet sheet = wb.getSheetAt(0);
            Row header = sheet.getRow(0);
            if (header == null) return rows;

            List<String> headers = new ArrayList<>();
            for (int c = 0; c < header.getLastCellNum(); c++) {
                headers.add(canonicalHeader(formatter.formatCellValue(header.getCell(c))));
            }

            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                Row rowObj = sheet.getRow(r);
                if (rowObj == null) continue;
                Map<String, String> row = new HashMap<>();
                for (int c = 0; c < headers.size(); c++) {
                    Cell cell = rowObj.getCell(c);
                    String headerKey = headers.get(c);
                    if (cell == null) {
                        row.put(headerKey, "");
                    } else if ("date_of_birth".equals(headerKey)) {
                        row.put(headerKey, extractExcelDateValue(cell, formatter));
                    } else {
                        row.put(headerKey, formatter.formatCellValue(cell).trim());
                    }
                }
                rows.add(row);
            }
            return rows;
        } catch (Exception e) {
            throw new IllegalArgumentException("Failed to parse Excel: " + e.getMessage());
        }
    }

    private String extractExcelDateValue(Cell cell, DataFormatter formatter) {
        try {
            if (DateUtil.isCellDateFormatted(cell)) {
                LocalDate date = cell.getDateCellValue().toInstant()
                        .atZone(ZoneId.systemDefault())
                        .toLocalDate();
                return date.toString();
            }

            if (cell.getCellType() == CellType.NUMERIC) {
                double raw = cell.getNumericCellValue();
                if (raw > 0) {
                    LocalDate date = LocalDate.of(1899, 12, 30).plusDays((long) raw);
                    return date.toString();
                }
            }
        } catch (Exception ignored) {
        }

        return formatter.formatCellValue(cell).trim();
    }

    private String[] splitCsv(String line) {
        List<String> values = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);
            if (ch == '"') {
                if (inQuotes && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    current.append('"');
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch == ',' && !inQuotes) {
                values.add(current.toString());
                current.setLength(0);
                continue;
            }

            current.append(ch);
        }
        values.add(current.toString());
        return values.toArray(new String[0]);
    }

    private String cleanCsv(String value) {
        String v = value == null ? "" : value.trim();
        if (v.startsWith("\"") && v.endsWith("\"") && v.length() >= 2) {
            v = v.substring(1, v.length() - 1);
        }
        return v.trim();
    }

    private String canonicalHeader(String header) {
        String key = header == null ? "" : header.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return switch (key) {
            case "enrollment", "enrollmentno", "enrollmentnumber", "enrollment no" -> "enrollment_no";
            case "name", "fullname", "studentname" -> "full_name";
            case "stream" -> "stream";
            case "section" -> "section";
              case "year", "studentyear", "student_year", "batch", "batchyear", "batch_year",
                  "batchyears", "batchyearrange", "admissionyear", "admission", "passoutyear", "passout",
                  "graduationyear", "passingyear" -> "student_year";
            case "classroll", "classrollno", "classrollnumber", "rollno", "rollnumber", "class roll", "class roll no" -> "class_roll_no";
            case "dateofbirth", "dob", "birthdate", "birth", "date of birth" -> "date_of_birth";
            case "email", "emailaddress", "email address" ,"emailid", "email id" -> "email";
            default -> key;
        };
    }

    private LocalDate parseDateFlexible(String value) {
        if (value == null) {
            throw new IllegalArgumentException("date_of_birth is required");
        }

        // Normalize unusual whitespace and separators from spreadsheet exports.
        String normalized = value
                .replace('\u00A0', ' ')
                .trim();

        // Excel may send date serial numbers (e.g., 45291, 45291.0, 45,291).
        String numericCandidate = normalized.replace(",", "");
        if (numericCandidate.matches("^\\d+(\\.\\d+)?$")) {
            try {
                double serialDouble = Double.parseDouble(numericCandidate);
                if (serialDouble > 0 && DateUtil.isValidExcelDate(serialDouble)) {
                    long serial = (long) Math.floor(serialDouble);
                    return LocalDate.of(1899, 12, 30).plusDays(serial);
                }
            } catch (NumberFormatException ignored) {
            }
        }

        List<DateTimeFormatter> formats = List.of(
                DateTimeFormatter.ISO_LOCAL_DATE,
                DateTimeFormatter.ofPattern("yyyy/MM/dd"),
                DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
                DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"),
                DateTimeFormatter.ofPattern("dd/MM/yyyy"),
                DateTimeFormatter.ofPattern("d/M/yyyy"),
                DateTimeFormatter.ofPattern("MM/dd/yyyy"),
                DateTimeFormatter.ofPattern("M/d/yyyy"),
                DateTimeFormatter.ofPattern("dd-MM-yyyy"),
                DateTimeFormatter.ofPattern("d-M-yyyy"),
                DateTimeFormatter.ofPattern("MM-dd-yyyy"),
                DateTimeFormatter.ofPattern("M-d-yyyy"),
            DateTimeFormatter.ofPattern("dd.MM.yyyy"),
            DateTimeFormatter.ofPattern("dd-MMM-yyyy", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("d-MMM-yyyy", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("dd-MMM-yy", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("d-MMM-yy", Locale.ENGLISH)
        );

        for (DateTimeFormatter format : formats) {
            try {
                return LocalDate.parse(normalized, format);
            } catch (DateTimeParseException ignored) {
            }
        }

        throw new IllegalArgumentException("invalid date_of_birth format. Use yyyy-MM-dd, dd/MM/yyyy, dd-MM-yyyy, or MM/dd/yyyy");
    }

    private String resolveStudentEmail(String requestedEmail, String enrollmentNo) {
        if (requestedEmail != null && !requestedEmail.isBlank()) {
            String normalized = requestedEmail.trim().toLowerCase(Locale.ROOT);
            if (userRepository.existsByEmail(normalized)) {
                throw new IllegalArgumentException("email already exists (" + normalized + ")");
            }
            return normalized;
        }

        String base = enrollmentNo.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        if (base.isBlank()) base = "student";
        String candidate = base + "@student.local";
        int suffix = 1;
        while (userRepository.existsByEmail(candidate)) {
            candidate = base + suffix + "@student.local";
            suffix++;
        }
        return candidate;
    }

    private String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isBlank() ? null : trimmed;
    }
}
