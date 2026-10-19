# Architecture decisions

Short decision records. Status is **Accepted** (in effect), **Proposed** (needs confirmation
before the phase that uses it), or **Superseded**.

---

### D-001 Monorepo with pnpm workspaces and Turborepo — Accepted

**Context:** web app, worker, local agent and extension share types, schemas and domain logic.
**Decision:** one repository. `apps/*` are deployable units and `packages/*` are libraries.
Turborepo runs tasks and caches results. **pnpm 10** is pinned with `packageManager` and used
through Corepack. pnpm 10 blocks dependency install scripts by default, and only `esbuild` is
allowed.
**Consequences:** one install and one CI pipeline. Turbo needs `pnpm` on `PATH`, so run
`corepack enable pnpm` once.

### D-002 Internal packages ship TypeScript source — Accepted

**Decision:** packages export `./src/index.ts` directly. There is no per-package build step.
Next compiles them through `transpilePackages`. The worker runs them with `tsx`. Vitest runs
them natively.
**Why:** fastest feedback and no stale `dist/` folders. **Trade-off:** each consumer must
compile TypeScript. That is fine for apps in this repository. A package published outside the
repository would need a build step.

### D-003 Next.js App Router for UI and API, no separate API service — Accepted

**Decision:** route handlers in `apps/web/src/app/api`. Request and response contracts live in
`packages/shared`, so other clients (Flutter, extension, local agent) use the same schemas.
**Revisit when:** API traffic or long requests need a separate service. The contracts already
allow the move.

### D-004 PostgreSQL is the source of truth; Redis is delivery only — Accepted

**Decision:** task state, events and checkpoints live in PostgreSQL. BullMQ messages contain ids
only. A reconciler rebuilds queues from the database.
**Why:** losing or flushing Redis must never lose progress or cause a duplicate submission.

### D-005 Own durable state machine; LangGraph.js optional behind an interface — Accepted

**Decision:** `AgentOrchestrator` is a small interface. The persisted task state machine
(`task-state.ts`) controls durability, approvals and retries. LangGraph.js may implement the
orchestrator in Phase 4 if it helps. Its checkpointer will not replace our task tables.
**Why:** the safety rules (checkpoint before submit, never retry an uncertain outcome) must be
explicit, tested code and not depend on a framework's internals.

### D-006 Provider-neutral AI layer, API keys only — Accepted

**Decision:** `ModelProvider` and `ModelRouter` with per-purpose fallback chains. No vendor SDK
outside adapters. Model ids come from configuration. Consumer subscriptions are not supported.
An empty budget means no AI calls.

### D-007 Deny-by-default source declarations and a server-side policy engine — Accepted

**Decision:** every source declares capabilities. Automation stays off until a recorded policy
review. The policy rules are pure, tested functions in `packages/security`.
**Why:** compliance is enforced by code paths the agent cannot change, not by prompts.

### D-008 Local browser agent connects outbound; sessions never leave the machine — Accepted

**Decision:** paired device credential, short-lived typed commands (`browser-agent-protocol.ts`),
outbound HTTPS long-polling in v1. The protocol is defined in `packages/shared` because both
sides use it.
**Why:** no inbound ports on the user's machine, works with Vercel's request model, and the
cloud never holds job-portal cookies.

### D-009 Added `COMPLETED` task state — Accepted (deviation)

The requested state list had no success state for tasks that do not submit anything
(discovery, CV analysis, reports). `SUBMITTED` would be misleading for those, so `COMPLETED`
was added.

### D-010 Prisma deferred to Phase 2 — Accepted (deviation)

No schema or migrations in Phase 1. A schema file that no database had validated would add
risk without value. The proposed schema is documented in
[database-design.md](../architecture/database-design.md). Phase 2 adds Prisma together with a
real database and tests. The Prisma major version is chosen then.

### D-011 TypeScript 6.0, ESLint 10 — Accepted

TypeScript 7.0 is released, but `typescript-eslint` 8.71 supports TypeScript `< 6.1`.
TypeScript is pinned to `~6.0.3`. Move to TypeScript 7 when `typescript-eslint` and Next.js
support it.

### D-012 Dependency-free JSON logger first — Accepted

`createJsonLogger` writes JSON lines with built-in redaction. It sits behind the `Logger`
interface, so it can be swapped for pino or OpenTelemetry later without touching callers.

### D-013 Worker runs with `tsx` until the deployment phase — Accepted

Phase 1 needs no build step for the worker. A bundled production build and Dockerfile are added
before the first production deploy (Phase 12).

### D-014 Authentication library: Better Auth — Accepted (Phase 2)

Chosen by the user at the start of Phase 2, from the candidates Better Auth, Auth.js and Clerk.
Checked before adoption: Better Auth 1.7.10 was actively published (2 days before adoption) and
declares support for Next.js 16 and Prisma 7. Better Auth is self-hosted, keeps sessions in our
Postgres through the Prisma adapter, and has no per-user cost. Sign-in method: email + password.
Google sign-in can be added later without schema changes, because the `accounts` table supports
OAuth providers.

### D-015 Health endpoints report `not_checked` instead of guessing — Accepted

A dependency is reported `up` or `down` only after a real probe. Otherwise it is
`not_configured` or `not_checked`. Since Phase 2 the database is probed (`SELECT 1`, 2-second
timeout). Redis stays `not_checked` until Phase 3. The worker's `/ready` returns 503 until it has
consumers.

### D-016 Single root `.env` for local development — Accepted

`next.config.ts`, the worker, Prisma's config and the test tools all use Node's
`process.loadEnvFile` to read the repository-root `.env`. Hosted environments inject variables,
and existing variables are never overridden.

_Fixed during Phase 2 verification:_ the web app first used `@next/env`'s `loadEnvConfig`.
That function caches its first load (`apps/web`), so the root `.env` was silently ignored. The
tests didn't notice because they inject `DATABASE_URL` themselves. A manual browser check found
it.

### D-017 Session tokens stored as Better Auth stores them (plain) — Accepted (deviation)

The Phase 2 plan said "session tokens are stored hashed". Better Auth 1.7 looks sessions up by
the token value. It can hash _verification_ identifiers (enabled), but not session tokens.
**Mitigations:** tokens are long random values; the cookie is httpOnly and signed with
`AUTH_SECRET`; sessions expire after 7 days and can be revoked by deleting the row; database
access is limited to the app; and backups inherit the provider's encryption. **Revisit if** a
future Better Auth version supports hashed session storage, or before storing high-value data.

### D-018 No email verification until Phase 10 — Accepted

Verifying an address needs an email provider, which arrives in Phase 10. Until then
`requireEmailVerification` is off. The risk (signing up with someone else's address) is
contained, because production sign-up is closed unless the email is on
`AUTH_SIGNUP_ALLOWED_EMAILS`.

### D-019 Integration tests live next to the code they test — Accepted (deviation)

Database-backed tests are `*.int.test.ts` files inside `packages/database` and `apps/web`.
They are excluded from `pnpm test` and run with `pnpm test:integration`. Each package resolves
its own dependencies this way, and the tests sit beside the code. `tests/integration/` is kept
for future tests that span several apps.

### D-020 `time_zone` belongs to `user_settings` — Accepted

The proposed schema put `time_zone` on `users`. It moved to `user_settings` because the user
edits it with the other settings, and it keeps the auth-library-owned `users` table unmodified.

### D-021 Test tooling never resets or drops databases — Accepted

Prisma 7 blocks destructive commands (`migrate reset`, `db push --force-reset`) when run by an
AI agent without explicit user consent. Our tests don't need them. They run the non-destructive
`prisma migrate deploy` against a dedicated database whose name must end in `_test`. Each test
creates its own users with unique emails. CI uses a fresh Postgres container per run, which
proves the migrations apply from scratch.

### D-022 CV and profile work runs as Phase 2B, before the task engine — Accepted

The user's brief ("Phase 2 — Database, CV Management & Candidate Profile") arrived after the
roadmap's Phase 2 was done. It runs as **Phase 2B**, pulling the roadmap's old Phase 5 forward.
Nothing in it depends on the task engine (Phase 3). The full brief, with approved decisions, is
in [phase-2-brief.md](phase-2-brief.md).

### D-023 Text-only CV analysis in Phase 2B — Accepted (user decision 3b)

No AI and no API key in this phase. The pipeline extracts text and finds contact details by
pattern matching (email, phone with a `+` country code, LinkedIn URL), each with the exact
matched text as evidence. AI-assisted structured analysis moves to Phase 4, behind the
provider interface, keeping the same evidence-check-and-review rule.

### D-024 Application-level encryption for CV data — Accepted (user decision 4)

AES-256-GCM with `DATA_ENCRYPTION_KEY` for stored CV files, extracted text and parsed data.
Each ciphertext is bound by AAD to its storage key or row, owner and purpose. The payload
starts with a format-version byte, so key rotation can be added later. **Trade-off:** the key
becomes critical; losing it makes stored CVs unreadable, so it must be backed up separately
from the database. Profile fields stay plaintext, because they must remain queryable for
matching (later phase).

### D-025 Profile shape — Accepted (user decision 5)

All 18 brief fields are implemented, plus `work_experience`. Lists and structured values are
JSONB validated by shared Zod schemas, and the database checks their array/object shape. Every
field is nullable (null = not provided). `summary` was renamed to `professional_summary`, and
`headline` was dropped in favour of `current_role`.

### D-026 CV processing runs inside the upload request for now — Accepted (temporary deviation)

The durable queue doesn't exist until Phase 3. Text extraction is bounded (10 MB, 30 pages,
200,000 characters) and finishes in seconds, so it runs inside `POST /api/resumes` and
`POST /api/resumes/:id/reprocess`. It moves to a worker job in Phase 3. Interrupted runs are
retryable, because the reprocess endpoint also accepts `PROCESSING`/`UPLOADED`.

### D-027 Protected characteristics are never stored as reusable answers — Accepted (user decision 6)

Custom questions whose text mentions gender, ethnicity, race, religion, caste, disability, age,
date of birth, marital status, pregnancy, sexual orientation or veteran status are refused.
Such questions are always answered by the user on the form itself.

### D-028 Local storage driver only; S3/R2 in the deployment phase — Accepted (user decision 7)

`STORAGE_DRIVER=s3` fails with a clear configuration error until then. Serverless hosts have no
persistent disk, so the S3 driver is a hard prerequisite of the first production deploy.

### D-029 Deleting CVs — Accepted

As approved in the brief (B1): the only remaining CV cannot be deleted while it is primary.
Deleting a primary CV when others exist promotes the newest remaining version. Deleting the
account removes everything. **Note for review:** this blocks a user from removing their last
CV without deleting their account. If you'd rather allow it, it's a one-line change.

## Phase 2C — first agent (approved 2026-10-19)

Plan: [phase-2c-first-agent-plan.md](phase-2c-first-agent-plan.md). User decisions: Anthropic
key, `claude-opus-5-5`, pasted job text (link stored as a reference only), live step
streaming, opt-in AI consent, run as Phase 2C before the task engine.

### D-030 A hand-written agent loop, not a framework — Accepted

`runAgentTurn` in `packages/agent-core` is about 150 lines: call the model, run the tools it
asks for, send the results back, repeat. The code (not the model) enforces the limits: 8 steps
and 120 seconds per turn, a per-tool timeout, the budget check before every call, refusal and
cancellation handling. Unknown tools and invalid inputs are refused without running anything.
**Why:** the goal of this phase is to understand how an agent works, and every rule is visible
and unit-tested. LangGraph or the SDK's tool runner can replace it later without changing the
tools.

### D-031 The job description saved is exactly what the user pasted — Accepted

`save_job_posting` takes only title, company, location and link from the model. The server
stores the user's own message as the description. **Why:** a model could shorten or rewrite the
text, and the match analysis quotes it as evidence.

### D-032 Evidence is verified by code, and the score is computed by code — Accepted

The model assesses each factor and quotes the job and the CV. The server checks every quote
appears word for word (ignoring case, spacing and quote styles) and downgrades any factor with a
quote it cannot find to `unknown`. `missing` may rest on the CV saying nothing only for skills,
experience, education and language. For location, work authorization, salary and seniority,
silence stays `unknown`. The score is a weighted average of the assessed factors (fixed
weights), with `ineligible` for a missing mandatory requirement and
`insufficient_information` when less than 30% of the weight could be assessed.

### D-033 Chat messages and match results are encrypted at rest — Accepted

Messages hold CV and profile text (tool results), the model's thinking summaries and the exact
provider transcript that must be replayed. They are stored as one AES-256-GCM payload per
message, bound to user and conversation. Match results are encrypted the same way. The job
posting itself stays plaintext (it is the employer's public text). Conversations are capped at
20 turns instead of trimming history, because history must be replayed unchanged.

### D-034 Anthropic server-side fallbacks and automatic prompt caching — Accepted

Every request opts into `fallbacks: "default"`: if the model declines for policy reasons, the
API re-runs the request on Anthropic's recommended fallback model in the same call. Before
replaying such a turn, the declined model's thinking and tool calls are dropped, as the API
requires. Requests use top-level `cache_control`, so the fixed system prompt and tools, and the
growing conversation, are cached between the steps of a turn.

### D-035 A deterministic fake model for tests and offline demos — Accepted

`AI_PROVIDER=fake` uses a scripted model that saves the pasted job, runs the analysis and
deliberately invents one CV quote, so the evidence check can be seen working. Unit,
integration and e2e tests, and CI, never call a paid API. The web app refuses the fake model
when `NODE_ENV=production`.

### D-036 Model choice and cost tracking — Accepted

`claude-opus-5-5` by default (`ANTHROPIC_DEFAULT_MODEL` overrides it). Each model call is
recorded with its tokens and an estimated cost from a price table in `packages/ai-providers`.
A model without a known price is refused, so spending can always be counted against
`AI_MONTHLY_BUDGET_USD` (per user, calendar month in UTC).

### D-037 A free local model through Ollama — Accepted (user decision, 2026-10-19)

The user chose a free model over a paid API key. `AI_PROVIDER=ollama` uses Ollama's native
`/api/chat` on this computer, with the default model `bonsai-2:9b` (Prism ML, Apache 2.0, 3.2 GB).
The base URL must be a loopback address (checked when the environment is read and when the
adapter is created), so CV data cannot be sent to another machine by a configuration mistake.
Calls cost $0 and the monthly budget is optional for this provider. The context window is set
explicitly (16,384 tokens by default) because Ollama's small default silently drops input.
Thinking is requested for chat steps (and turned off automatically for models without it) and
left off for the match analysis, to keep waiting times down on a laptop processor; the evidence
check is unchanged. AI consent is still required. The Anthropic adapter stays available.
Plan: [phase-2c-local-model-plan.md](phase-2c-local-model-plan.md).

### D-038 Time limits depend on where the model runs — Accepted

A cloud model gets 120 s per agent turn and 90 s per match analysis. A local model gets 10
minutes per turn and 8 minutes per analysis, because the user's laptop runs it on the
processor. The step limit (8) is the same for both. Provider error messages written by our
adapters (for example "Ollama is not running") are shown to the user, because they say what to
fix.

### D-039 Default local model is `ornith:9b` — Accepted (user decision, 2026-10-19)

`bonsai-2:9b` (D-037) could not be downloaded: Ollama v0.40.5, the newest version available
through winget, refused it with "requires a newer version of Ollama". The user chose
`ornith:9b` instead (MIT license, 5.6 GB, tool use and thinking), which works with v0.40.5.
It is tuned for coding agents, so its job-matching quality is judged by the live check, not
assumed. `OLLAMA_MODEL` still selects any other model.

### D-040 Default local model `qwen3:4b-instruct-2507-q4_K_M`, thinking off, 8K context — Accepted (user decision, 2026-10-19)

Measured on the user's laptop (16 GB RAM, i7-1255U, 2 GB GPU, Ollama 0.40.5), with a synthetic
CV and job:

| Model                               | Writing speed                  | Chat turn                                                                    | Analyse button                             |
| ----------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `ornith:9b` (D-039)                 | 1.4 tokens/s (memory pressure) | did not finish                                                               | did not finish in 5 min                    |
| `qwen3:4b` (reasoning model)        | ~2.5 tokens/s                  | 9 min on the first step (1,300–1,600 reasoning tokens), hit the 10-min limit | 3.7–4.5 min, score 87, all quotes verified |
| **`qwen3:4b-instruct-2507-q4_K_M`** | ~8 tokens/s alone              | **9.6 min, complete** (save, analysis, explanation)                          | ~6 min, score 87                           |

Decisions:

- **Default model `qwen3:4b-instruct-2507-q4_K_M`** (Qwen3 4B Instruct, Apache 2.0, 2.5 GB): it answers without a
  reasoning phase, which is what makes a full agent turn fit on a laptop processor.
- **Thinking off for local models** (`OLLAMA_THINKING=true` turns it back on).
- **Default context 8,192 tokens:** 16,384 cost about 1.2 GB more memory for no benefit here.
- **Reasoning leaked into the answer is moved to the step trace.** qwen3:4b on Ollama 0.40.5
  wrote its reasoning into the reply, ending with `</think>`, even with thinking off.
  Text from a local model is sent to the page once each step is complete, because until then
  it may turn out to be reasoning.
- **The save tool's result tells the model to run the analysis next.** In the live check the
  small model otherwise stopped to ask permission. It also once invented a job id, which input
  validation refused; it then listed the saved jobs and used the real id.
- **Heartbeats every 15 s** keep a slow turn's stream visibly alive, and the Ollama client has no
  5-minute network wait (Node's default); our own time limits end slow calls.

Known limits, honestly: the same job scored 87 and 100 on two runs (small-model variance; the
evidence check still downgraded an inexact quote to unknown), and a full chat turn took 9.6 of
the 10 allowed minutes. The Analyse button on the Jobs page is the faster, steadier path.

## Phase 3 — durable task engine (approved 2026-10-19)

Plan: [phase-3-task-engine-plan.md](phase-3-task-engine-plan.md). User decisions: match analysis
and CV processing as the first task kinds, a `RUNNING` state, a shared `packages/services`,
3-second polling, chat stays in the request.

### D-041 Single-step tasks use a new `RUNNING` state — Accepted (user decision 2)

`QUEUED → RUNNING → COMPLETED`, with `RETRY_WAIT`, `NEEDS_REVIEW`, `FAILED` and `CANCELLED` as
the other exits. Borrowing an application state such as `MATCHING` would have made the
timeline misleading. `RUNNING` holds a lease; the database refuses a lease in any state other
than `RUNNING`, `SUBMITTING` or `VERIFYING`.

### D-042 Leases, heartbeats and a reconciler instead of queue-level recovery — Accepted

A running step holds a 60-second lease that a heartbeat renews every 20 seconds (the heartbeat
also notices cancel requests). BullMQ runs with `attempts: 1` and `maxStalledCount: 0`: it never
re-runs a job by itself. Instead, a reconciler on every worker, every minute, moves tasks whose
lease expired to `RETRY_WAIT` (counted as a failed attempt, so a task that keeps crashing
workers still stops at its limit), sends an interrupted submission whose action was dispatched
to `VERIFYING` (never a repeat), applies pending cancellations, and re-queues anything runnable.
A run that lost its lease cannot write its result: every transition is version-checked.
**Honest limit:** a step's own work can run twice after a crash (e.g. two match results stored);
the _task_ still completes exactly once. Steps with external effects (Phase 8) use checkpoints.

### D-043 One queue job per task version — Accepted

The BullMQ job id is `<taskId>-v<version>`. Enqueueing the same task state twice (a double click,
the reconciler, a retry) is a no-op; every new state gets its own job. Messages carry only the
task and user ids.

### D-044 Shared use cases in `packages/services` — Accepted (user decision 3)

The AI setup, CV processing and match analysis moved out of `apps/web/src/server` into
`@job-agent/services`, wired by each app to its own environment. The worker never imports the
web app. The AI environment variables are defined once (`aiEnvShape`) and read the same way by
both.

### D-045 The page polls the task every 3 s — Accepted (user decision 4)

`GET /api/tasks/:id` while a task is active, nothing otherwise. Server-sent events can come later.

### D-046 CV upload answers before extraction — Accepted

`POST /api/resumes` stores the file and returns `201` with the version (`UPLOADED`) and its
`cv_processing` task; the worker extracts the text (ends D-026's temporary deviation).
`POST /api/jobs/:id/analyze` returns `202` with a `job_match_analysis` task. Starting the same
work while it is active returns the existing task. AI consent and configuration are still checked
before queueing, so a task that cannot run is refused at once (403 / 503).

### D-047 Queue key prefix per environment — Accepted

`TASK_QUEUE_PREFIX` separates queues on one Redis. End-to-end tests run their own web server
and worker with a random prefix, so a developer's `pnpm dev` worker never takes their jobs.
