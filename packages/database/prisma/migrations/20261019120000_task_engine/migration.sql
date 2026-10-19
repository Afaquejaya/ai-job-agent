-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "parent_task_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "deadline_at" TIMESTAMPTZ(3),
    "next_run_at" TIMESTAMPTZ(3),
    "lease_expires_at" TIMESTAMPTZ(3),
    "cancel_requested_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "failure_kind" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_attempts" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "outcome" TEXT NOT NULL DEFAULT 'running',
    "failure_kind" TEXT,

    CONSTRAINT "task_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_checkpoints" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "external_action_dispatched_at" TIMESTAMPTZ(3),
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_tasks_user_id_created_at_idx" ON "agent_tasks"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_tasks_state_next_run_at_idx" ON "agent_tasks"("state", "next_run_at");

-- CreateIndex
CREATE INDEX "agent_tasks_state_lease_expires_at_idx" ON "agent_tasks"("state", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tasks_user_id_idempotency_key_key" ON "agent_tasks"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "task_events_task_id_created_at_idx" ON "task_events"("task_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_attempts_task_id_step_attempt_key" ON "task_attempts"("task_id", "step", "attempt");

-- CreateIndex
CREATE INDEX "task_checkpoints_task_id_created_at_idx" ON "task_checkpoints"("task_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "agent_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checkpoints" ADD CONSTRAINT "task_checkpoints_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checkpoints" ADD CONSTRAINT "task_checkpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Hand-written: the database enforces the task engine's invariants even if application code
-- is bypassed. States and kinds mirror packages/agent-core (task-state.ts, task.ts).
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "agent_tasks"
  ADD CONSTRAINT "agent_tasks_state" CHECK ("state" IN (
    'QUEUED', 'RUNNING', 'PLANNING', 'SEARCHING', 'NORMALIZING', 'MATCHING', 'PREPARING',
    'POLICY_CHECK', 'AWAITING_APPROVAL', 'READY_TO_SUBMIT', 'SUBMITTING', 'VERIFYING',
    'SUBMITTED', 'MANUAL_HANDOFF', 'NEEDS_REVIEW', 'RETRY_WAIT', 'COMPLETED', 'FAILED',
    'REJECTED', 'CANCELLED')),
  ADD CONSTRAINT "agent_tasks_kind" CHECK ("kind" IN (
    'job_match_analysis', 'cv_processing', 'daily_discovery', 'job_application', 'cv_analysis',
    'email_outreach', 'morning_report')),
  ADD CONSTRAINT "agent_tasks_counters" CHECK (
    "failed_attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "version" >= 1),
  ADD CONSTRAINT "agent_tasks_input_object" CHECK (jsonb_typeof("input") = 'object'),
  ADD CONSTRAINT "agent_tasks_idempotency_key_length" CHECK (char_length("idempotency_key") BETWEEN 1 AND 200),
  -- Only a task a worker is working on holds a lease.
  ADD CONSTRAINT "agent_tasks_lease_only_when_active" CHECK (
    "lease_expires_at" IS NULL OR "state" IN ('RUNNING', 'SUBMITTING', 'VERIFYING')),
  ADD CONSTRAINT "agent_tasks_no_self_parent" CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id");

ALTER TABLE "task_attempts"
  ADD CONSTRAINT "task_attempts_outcome" CHECK (
    "outcome" IN ('running', 'succeeded', 'failed', 'cancelled', 'abandoned')),
  ADD CONSTRAINT "task_attempts_number" CHECK ("attempt" >= 1),
  ADD CONSTRAINT "task_attempts_finished" CHECK (("outcome" = 'running') = ("finished_at" IS NULL));

-- The timeline is history: it can be added to, never edited. (Rows go away only with their
-- task, e.g. when the account is deleted.)
CREATE FUNCTION "task_events_reject_update"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'task_events is append-only';
END;
$$;

CREATE TRIGGER "task_events_no_update"
  BEFORE UPDATE ON "task_events"
  FOR EACH ROW EXECUTE FUNCTION "task_events_reject_update"();
