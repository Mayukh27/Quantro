package com.examportal.user;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/**
 * UserService - Implements Spring Security UserDetailsService.
 * Loads user by email or enrollment number for JWT authentication chain.
 * Also exposes helper methods used by other services.
 */
@Service
@RequiredArgsConstructor
public class UserService implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    public UserDetails loadUserByUsername(String identifier) throws UsernameNotFoundException {
        return userRepository.findByEmail(identifier)
            .or(() -> userRepository.findByEnrollmentNo(identifier))
            .orElseThrow(() -> new UsernameNotFoundException("User not found: " + identifier));
    }

    public User findById(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("User not found with id: " + id));
    }

    public User findByEmail(String email) {
        return userRepository.findByEmail(email)
            .orElseThrow(() -> new IllegalArgumentException("User not found with email: " + email));
    }
}
