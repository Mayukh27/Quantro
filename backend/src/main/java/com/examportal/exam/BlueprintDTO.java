package com.examportal.exam;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BlueprintDTO {
    private Long id;
    private String name;
    private String description;
    private Integer durationMinutes;
    private Integer totalMarks;
    private Boolean optionShuffle;
    private List<BlueprintEntryDTO> entries;
}
