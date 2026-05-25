package com.examportal.user;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    Optional<User> findByEnrollmentNo(String enrollmentNo);
    Optional<User> findByEmailOrEnrollmentNo(String email, String enrollmentNo);
    boolean existsByEmail(String email);
    boolean existsByEnrollmentNo(String enrollmentNo);
    List<User> findByRole(Role role);
    Page<User> findByRoleAndApproved(Role role, boolean approved, Pageable pageable);
    long countByRole(Role role);
}
