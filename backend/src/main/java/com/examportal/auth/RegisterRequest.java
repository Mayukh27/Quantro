package com.examportal.auth;

import com.examportal.user.Role;
import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.time.LocalDate;

@Data
public class RegisterRequest {
    @Email
    private String email;

    private String password;

    private String fullName;

    private String enrollmentNo;
    private String stream;
    private String section;
    private String studentYear;
    private String classRollNo;

    @JsonFormat(pattern = "yyyy-MM-dd")
    private LocalDate dateOfBirth;

    @NotNull
    private Role role;
}
