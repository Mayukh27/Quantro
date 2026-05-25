package com.examportal.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * PrefetchProperties - Controls image prefetch behavior after exam publish.
 */
@ConfigurationProperties(prefix = "prefetch")
@Data
public class PrefetchProperties {
    /** Enable/disable image prefetch at publish time. */
    private boolean enabled = true;

    /** Base URL pointing to nginx (or public) endpoint. */
    private String baseUrl = "http://localhost:8081";

    /** Connection timeout for prefetch HTTP calls. */
    private int connectTimeoutMs = 2000;

    /** Read timeout for prefetch HTTP calls. */
    private int readTimeoutMs = 10000;

    /** Max concurrent requests per batch. */
    private int maxConcurrency = 4;
}
