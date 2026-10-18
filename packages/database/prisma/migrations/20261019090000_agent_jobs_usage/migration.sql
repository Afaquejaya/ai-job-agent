-- CreateEnum
CREATE TYPE "agent_message_role" AS ENUM ('user', 'assistant');

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "ai_processing_consent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "agent_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title_encrypted" BYTEA NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "agent_message_role" NOT NULL,
    "payload_encrypted" BYTEA NOT NULL,
    "model" TEXT,
    "stop_reason" TEXT,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_postings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual_paste',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_matches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "job_posting_id" UUID NOT NULL,
    "resume_id" UUID,
    "resume_version" INTEGER,
    "model" TEXT NOT NULL,
    "score" INTEGER,
    "recommendation" TEXT NOT NULL,
    "result_encrypted" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(12,6) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_conversations_user_id_updated_at_idx" ON "agent_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "agent_messages_conversation_id_created_at_idx" ON "agent_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_messages_user_id_idx" ON "agent_messages"("user_id");

-- CreateIndex
CREATE INDEX "job_postings_user_id_created_at_idx" ON "job_postings"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "job_matches_user_id_job_posting_id_created_at_idx" ON "job_matches"("user_id", "job_posting_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_user_id_created_at_idx" ON "ai_usage_records"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Hand-written: rules Prisma's schema language cannot express.
-- -----------------------------------------------------------------------------

-- The same job link can only be saved once per user (links are optional).
CREATE UNIQUE INDEX "job_postings_one_url_per_user" ON "job_postings"("user_id", "url") WHERE "url" IS NOT NULL;

ALTER TABLE "job_postings"
  ADD CONSTRAINT "job_postings_description_length" CHECK (char_length("description") BETWEEN 200 AND 30000),
  ADD CONSTRAINT "job_postings_url_http" CHECK ("url" IS NULL OR "url" ~* '^https?://');

ALTER TABLE "job_matches"
  ADD CONSTRAINT "job_matches_score_range" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "job_matches_recommendation" CHECK ("recommendation" IN
    ('strong', 'possible', 'weak', 'ineligible', 'insufficient_information'));

ALTER TABLE "ai_usage_records"
  ADD CONSTRAINT "ai_usage_records_non_negative" CHECK (
    "input_tokens" >= 0 AND "output_tokens" >= 0 AND "cache_read_tokens" >= 0 AND
    "cache_write_tokens" >= 0 AND "estimated_cost_usd" >= 0);

ALTER TABLE "agent_messages"
  ADD CONSTRAINT "agent_messages_step_count" CHECK ("step_count" >= 0);
