package com.examportal.user;

import jakarta.persistence.*;
import lombok.*;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

/**
 * User - Central user entity; implements Spring Security UserDetails so it can be
 * used directly in the authentication pipeline without a wrapper.
 * Teachers start with approved=false and cannot log in until admin approves them.
 */
@Entity
@Table(name = "users")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class User implements UserDetails {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(nullable = false)
    private String password;

    @Column(nullable = false)
    private String fullName;

    @Column(name = "enrollment_no", unique = true)
    private String enrollmentNo;

    private String stream;

    private String section;

    @Column(name = "student_year")
    private String studentYear;

    @Column(name = "class_roll_no")
    private String classRollNo;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    /** Relevant for TEACHER role only. Admin must set to true before teacher can log in. */
    @Builder.Default
    private boolean approved = false;

    @Builder.Default
    private boolean enabled = true;

    @Column(updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @Builder.Default
    @Column(name = "is_logged_in")
    private Boolean LoggedIn = false;

    @Column(name = "session_token", length = 255)
    private String sessionToken;

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    // ── Spring Security UserDetails ──────────────────────────────────────

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override public String getUsername() { return email; }
    @Override public boolean isAccountNonExpired() { return true; }
    @Override public boolean isAccountNonLocked() { return true; }
    @Override public boolean isCredentialsNonExpired() { return true; }
    @Override public boolean isEnabled() { return enabled; }
}
