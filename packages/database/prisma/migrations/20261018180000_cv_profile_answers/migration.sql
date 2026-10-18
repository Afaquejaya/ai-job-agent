-- CreateEnum
CREATE TYPE "resume_extraction_status" AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "profile_answer_status" AS ENUM ('DRAFT', 'VERIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "profile_answer_source" AS ENUM ('USER_ENTERED', 'PROFILE_FIELD', 'CV_SUGGESTION_CONFIRMED');

-- AlterTable
-- Hand-edited: rename instead of drop + add, so existing summary text is kept.
ALTER TABLE "candidate_profiles" RENAME COLUMN "summary" TO "professional_summary";

-- headline is not part of the Phase 2B profile (current_role replaces it).
ALTER TABLE "candidate_profiles" DROP COLUMN "headline",
ADD COLUMN     "certifications" JSONB,
ADD COLUMN     "current_location" JSONB,
ADD COLUMN     "current_role" TEXT,
ADD COLUMN     "education" JSONB,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "employment_preferences" JSONB,
ADD COLUMN     "expected_salary" DECIMAL(12,2),
ADD COLUMN     "full_name" TEXT,
ADD COLUMN     "languages" JSONB,
ADD COLUMN     "notice_period" JSONB,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "preferred_locations" JSONB,
ADD COLUMN     "preferred_name" TEXT,
ADD COLUMN     "salary_currency" CHAR(3),
ADD COLUMN     "skills" JSONB,
ADD COLUMN     "total_experience_months" INTEGER,
ADD COLUMN     "work_authorization" JSONB,
ADD COLUMN     "work_experience" JSONB;

-- CreateTable
CREATE TABLE "resumes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "original_filename" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "extraction_status" "resume_extraction_status" NOT NULL DEFAULT 'UPLOADED',
    "extracted_text_encrypted" BYTEA,
    "parsed_profile_encrypted" BYTEA,
    "extraction_error" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "page_count" INTEGER,
    "text_char_count" INTEGER,
    "text_truncated" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_answers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "question_key" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer_type" TEXT NOT NULL,
    "answer_value" JSONB NOT NULL,
    "source" "profile_answer_source" NOT NULL DEFAULT 'USER_ENTERED',
    "status" "profile_answer_status" NOT NULL DEFAULT 'DRAFT',
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resumes_storage_key_key" ON "resumes"("storage_key");

-- CreateIndex
CREATE INDEX "resumes_user_id_created_at_idx" ON "resumes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "resumes_user_id_checksum_key" ON "resumes"("user_id", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "resumes_user_id_version_key" ON "resumes"("user_id", "version");

-- CreateIndex
CREATE INDEX "profile_answers_user_id_status_idx" ON "profile_answers"("user_id", "status");

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_answers" ADD CONSTRAINT "profile_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Hand-written: rules Prisma's schema language cannot express. They back up the Zod
-- validation in @job-agent/shared (defence in depth).
-- -----------------------------------------------------------------------------

ALTER TABLE "candidate_profiles"
  ADD CONSTRAINT "candidate_profiles_experience_range"
    CHECK ("total_experience_months" IS NULL OR "total_experience_months" BETWEEN 0 AND 720),
  ADD CONSTRAINT "candidate_profiles_salary_non_negative"
    CHECK ("expected_salary" IS NULL OR "expected_salary" >= 0),
  ADD CONSTRAINT "candidate_profiles_salary_currency_format"
    CHECK ("salary_currency" IS NULL OR "salary_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "candidate_profiles_salary_needs_currency"
    CHECK ("expected_salary" IS NULL OR "salary_currency" IS NOT NULL),
  ADD CONSTRAINT "candidate_profiles_json_arrays" CHECK (
    ("preferred_locations" IS NULL OR jsonb_typeof("preferred_locations") = 'array') AND
    ("education" IS NULL OR jsonb_typeof("education") = 'array') AND
    ("work_experience" IS NULL OR jsonb_typeof("work_experience") = 'array') AND
    ("skills" IS NULL OR jsonb_typeof("skills") = 'array') AND
    ("certifications" IS NULL OR jsonb_typeof("certifications") = 'array') AND
    ("languages" IS NULL OR jsonb_typeof("languages") = 'array') AND
    ("work_authorization" IS NULL OR jsonb_typeof("work_authorization") = 'array')
  ),
  ADD CONSTRAINT "candidate_profiles_json_objects" CHECK (
    ("current_location" IS NULL OR jsonb_typeof("current_location") = 'object') AND
    ("notice_period" IS NULL OR jsonb_typeof("notice_period") = 'object') AND
    ("employment_preferences" IS NULL OR jsonb_typeof("employment_preferences") = 'object')
  );

ALTER TABLE "resumes"
  ADD CONSTRAINT "resumes_file_size_range"
    CHECK ("file_size_bytes" > 0 AND "file_size_bytes" <= 10485760),
  ADD CONSTRAINT "resumes_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "resumes_checksum_sha256" CHECK ("checksum" ~ '^[0-9a-f]{64}$');

-- At most one primary resume per user.
CREATE UNIQUE INDEX "resumes_one_primary_per_user" ON "resumes"("user_id") WHERE "is_primary";

ALTER TABLE "profile_answers"
  ADD CONSTRAINT "profile_answers_answer_type" CHECK ("answer_type" IN
    ('text', 'long_text', 'number', 'boolean', 'single_select', 'multi_select', 'date', 'money', 'url')),
  ADD CONSTRAINT "profile_answers_value_object" CHECK (jsonb_typeof("answer_value") = 'object'),
  ADD CONSTRAINT "profile_answers_verified_consistent"
    CHECK (("status" = 'VERIFIED') = ("verified_at" IS NOT NULL));

-- One active (non-archived) answer per question key per user.
CREATE UNIQUE INDEX "profile_answers_one_active_per_key"
  ON "profile_answers"("user_id", "question_key") WHERE "status" <> 'ARCHIVED';
