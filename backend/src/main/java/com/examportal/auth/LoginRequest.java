package com.examportal.auth;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class LoginRequest {
    @NotBlank
    @JsonAlias({"email", "username", "enrollmentNo"})
    private String identifier;

    @NotBlank
    private String password;
}
