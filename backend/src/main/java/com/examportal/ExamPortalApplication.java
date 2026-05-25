package com.examportal;

import io.github.cdimascio.dotenv.Dotenv;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ExamPortalApplication {
    public static void main(String[] args) {

        Dotenv dotenv = Dotenv.load();

        setIfPresent(dotenv, "JWT_SECRET");
        setIfPresent(dotenv, "DB_URL");
        setIfPresent(dotenv, "DB_USERNAME");
        setIfPresent(dotenv, "DB_PASSWORD");
        setIfPresent(dotenv, "MAIL_USERNAME");
        setIfPresent(dotenv, "MAIL_PASSWORD");

        setIfPresent(dotenv, "PREFETCH_ENABLED");
        setIfPresent(dotenv, "PREFETCH_BASE_URL");
        setIfPresent(dotenv, "PREFETCH_CONNECT_TIMEOUT_MS");
        setIfPresent(dotenv, "PREFETCH_READ_TIMEOUT_MS");
        setIfPresent(dotenv, "PREFETCH_MAX_CONCURRENCY");

        SpringApplication.run(ExamPortalApplication.class, args);
    }

    private static void setIfPresent(Dotenv dotenv, String key) {
        String value = dotenv.get(key);
        if (value != null && !value.isBlank()) {
            System.setProperty(key, value);
        }
    }
}