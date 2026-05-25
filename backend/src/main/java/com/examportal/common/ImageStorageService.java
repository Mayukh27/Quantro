package com.examportal.common;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

@Service
public class ImageStorageService {
    private static final Logger log = LoggerFactory.getLogger(ImageStorageService.class);

    @Value("${image.storage.path:images}")
    private String storagePath;

    @PostConstruct
    public void init() {
        String path = (storagePath == null || storagePath.isBlank()) ? "images" : storagePath;
        storagePath = path;
        try {
            Files.createDirectories(Paths.get(storagePath));
        } catch (IOException e) {
            log.error("Failed to create image storage directory", e);
        }
    }

    public String saveImage(MultipartFile file, String category, Long id, String suffix) throws IOException {
        if (file == null || file.isEmpty()) {
            return null;
        }

        String safeCategory = (category == null || category.isBlank()) ? "image" : category;
        String safeSuffix = (suffix == null || suffix.isBlank()) ? "image" : suffix;
        String categoryPath = safeCategory + "/" + id;

        Path dirPath = Paths.get(storagePath, categoryPath);
        Files.createDirectories(dirPath);

        String ext = getFileExtension(file.getOriginalFilename());
        String filename = ext.isEmpty() ? safeSuffix : safeSuffix + "." + ext;

        Path filePath = dirPath.resolve(filename);
        file.transferTo(filePath.toFile());
        log.info("Image saved: {}", filePath);

        return categoryPath + "/" + filename;
    }

    public byte[] getImage(String relativePath) throws IOException {
        Path path = Paths.get(storagePath, relativePath);
        if (!Files.exists(path)) {
            throw new IOException("Image not found: " + relativePath);
        }
        return Files.readAllBytes(path);
    }

    public void deleteImage(String relativePath) throws IOException {
        Path path = Paths.get(storagePath, relativePath);
        Files.delete(path);
    }

    public String getMimeType(String relativePath) {
        String ext = getFileExtension(relativePath).toLowerCase();
        return switch (ext) {
            case "jpg", "jpeg" -> "image/jpeg";
            case "png" -> "image/png";
            case "gif" -> "image/gif";
            case "webp" -> "image/webp";
            default -> "application/octet-stream";
        };
    }

    private String getFileExtension(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "";
        }
        return filename.substring(filename.lastIndexOf('.') + 1);
    }
}
