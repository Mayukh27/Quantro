package com.examportal.prefetch;

import com.examportal.config.PrefetchProperties;
import com.examportal.question.QuestionImageRepository;
import com.examportal.question.QuestionOptionImageRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

@Slf4j
@Service
@RequiredArgsConstructor
public class ImagePrefetchService {

    private final PrefetchProperties properties;
    private final QuestionImageRepository questionImageRepository;
    private final QuestionOptionImageRepository optionImageRepository;

    public void prefetchExamImagesAsync(Long examId, List<Long> questionIds) {
        if (!properties.isEnabled()) return;
        if (questionIds == null || questionIds.isEmpty()) return;

        CompletableFuture.runAsync(() -> prefetchExamImages(examId, questionIds));
    }

    private void prefetchExamImages(Long examId, List<Long> questionIds) {
        String baseUrl = normalizeBaseUrl(properties.getBaseUrl());
        if (baseUrl == null) {
            log.warn("Prefetch skipped: baseUrl is blank (examId={})", examId);
            return;
        }

        List<String> urls = buildImageUrls(baseUrl, questionIds);
        if (urls.isEmpty()) {
            log.info("Prefetch skipped: no images for examId={}", examId);
            return;
        }

        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getConnectTimeoutMs()))
                .build();

        int maxConcurrency = Math.max(1, properties.getMaxConcurrency());
        AtomicInteger success = new AtomicInteger();
        AtomicInteger failed = new AtomicInteger();

        for (int i = 0; i < urls.size(); i += maxConcurrency) {
            List<CompletableFuture<Void>> batch = new ArrayList<>();
            int end = Math.min(urls.size(), i + maxConcurrency);

            for (int j = i; j < end; j++) {
                String url = urls.get(j);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofMillis(properties.getReadTimeoutMs()))
                        .GET()
                        .build();

                batch.add(client.sendAsync(request, HttpResponse.BodyHandlers.discarding())
                        .thenAccept(res -> success.incrementAndGet())
                        .exceptionally(ex -> {
                            failed.incrementAndGet();
                            return null;
                        }));
            }

            CompletableFuture.allOf(batch.toArray(new CompletableFuture[0])).join();
        }

        log.info("Prefetch complete for examId={} (urls={}, ok={}, failed={})",
                examId, urls.size(), success.get(), failed.get());
    }

    private List<String> buildImageUrls(String baseUrl, List<Long> questionIds) {
        List<String> urls = new ArrayList<>();

        for (Long questionId : questionIds) {
            if (questionId == null) continue;

            Boolean hasQuestionImage = questionImageRepository.hasQuestionImage(questionId);
            if (Boolean.TRUE.equals(hasQuestionImage)) {
                urls.add(baseUrl + "/questions/" + questionId + "/image");
            }

            Boolean hasCombined = questionImageRepository.hasCombinedOptionImage(questionId);
            if (Boolean.TRUE.equals(hasCombined)) {
                urls.add(baseUrl + "/questions/" + questionId + "/combined-option-image");
            }

            List<Integer> optionIndexes = optionImageRepository.findOptionIndexes(questionId);
            if (optionIndexes != null && !optionIndexes.isEmpty()) {
                for (Integer idx : optionIndexes) {
                    if (idx == null) continue;
                    urls.add(baseUrl + "/questions/" + questionId + "/option-image/" + idx);
                }
            }
        }

        return urls;
    }

    private String normalizeBaseUrl(String raw) {
        if (raw == null) return null;
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return null;
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }
}
