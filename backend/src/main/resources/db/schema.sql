-- Online Examination Portal - PostgreSQL Reference Schema
-- JPA (ddl-auto=update) auto-creates these tables.
-- Use this file for manual inspection, initial setup, or migrations.

CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    full_name   VARCHAR(255) NOT NULL,
    enrollment_no VARCHAR(100) UNIQUE,
    stream      VARCHAR(255),
    section     VARCHAR(100),
    class_roll_no VARCHAR(100),
    date_of_birth DATE,
    role        VARCHAR(20)  NOT NULL CHECK (role IN ('ADMIN','TEACHER','STUDENT')),
    approved    BOOLEAN      NOT NULL DEFAULT FALSE,
    enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP,
    updated_at  TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subjects (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    code        VARCHAR(50)  NOT NULL,
    created_at  TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
    id                   BIGSERIAL PRIMARY KEY,
    subject_id           BIGINT NOT NULL REFERENCES subjects(id),
    uploaded_by          BIGINT REFERENCES users(id),
    question_text        TEXT NOT NULL,
    correct_option_index INT  NOT NULL,
    difficulty           VARCHAR(10) DEFAULT 'MEDIUM',
    marks                INT DEFAULT 1,
    negative_marks       DOUBLE PRECISION DEFAULT 0.25,
    active               BOOLEAN DEFAULT TRUE,
    created_at           TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_options (
    question_id  BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_text  TEXT   NOT NULL,
    option_index INT    NOT NULL,
    PRIMARY KEY (question_id, option_index)
);

CREATE TABLE IF NOT EXISTS exam_blueprints (
    id               BIGSERIAL PRIMARY KEY,
    name             VARCHAR(255) NOT NULL,
    description      TEXT,
    duration_minutes INT NOT NULL,
    total_marks      INT,
    option_shuffle   BOOLEAN DEFAULT TRUE,
    created_at       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blueprint_entries (
    id                 BIGSERIAL PRIMARY KEY,
    blueprint_id       BIGINT NOT NULL REFERENCES exam_blueprints(id) ON DELETE CASCADE,
    subject_id         BIGINT NOT NULL,
    question_count     INT    NOT NULL,
    marks_per_question INT
);

CREATE TABLE IF NOT EXISTS exams (
    id                  BIGSERIAL PRIMARY KEY,
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    blueprint_id        BIGINT REFERENCES exam_blueprints(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    scheduled_start     TIMESTAMP NOT NULL,
    scheduled_end       TIMESTAMP NOT NULL,
    duration_minutes    INT NOT NULL,
    master_question_ids TEXT,
    created_at          TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_attempts (
    id                BIGSERIAL PRIMARY KEY,
    student_id        BIGINT NOT NULL REFERENCES users(id),
    exam_id           BIGINT NOT NULL REFERENCES exams(id),
    status            VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    question_order    TEXT,
    option_order      TEXT,
    answers           TEXT DEFAULT '{}',
    marked_for_review TEXT DEFAULT '[]',
    server_start_time TIMESTAMP,
    submitted_at      TIMESTAMP,
    score             DOUBLE PRECISION,
    violation_count   INT DEFAULT 0,
    -- FEATURE: Fullscreen Exam Fix
    -- Tracks fullscreen exits separately so they can be warned rather than immediately auto-submitted
    fullscreen_exit_count INT DEFAULT 0,
    UNIQUE (student_id, exam_id)
);

CREATE TABLE IF NOT EXISTS evaluation_results (
    id                      BIGSERIAL PRIMARY KEY,
    attempt_id              BIGINT UNIQUE NOT NULL,
    student_id              BIGINT,
    exam_id                 BIGINT,
    total_score             DOUBLE PRECISION,
    total_questions         INT,
    attempted               INT,
    correct                 INT,
    wrong                   INT,
    unattempted             INT,
    subject_wise_breakdown  TEXT,
    violation_summary       TEXT DEFAULT '[]',
    evaluated_at            TIMESTAMP
);

CREATE TABLE IF NOT EXISTS violation_logs (
    id             BIGSERIAL PRIMARY KEY,
    attempt_id     BIGINT      NOT NULL,
    student_id     BIGINT      NOT NULL,
    violation_type VARCHAR(30) NOT NULL,
    details        TEXT,
    occurred_at    TIMESTAMP
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_questions_subject    ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student     ON exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam        ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_results_student      ON evaluation_results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_exam         ON evaluation_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_violations_attempt   ON violation_logs(attempt_id);
CREATE INDEX IF NOT EXISTS idx_exams_status         ON exams(status);


-- ═══════════════════════════════════════════════════════════════════════
-- CHANGES: Migration additions
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Subject Code = Subject ID: ensure code column is unique
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS code VARCHAR(50);
UPDATE subjects SET code = CAST(id AS VARCHAR) WHERE code IS NULL;
ALTER TABLE subjects ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_code ON subjects(code);

-- 2. Fullscreen exit counter on exam_attempts
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS fullscreen_exit_count INT DEFAULT 0;

-- 3. Blueprint delete guard (no schema change — handled in service layer)

-- 3b. Blueprint option shuffle toggle
ALTER TABLE exam_blueprints
    ADD COLUMN IF NOT EXISTS option_shuffle BOOLEAN NOT NULL DEFAULT TRUE;

-- 4. New violation types (enum stored as VARCHAR — no migration needed, new values
--    MOUSE_LEAVE and DEVTOOLS_OPEN are auto-handled by PostgreSQL VARCHAR column)

-- 5. Question cascade delete (handled by @Modifying JPA query in SubjectService)

-- Indexes for result queries
CREATE INDEX IF NOT EXISTS idx_eval_results_exam_score ON evaluation_results(exam_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_eval_results_student_date ON evaluation_results(student_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_exams_blueprint ON exams(blueprint_id);

-- CHANGE: Multi-subject sections
-- Migrate blueprint_entries: rename subjectId -> subjectIds (CSV), add sectionName, negativeMarks
ALTER TABLE blueprint_entries ADD COLUMN IF NOT EXISTS section_name VARCHAR(255) DEFAULT 'Section';
ALTER TABLE blueprint_entries ADD COLUMN IF NOT EXISTS subject_ids VARCHAR(500);
ALTER TABLE blueprint_entries ADD COLUMN IF NOT EXISTS negative_marks DOUBLE PRECISION DEFAULT 0.25;
-- Copy existing single subjectId into subjectIds CSV column for existing rows
UPDATE blueprint_entries SET subject_ids = CAST(subject_id AS VARCHAR) WHERE subject_ids IS NULL AND subject_id IS NOT NULL;

-- CHANGE: masterSectionMap column on exams table
ALTER TABLE exams ADD COLUMN IF NOT EXISTS master_section_map TEXT;

-- FIX: Drop NOT NULL constraint on subject_id so new multi-subject entries
--      (which use subject_ids CSV instead) can insert NULL for legacy column.
ALTER TABLE blueprint_entries ALTER COLUMN subject_id DROP NOT NULL;

-- Ensure new columns exist
ALTER TABLE blueprint_entries ADD COLUMN IF NOT EXISTS section_name VARCHAR(255) NOT NULL DEFAULT 'Section';
ALTER TABLE blueprint_entries ADD COLUMN IF NOT EXISTS subject_ids  VARCHAR(500);
ALTER TABLE blueprint_entries ADD COLUMN IF NOT EXISTS negative_marks DOUBLE PRECISION DEFAULT 0.25;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_logged_in BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS session_token VARCHAR(255);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS enrollment_no VARCHAR(100),
ADD COLUMN IF NOT EXISTS stream VARCHAR(255),
ADD COLUMN IF NOT EXISTS section VARCHAR(100),
ADD COLUMN IF NOT EXISTS class_roll_no VARCHAR(100),
ADD COLUMN IF NOT EXISTS date_of_birth DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_enrollment_no ON users(enrollment_no);

-- Backfill subject_ids from subject_id for any existing rows
UPDATE blueprint_entries
SET subject_ids = CAST(subject_id AS VARCHAR)
WHERE subject_ids IS NULL AND subject_id IS NOT NULL;
-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION: Image support for questions and options
-- Run once against existing databases. Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- For fresh installs: JPA ddl-auto=update will create these automatically from the entities.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Add image columns to the questions table
ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS question_image      BYTEA,
    ADD COLUMN IF NOT EXISTS question_image_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS combined_option_image BYTEA,
    ADD COLUMN IF NOT EXISTS combined_option_image_type VARCHAR(50);

-- 1b. Dedicated question images table (preferred storage)
CREATE TABLE IF NOT EXISTS question_images (
    id                         BIGSERIAL PRIMARY KEY,
    question_id                BIGINT UNIQUE NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    question_image             BYTEA,
    question_image_type        VARCHAR(50),
    combined_option_image      BYTEA,
    combined_option_image_type VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_question_images_question ON question_images(question_id);

-- Backfill legacy image columns from questions table into question_images
INSERT INTO question_images (
    question_id,
    question_image,
    question_image_type,
    combined_option_image,
    combined_option_image_type
)
SELECT
    q.id,
    q.question_image,
    q.question_image_type,
    q.combined_option_image,
    q.combined_option_image_type
FROM questions q
WHERE (q.question_image IS NOT NULL OR q.combined_option_image IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1
      FROM question_images qi
      WHERE qi.question_id = q.id
  );

-- combined_option image columns are redundant in questions now that question_images
-- is the single source of truth.
ALTER TABLE questions
    DROP COLUMN IF EXISTS combined_option_image,
    DROP COLUMN IF EXISTS combined_option_image_type;

-- 2. Create the option-images table
--    Each row stores the image for one option slot of one question.
--    (question_id, option_index) is unique — one image per slot.
CREATE TABLE IF NOT EXISTS question_option_images (
    id           BIGSERIAL PRIMARY KEY,
    question_id  BIGINT      NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_index INT         NOT NULL,
    image_data   BYTEA       NOT NULL,
    image_type   VARCHAR(50) NOT NULL,
    UNIQUE (question_id, option_index)
);

-- Index for fast lookup by question
CREATE INDEX IF NOT EXISTS idx_option_images_question ON question_option_images(question_id);
