package com.examportal.auth;

import com.examportal.user.Role;
import com.examportal.user.User;
import com.examportal.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/**
 * AuthService - Authentication business logic.
 * Register: hashes password, creates user. Teachers default to unapproved.
 * Login: delegates to Spring Security AuthenticationManager, then issues JWT.
 */
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    public AuthResponse register(RegisterRequest request) {
        validateRegisterRequest(request);

        // Students and admins are auto-approved; teachers require admin approval
        boolean autoApproved = request.getRole() != Role.TEACHER;

        String normalizedEmail = resolveEmail(request);
        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new IllegalArgumentException("Email is already registered");
        }

        if (request.getRole() == Role.STUDENT && userRepository.existsByEnrollmentNo(request.getEnrollmentNo())) {
            throw new IllegalArgumentException("Enrollment number is already registered");
        }

        String rawPassword = resolveRawPassword(request);

        User user = User.builder()
                .email(normalizedEmail)
                .password(passwordEncoder.encode(rawPassword))
                .fullName(request.getFullName().trim())
                .enrollmentNo(trimToNull(request.getEnrollmentNo()))
                .stream(trimToNull(request.getStream()))
                .section(trimToNull(request.getSection()))
            .studentYear(trimToNull(request.getStudentYear()))
                .classRollNo(trimToNull(request.getClassRollNo()))
                .dateOfBirth(request.getDateOfBirth())
                .role(request.getRole())
                .approved(autoApproved)
                .build();
        userRepository.save(user);

        return AuthResponse.builder()
                .token(jwtService.generateToken(user))
                .userId(user.getId())
                .email(user.getEmail())
                .enrollmentNo(user.getEnrollmentNo())
                .fullName(user.getFullName())
            .studentYear(user.getStudentYear())
                .role(user.getRole())
                .approved(user.isApproved())
                .build();
    }

    public AuthResponse login(LoginRequest request) {
            String identifier = request.getIdentifier() == null ? "" : request.getIdentifier().trim();
            if (identifier.isBlank()) {
                throw new IllegalArgumentException("Email or enrollment number is required");
            }

            User user = userRepository.findByEmail(identifier)
                .or(() -> userRepository.findByEnrollmentNo(identifier))
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

            String passwordInput = normalizeStudentPasswordInput(user, request.getPassword());

        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                    user.getEmail(),
                    passwordInput
                )
        );

        if (Boolean.TRUE.equals(user.getLoggedIn()) && user.getSessionToken() != null) {
            throw new IllegalStateException("User already logged in from another device");
        }

        if (user.getRole() == Role.TEACHER && !user.isApproved()) {
            throw new IllegalStateException("Your teacher account is pending admin approval");
        }

        String sessionToken = java.util.UUID.randomUUID().toString();

        user.setLoggedIn(true);
        user.setSessionToken(sessionToken);
        userRepository.save(user);

        return AuthResponse.builder()
                .token(jwtService.generateToken(user))
                .sessionToken(sessionToken)
                .userId(user.getId())
                .email(user.getEmail())
                .enrollmentNo(user.getEnrollmentNo())
                .fullName(user.getFullName())
            .studentYear(user.getStudentYear())
                .role(user.getRole())
                .approved(user.isApproved())
                .build();
    }

    private void validateRegisterRequest(RegisterRequest request) {
        if (request.getRole() == null) {
            throw new IllegalArgumentException("Role is required");
        }
        if (request.getFullName() == null || request.getFullName().isBlank()) {
            throw new IllegalArgumentException("Full name is required");
        }

        if (request.getRole() == Role.STUDENT) {
            if (request.getEnrollmentNo() == null || request.getEnrollmentNo().isBlank()) {
                throw new IllegalArgumentException("Enrollment number is required for students");
            }
            if (request.getDateOfBirth() == null) {
                throw new IllegalArgumentException("Date of birth is required for students");
            }
            if (request.getStream() == null || request.getStream().isBlank()) {
                throw new IllegalArgumentException("Stream is required for students");
            }
            if (request.getSection() == null || request.getSection().isBlank()) {
                throw new IllegalArgumentException("Section is required for students");
            }
            if (request.getStudentYear() == null || request.getStudentYear().isBlank()) {
                throw new IllegalArgumentException("Year is required for students");
            }
            if (request.getClassRollNo() == null || request.getClassRollNo().isBlank()) {
                throw new IllegalArgumentException("Class roll number is required for students");
            }
            return;
        }

        if (request.getEmail() == null || request.getEmail().isBlank()) {
            throw new IllegalArgumentException("Email is required");
        }
        if (request.getPassword() == null || request.getPassword().length() < 8) {
            throw new IllegalArgumentException("Password must be at least 8 characters");
        }
    }

    private String resolveEmail(RegisterRequest request) {
        if (request.getRole() != Role.STUDENT) {
            return request.getEmail().trim().toLowerCase(Locale.ROOT);
        }

        if (request.getEmail() != null && !request.getEmail().isBlank()) {
            return request.getEmail().trim().toLowerCase(Locale.ROOT);
        }

        String base = request.getEnrollmentNo().trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        if (base.isBlank()) {
            base = "student";
        }

        String email = base + "@student.local";
        int suffix = 1;
        while (userRepository.existsByEmail(email)) {
            email = base + suffix + "@student.local";
            suffix++;
        }
        return email;
    }

    private String resolveRawPassword(RegisterRequest request) {
        if (request.getRole() == Role.STUDENT) {
            LocalDate dob = request.getDateOfBirth();
            return dob.format(DateTimeFormatter.ofPattern("ddMMyyyy"));
        }
        return request.getPassword();
    }

    private String normalizeStudentPasswordInput(User user, String inputPassword) {
        if (user.getRole() != Role.STUDENT || inputPassword == null) {
            return inputPassword;
        }

        String raw = inputPassword.trim();
        if (raw.isBlank()) {
            return raw;
        }

        if (raw.matches("^\\d{8}$")) {
            return raw;
        }

        return raw;
    }

    private String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isBlank() ? null : trimmed;
    }
}