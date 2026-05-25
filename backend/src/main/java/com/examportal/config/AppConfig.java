package com.examportal.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * AppConfig - Root configuration. Enables ConfigurationProperties binding.
 */
@Configuration
@EnableConfigurationProperties({FeatureFlags.class, PrefetchProperties.class})
public class AppConfig {
}
