package com.examportal.user;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * UserDTO - Safe user representation for API responses. Never exposes password.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserDTO {
    private Long id;
    private String email;
    private String enrollmentNo;
    private String fullName;
    private String stream;
    private String section;
    private String studentYear;
    private String classRollNo;
    private LocalDate dateOfBirth;
    private Role role;
    private boolean approved;
    private LocalDateTime createdAt;
}
