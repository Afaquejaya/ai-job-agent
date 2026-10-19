# Phase 3 plan — Durable task engine

> Status: **DRAFT for approval** (2026-10-19). Nothing in this plan is built yet.
> Builds on the existing design: [background-processing.md](../architecture/background-processing.md),
> [agent-execution-flow.md](../architecture/agent-execution-flow.md) and the task state machine,
> queue ports and recovery rules already in `packages/agent-core`.

## 1. What you will be able to do (demo script)

1. On the **Jobs** page, click **Analyse match** and **close the tab**. The analysis keeps
   running in the background worker (today it stops when the page closes, and with the local
   model it takes about 6 minutes).
2. Open the new **Activity** page: the task shows `Queued → Running → Completed`, with a
   timeline of every step, how long it took, and the result linked to the job.
3. Stop Ollama halfway through. The task shows **Retrying at 14:32 (attempt 2 of 3)** with the
   reason ("Ollama is not running"). Start Ollama again: the retry succeeds on its own.
4. Click **Cancel** on a running task: it stops within seconds and shows `Cancelled`.
5. Kill the worker in the middle of a task (close its terminal). Start it again: the task
   resumes from where it was, once, never twice.
6. Upload a CV: text extraction also runs as a background task (decision 1).

What you learn: how real agent systems survive restarts — a database as the source of truth,
a queue only for "when to run what", leases, retries with backoff, idempotency, and a
reconciler that repairs anything the queue lost.

## 2. Scope

**In:**

- Database tables `agent_tasks`, `task_events`, `task_attempts`, `task_checkpoints`.
- `TaskStore` (Prisma) implementing the existing port: version-checked transitions, with the
  event (and checkpoint, when required) written in the same transaction; idempotent create.
- `packages/task-queue`: BullMQ adapter for the existing `TaskQueue` / `TaskConsumer` ports.
- Worker: consumers, a task runner, leases, cancellation, deadlines, retries through
  `decideRecovery`, a reconciler, graceful shutdown, real `/ready` and Redis health.
- First task kinds: **job match analysis** and **CV processing** (decision 1).
- Task API and an **Activity** page with a per-task timeline; job and CV pages show task status.

**Out (later phases):**

- Agent chat turns stay inside the request with live streaming (Phase 4 moves them).
- Schedules (nightly discovery, morning report) — Phase 11. Job sources — Phase 6.
- Approvals and submissions (`approval_requests`, the `SUBMITTING` path for real) — Phase 8.
  The engine's rules for them are built and tested now with a test-only task kind.

## 3. How it works (simple version)

```
Web: "Analyse match"  ──► 1. INSERT agent_task (QUEUED, idempotency key)      [PostgreSQL]
                      ──► 2. enqueue { taskId, userId }, jobId = taskId:attempt  [Redis/BullMQ]
                      ◄── 202 { taskId }   (page polls the task every 3 s)

Worker consumer ──► 3. load task, check state + version + cancel flag
                ──► 4. QUEUED → RUNNING, take a lease (lease_expires_at = now + 60 s)
                ──► 5. run the step (heartbeat renews the lease every 20 s)
                ──► 6. RUNNING → COMPLETED / RETRY_WAIT / NEEDS_REVIEW / FAILED
                       (+ task_event, + attempt row, in ONE transaction)
                ──► 7. on RETRY_WAIT: enqueue a delayed job at next_run_at

Reconciler (every 60 s) ──► tasks QUEUED / due RETRY_WAIT with no live job → enqueue again
                        ──► RUNNING tasks whose lease expired (worker died) → recover:
                            safe step → retry; external action dispatched → VERIFYING
```

Key rules:

- **PostgreSQL is the truth; Redis is only a scheduler.** Queue messages hold ids, never data.
  Deleting all of Redis loses no progress: the reconciler rebuilds the queue.
- **A step never runs twice at the same time:** the version check plus the lease make the
  second worker back off.
- **Retries are ours, not BullMQ's** (`attempts: 1`): every retry is recorded with its reason
  and time, shown in the timeline, and bounded by `max_attempts` and `deadline_at`.
- **An external action whose outcome is unknown is never repeated** — it goes to `VERIFYING`
  or `NEEDS_REVIEW` (existing `decideRecovery` rule). Tested now with a test-only kind.
- **Cancellation:** the API sets `cancel_requested_at`; the runner checks it every few seconds
  and aborts the step through an `AbortSignal` (already plumbed through the AI adapters).

## 4. Data model (one new migration)

| Table              | Key columns                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_tasks`      | `id`, `user_id`, `kind`, `state`, `input jsonb` (ids only, validated per kind), `output jsonb` (ids and counts only), `idempotency_key`, `failed_attempts`, `max_attempts`, `deadline_at`, `next_run_at`, `lease_expires_at`, `cancel_requested_at`, `version` |
| `task_events`      | `task_id`, `user_id`, `from_state`, `to_state`, `reason`, `failure_kind`, `failure_message` (safe text, no personal data) — append-only                                                                                                                        |
| `task_attempts`    | `task_id`, `step`, `attempt`, `started_at`, `finished_at`, `outcome`, `failure_kind` — `unique(task_id, step, attempt)`                                                                                                                                        |
| `task_checkpoints` | `task_id`, `state`, `step`, `external_action_dispatched_at`, `data jsonb`                                                                                                                                                                                      |

Constraints: `unique(user_id, idempotency_key)`, indexes for the reconciler
(`state, next_run_at`) and (`state, lease_expires_at`), CHECKs on states, kinds and counters,
`ON DELETE CASCADE` from users. `approval_requests` waits for Phase 8.

## 5. Components

| Where                       | What                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/agent-core`       | Task kinds `job_match_analysis`, `cv_processing`; new `RUNNING` state for single-step tasks (decision 2); per-kind input schemas; runner logic (pure, unit-tested) |
| `packages/database`         | `TaskStore` implementation + task queries for the API                                                                                                              |
| `packages/task-queue` (new) | BullMQ 6 adapter: `enqueue` with job-id dedup, delayed jobs, `remove`; consumer with concurrency and graceful `stop`; Redis health probe                           |
| `packages/services` (new)   | The match-analysis and CV-processing use cases and AI configuration, moved out of `apps/web/src/server` so the web app and the worker share them (decision 3)      |
| `apps/worker`               | Consumers, runner, lease heartbeat, reconciler, shutdown (stop taking jobs, wait up to 30 s, leave the rest to the reconciler), `/ready`                           |
| `apps/web`                  | Enqueue instead of running inline; task API; Activity page; status on Jobs and CVs pages                                                                           |

## 6. API

| Route                        | Purpose                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/jobs/:id/analyze` | Now creates a task and returns `202 { taskId }` (same job twice → same task while it runs) |
| `POST /api/resumes`          | Upload stores the file and returns `202` with the processing task                          |
| `GET /api/tasks`             | Your recent tasks (state, kind, timings)                                                   |
| `GET /api/tasks/:id`         | One task with its timeline (events and attempts)                                           |
| `POST /api/tasks/:id/cancel` | Request cancellation                                                                       |

All user-scoped; other users get 404, as everywhere else.

## 7. UI

- **Activity** page (new navigation item): list of tasks with state badges; click for the
  timeline (each state change, reason, attempt, duration, next retry time). Polls every 3 s
  while anything is running (decision 4).
- **Jobs:** "Analysing… (in the background, you can leave this page)" with live state; result
  appears when done. **CVs:** "Processing…" until extraction finishes.
- Clear states for "worker not running" (task stays Queued with a hint to start it).

## 8. Tests

- **Unit:** runner decisions (success, transient → retry with backoff, retry limit, deadline,
  permanent → failed, cancel before and during a step, lease expiry), state machine additions.
- **Integration (real Postgres + Redis):** idempotent create; version conflict between two
  runners; duplicate enqueue → one job; a task survives a worker restart; **kill mid-step →
  lease expires → reconciler resumes it exactly once**; **crash after
  `external_action_dispatched_at` → `VERIFYING`, never a second dispatch** (test-only kind);
  Redis flushed → reconciler re-enqueues; cancellation; user isolation of the task API.
- **E2E:** analyse a job with the fake model through the worker; Activity page shows the timeline.
- **CI:** add a Redis service container next to Postgres. No AI calls (fake model).
- **Live check on your laptop** with the local model: close the tab mid-analysis, check the
  result arrives; stop/start Ollama mid-task and watch the retry.

## 9. Acceptance criteria

1. Analyses and CV processing run in the worker, survive closing the page, and show their
   state and timeline in the UI.
2. Killing the worker mid-task resumes it after restart exactly once (tested).
3. A crash after an external action was dispatched leads to verification, never a repeat (tested).
4. Retries follow `decideRecovery` with backoff, stop at the attempt limit and the deadline,
   and every retry's reason is visible.
5. Duplicate requests create one task and one job; losing Redis loses no work (tested).
6. Cancellation works for queued and running tasks.
7. `/ready` is 200 only with consumers running and Postgres and Redis up.
8. All checks green locally and in CI; docs and decisions updated.

## 10. What you need to provide

Nothing new. Docker Desktop must be running (Postgres and Redis), and `pnpm dev` starts the web
app **and** the worker together, as it already does. `REDIS_URL` gets a default for local use.

## 11. Decisions needed

| #   | Decision                        | My recommendation                                                                                                                                                                |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First task kinds                | **Match analysis and CV processing.** Analysis benefits most (slow with the local model); CV processing was always meant to move here (D-026) and proves the engine is general.  |
| 2   | State for simple one-step tasks | **Add a `RUNNING` state** (`QUEUED → RUNNING → COMPLETED`, plus the existing retry, review, failure and cancel states), instead of borrowing application states like `MATCHING`. |
| 3   | Code shared by web and worker   | **New `packages/services`** holding the use cases (analysis, CV processing, AI config). The worker must not import from the web app.                                             |
| 4   | Live status in the browser      | **Polling every 3 s** while a task runs. Simple and robust; server-sent events can come later.                                                                                   |
| 5   | Agent chat                      | **Stays in the request for now** (live streaming); the chat's `analyze_job_match` tool keeps running inline. Moving chat onto the engine is a Phase 4 item.                      |
