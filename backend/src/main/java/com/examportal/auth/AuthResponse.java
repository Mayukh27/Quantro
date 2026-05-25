package com.examportal.auth;

import com.examportal.user.Role;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AuthResponse {
    private String token;
    private Long userId;
    private String email;
    private String enrollmentNo;
    private String fullName;
    private String studentYear;
    private Role role;
    private boolean approved;
    private String sessionToken;
}
