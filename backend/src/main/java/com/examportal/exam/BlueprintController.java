package com.examportal.exam;

import com.examportal.common.ApiResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * BlueprintController
 * CHANGE: Added DELETE /blueprints/{id} — removes blueprint if no published exam uses it.
 */
@RestController
@RequestMapping("/blueprints")
@RequiredArgsConstructor
public class BlueprintController {

    private final ExamService examService;

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<BlueprintDTO>> createBlueprint(@Valid @RequestBody BlueprintDTO dto) {
        return ResponseEntity.ok(ApiResponse.success("Blueprint created", examService.createBlueprint(dto)));
    }

    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<List<BlueprintDTO>>> getBlueprints() {
        return ResponseEntity.ok(ApiResponse.success(examService.getAllBlueprints()));
    }

    /** CHANGE: Delete blueprint by ID. Fails if any exam references this blueprint. */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<Void>> deleteBlueprint(@PathVariable Long id) {
        examService.deleteBlueprint(id);
        return ResponseEntity.ok(ApiResponse.success("Blueprint deleted", null));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<BlueprintDTO>> updateBlueprint(
            @PathVariable Long id,
            @Valid @RequestBody BlueprintDTO dto) {
        return ResponseEntity.ok(ApiResponse.success("Blueprint updated", examService.updateBlueprint(id, dto)));
    }
}
