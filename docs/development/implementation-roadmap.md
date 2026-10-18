# Implementation roadmap

Each phase ends with its checks green (`pnpm check`, plus the integration and e2e suites that
exist by then), its docs updated, and an explicit approval before the next phase starts.

| #   | Phase                                      | Main outcome                                                                                                             |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Foundation                                 | Monorepo, contracts, docs, health checks ✅                                                                              |
| 2   | Data layer, authentication, user isolation | Real users and settings in PostgreSQL; every request scoped to a user ✅                                                 |
| 2B  | CV management and candidate profile        | Profile, encrypted CV versions, text extraction, verified answers ✅                                                     |
| 2C  | First agent                                | Anthropic adapter, agent loop with six read/save tools, streamed chat, evidence-checked job matching, consent and budget |
| 3   | Durable task engine                        | Queue, worker consumers, state transitions, checkpoints, retries, cancellation                                           |
| 4   | AI provider layer and chat shell           | Real model calls with routing, fallback, budget; chat UI driving tasks                                                   |
| 5   | ~~CV and candidate profile~~               | Moved forward and delivered as Phase 2B                                                                                  |
| 6   | Job sources and processing                 | First permitted connectors, normalization, dedup, freshness, source health                                               |
| 7   | Matching and tailored documents            | Explainable matching; tailored CV and cover letter with approval                                                         |
| 8   | Application workflows and tracker          | Preparation, policy check, approvals, manual handoff, tracker UI                                                         |
| 9   | Browser agent and extension                | Pairing, command protocol, assisted form fill, submission verification                                                   |
| 10  | Email outreach                             | Drafts, approval bound to content, sending, delivery records                                                             |
| 11  | Overnight automation                       | Per-user schedules, daily target, morning report, self-recovery, retention jobs                                          |
| 12  | Production hardening and deployment        | Worker bundle and Dockerfile, CI/CD, monitoring, security review, deploy                                                 |

---

## Phase 1 — Foundation ✅

- [x] Directory structure and module boundaries documented
- [x] Architecture documents, consistent with each other and with the code
- [x] Workspace config, shared TypeScript settings, ESLint, Prettier, Vitest, Playwright
- [x] Health endpoints: web `GET /api/health`, worker `GET /health` and `GET /ready`
- [x] Contracts: AI providers, job-source connectors, task queue, browser-agent protocol
- [x] Implemented and tested core rules: task state machine, recovery decisions, submission and
      email policy, log redaction, source declaration invariants
- [x] Setup guide, `.env.example`, `.gitignore`

---

## Phase 2 — Data layer, authentication and user isolation ✅ (verified and signed off 2026-10-18)

**Goal:** a person can sign up, sign in, and manage their settings. Every private record is
stored in PostgreSQL and scoped to them, and this is proven by tests.

**Decisions made at the start:** Docker Desktop for local Postgres and Redis, Better Auth
(D-014), email + password sign-in, and local git only (no GitHub remote yet).

### Delivered

- [x] `docker-compose.yml`: Postgres 17 (dev database + `job_agent_test`) and Redis 7.4, bound
      to 127.0.0.1
- [x] Prisma 7.10 schema, initial migration (with hand-written CHECK constraints and an
      append-only audit trigger), generated client, `pg` driver adapter
- [x] Repositories: user settings (update + audit in one transaction), candidate profile
      (minimal), audit log adapter, database probe. All are scoped by `userId`.
- [x] Better Auth: sign-up, sign-in and sign-out pages, protected `/app` area with server-side
      checks on every page, sign-up allow-list, database-backed rate limits, hashed
      verification identifiers
- [x] API foundation: `withAuth` (request id, session → `AuthContext`, same-origin check for
      writes, error envelope, one log line per request), `parseJsonBody` (Zod, no input echo)
- [x] Settings API (`GET`/`PATCH /api/settings`) and settings page
- [x] Real database probe in web `/api/health` and worker `/health` (`down` → HTTP 503)
- [x] Seed script (`pnpm db:seed`, synthetic demo account, password from `SEED_DEMO_PASSWORD`)
- [x] Git repository with Phase 1 committed. GitHub Actions workflow (`.github/workflows/ci.yml`).
      It has not run yet because there is no GitHub remote.

### Acceptance criteria and status

| Criterion                                                                                                          | Status                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate` creates the schema on an empty database; `pnpm db:seed` loads synthetic data; both documented    | ✅ Migration applied to empty dev and test databases; no drift (`prisma migrate diff` = no difference). Seed is idempotent.                                                                         |
| Sign-up, sign-in and sign-out work in the browser; protected pages and API routes return 401 without a session     | ✅ Done by hand in a real browser (sign-up → app → settings → sign-out → blocked → sign-in), plus e2e and integration tests.                                                                        |
| Isolation tests with users A and B on every repository and implemented API route                                   | ✅ 27 integration tests pass (11 database + 16 web API).                                                                                                                                            |
| Settings validation rejects invalid time zones, limits outside 0–50, unknown modes; changes audited without values | ✅ Unit + integration tests; audit row checked in the database (field names only).                                                                                                                  |
| `/api/health` shows `up` with the database running and `down` (503) with it stopped                                | ✅ `up` (integration, e2e, dev server) and `down`/503 (unreachable database).                                                                                                                       |
| No secrets in the repository; `.env.example` updated; ~~session tokens stored hashed~~                             | ✅ Deviation: Better Auth cannot hash session tokens. Verification identifiers are hashed instead; see D-017.                                                                                       |
| `pnpm check`, integration and e2e tests pass locally and in CI                                                     | ✅ Locally: check, build, 27 integration and 5 e2e tests. In CI: [first run](https://github.com/Afaquejaya/ai-job-agent/actions/runs/39150663981) passed every step, with 5 of 5 e2e tests passing. |
| Docs updated                                                                                                       | ✅                                                                                                                                                                                                  |

### Found and fixed during verification

1. **Root `.env` ignored by the web app.** `@next/env` caches its first load, so `next.config.ts`
   never read the root `.env`. The tests inject env vars and didn't see it; the manual browser
   check did. Fixed by switching to `process.loadEnvFile` (see D-016).
2. **E2E sign-out test sent a bare POST.** Better Auth only accepts JSON POSTs (415). This was a
   test bug, not an app bug: the real sign-out button sends JSON.

### CI

- The repository is on GitHub at [Afaquejaya/ai-job-agent](https://github.com/Afaquejaya/ai-job-agent) (public). CI runs on every push to `main` and on every pull request.
- After the first run, `actions/checkout` and `actions/setup-node` were moved from v4 (Node 20, deprecated) to v7 (Node 24).

---

## Phase 2B — CV management and candidate profile ✅ (verified 2026-10-18, signed off 2026-10-19)

The full brief and approved decisions are in [phase-2-brief.md](phase-2-brief.md) (decisions
D-022 to D-029). CV analysis is **text-only** (decision 3b): there is no AI in this phase.

### Delivered

- Migration `20261018180000_cv_profile_answers`: full `candidate_profiles`, `resumes` and
  `profile_answers`, with CHECK constraints and partial unique indexes.
- New packages: `@job-agent/storage` (object storage port, local driver, encryption wrapper) and
  `@job-agent/documents` (content-based PDF/DOCX validation, text extraction, contact
  suggestions). AES-256-GCM `DataCipher` added to `@job-agent/security`.
- Repositories for profile, resumes and answers, all scoped by `userId` and audited without
  values.
- API: `/api/profile`, `/api/resumes` (+ `/:id`, `/file`, `/primary`, `/reprocess`,
  `/suggestions`, `/suggestions/apply`), `/api/answers` (+ `/:id`, `/verify`).
- UI: Profile, CVs (upload, versions, review of suggestions with evidence) and Answers pages,
  plus updated navigation.

### Acceptance criteria and status

| #   | Criterion                                                                          | Status                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One new migration applies cleanly; existing data and tests stay green              | ✅ Applied to dev and test DBs; `prisma migrate diff` reports no drift; earlier tests unchanged and passing                                                      |
| 2   | PDF/DOCX upload; invalid, oversized, renamed or macro files rejected               | ✅ Unit + integration tests (renamed text, `.docm`, zip bomb, empty, 413 before reading)                                                                         |
| 3   | Private storage, generated keys, owner-only access, unreadable on disk             | ✅ Integration tests check the UUID file name, no `%PDF` or email in stored bytes, encrypted DB text, and 404 for other users                                    |
| 4   | Checksum duplicate detection; versions kept; exactly one primary                   | ✅ 409 with the existing version; DB partial unique index; promotion on delete                                                                                   |
| 5   | `UPLOADED → PROCESSING → EXTRACTED / NEEDS_REVIEW / FAILED` with reasons and retry | ✅ Tested, including near-empty (scanned-like) files → `NEEDS_REVIEW`                                                                                            |
| 6   | Suggestions carry verbatim evidence; nothing written without acceptance            | ✅ Evidence is guaranteed by construction and tested; only selected suggestions are applied; answers start as drafts                                             |
| 7   | Profile view/edit; structured fields validated; unknown stays null                 | ✅ Shared Zod schemas, merged-profile validation, DB shape checks                                                                                                |
| 8   | Answers: create, verify, edit un-verifies, archive; only verified usable           | ✅ Repository + API tests; DB check keeps status and `verified_at` consistent                                                                                    |
| 9   | Isolation proven for profile, resumes, answers                                     | ✅ Integration tests with two users per area                                                                                                                     |
| 10  | Check, build, integration and e2e pass locally and in CI; docs updated             | ✅ Locally: 149 unit, 64 integration, 6 e2e tests; build passes. CI [run 39154125972](https://github.com/Afaquejaya/ai-job-agent/actions/runs/39154125972) green |

### Known limitations (deliberate)

- No OCR: scanned CVs end in `NEEDS_REVIEW`.
- No AI parsing (Phase 4).
- Local storage driver only (S3 before deployment).
- Processing runs in the request, not a worker (Phase 3).
- Encryption key rotation is not implemented yet.

---

## Phase 2C — First agent (built 2026-10-19; awaiting live run and sign-off)

Plan and decisions: [phase-2c-first-agent-plan.md](phase-2c-first-agent-plan.md), D-030 to D-036.

### Delivered

- Migration `20261019090000_agent_jobs_usage`: `agent_conversations`, `agent_messages`,
  `job_postings`, `job_matches`, `ai_usage_records` and `user_settings.ai_processing_consent_at`,
  with CHECK constraints and a partial unique index (one saved job per link per user).
- `@job-agent/ai-providers`: the Anthropic adapter (streaming, adaptive thinking with summaries,
  effort, strict tools with eager input streaming, server-side fallbacks, automatic caching,
  typed error mapping), a price table, and a scripted fake model.
- `@job-agent/agent-core`: `runAgentTurn`, the agent loop with step, time, budget, refusal and
  cancellation limits.
- `@job-agent/job-processing`: evidence-based match analysis (`verifyAndScore`).
- Web: six agent tools, `/api/agent/messages` (NDJSON stream), conversations, `/api/jobs`
  (+ `/:id`, `/analyze`), `/api/ai/usage`, AI consent in settings; Agent and Jobs pages.

### Acceptance criteria and status

| #   | Criterion                                                                     | Status                                                                                                                      |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | With key, budget and consent, a message produces a streamed multi-step run    | ✅ With the fake model (integration, e2e, browser check). ⏳ Live run with the real key pending (key not yet set in `.env`) |
| 2   | Pasted job saved; match stored; quotes verified; invented evidence downgraded | ✅ Unit + integration tests (the fake model invents a quote; it ends up `unknown`)                                          |
| 3   | Score and recommendation computed by code, reproducible                       | ✅ `verifyAndScore` unit tests (weights, thresholds, ineligible, insufficient information)                                  |
| 4   | No AI call without consent, key or budget; the UI says why                    | ✅ 403 `consent_required` / 503 `AI_UNAVAILABLE` tested; consent banner and reason shown in the UI                          |
| 5   | Budget enforced before every call; usage and cost recorded and shown          | ✅ Budget-exhausted turn and analysis tested; per-call records and month-to-date total tested                               |
| 6   | Only the six tools; user-scoped and validated; no external-action tool        | ✅ Unknown tool and invalid input refused (unit); cross-user access returns 404 (integration)                               |
| 7   | 8 steps / 120 s per turn; stops with an explanation                           | ✅ Step limit, deadline, per-tool timeout, refusal and cancellation unit-tested                                             |
| 8   | No message, CV or job text in logs or audit metadata                          | ✅ Audit metadata checked in integration tests; message payloads and match results encrypted (checked on raw rows)          |
| 9   | Isolation for conversations, jobs, matches and usage                          | ✅ Repository and API tests with two users                                                                                  |
| 10  | Check, build, integration and e2e pass locally and in CI; live run; docs      | See the final report for this phase                                                                                         |

### Known limitations (deliberate)

- Jobs are pasted; links are never fetched (Phase 6, with source policy review).
- Anthropic only; other adapters and routing come with Phase 4.
- Turns run inside the request (`maxDuration` 150 s); they move to the task engine in Phase 3.
- No AI-assisted CV parsing yet (Phase 4 item).

---

## Phases 3–12 (summary acceptance criteria; detailed at each phase start)

### Phase 3 — Durable task engine

- `packages/task-queue` with a BullMQ adapter for `TaskQueue` and `TaskConsumer`. Prisma
  `TaskStore` with version-checked transitions and an event and checkpoint in one transaction.
- Worker consumers, a reconciler, cancellation, deadlines and graceful shutdown. `/ready`
  returns 200 when consumers are running.
- Tests: killing the worker mid-step resumes correctly. A simulated crash after
  `external_action_dispatched_at` goes to `VERIFYING`, never to a second submit. A duplicate
  enqueue creates one job. Retries stop at the limit and the deadline.
- Task history API and a basic task timeline UI.

### Phase 4 — AI provider layer and chat shell

- Phase 2C already delivered the Anthropic adapter, the agent loop, usage records, the budget
  and a streamed chat. Phase 4 adds the remaining adapters, routing and fallback across
  providers, and moves chat turns onto the task engine.
- Includes **AI-assisted CV analysis** deferred from Phase 2B (evidence-checked suggestions that
  the user reviews, same rules as the deterministic ones).

- Adapters for Anthropic, Gemini, OpenAI and OpenAI-compatible endpoints, with a router,
  fallback, timeouts, usage records and budget enforcement.
- Contract tests with recorded responses. There are no live API calls in CI.
- Orchestrator implementation (hand-written loop or LangGraph.js) with a step limit and only
  read-only tools.
- Chat UI that creates tasks and streams progress.

### Phase 5 — CV and candidate profile

- Delivered early as **Phase 2B** (see above). Follow-ups that remain for later phases: OCR for
  scanned CVs, AI-assisted structured parsing (Phase 4), S3 storage driver (deployment).

### Phase 6 — Job sources and processing

- At least one reviewed connector with a recorded policy review (likely a public ATS job-board
  API), plus manual-link import for every source.
- Normalization, fingerprint dedup, freshness checks, connector runs and a health dashboard.
- Per-source rate limiting through the queue.

### Phase 7 — Matching and tailored documents

- Explainable match results with evidence and `unknown` where the CV is silent.
- Tailored CV and cover letter generation. Facts are limited to the verified profile. The user
  previews and approves.

### Phase 8 — Application workflows and tracker

- `job_application` tasks through `PREPARING → POLICY_CHECK → AWAITING_APPROVAL / MANUAL_HANDOFF`.
- Content-hash approvals, handoff tickets and an application tracker with statuses and evidence.
- Duplicate-application protection proven by tests.

### Phase 9 — Browser agent and extension

- Pairing, device credentials, revocation and heartbeats. The command protocol is implemented on
  both sides.
- Extension: detect forms and fill them with verified answers. The user submits unless policy
  allows otherwise.
- Local agent: Playwright with a dedicated profile. It returns `blocked` on CAPTCHA, OTP or login.
- Submission verification with stored evidence.

### Phase 10 — Email outreach

- Drafts, content-hash approval, sending through a provider, delivery records and an audit
  trail.
- Tests: an edited draft invalidates its approval. Nothing is sent without approval.

### Phase 11 — Overnight automation

- Per-user schedules in the user's time zone. Daily-limit slot reservation. The morning report.
- Self-recovery diagnostics in reports. Retention clean-up jobs.

### Phase 12 — Production hardening and deployment

- Worker bundle and Dockerfile. Vercel, worker host and managed services provisioned.
- CI/CD with migrations, monitoring and alerts. Security review (threat model, dependency audit,
  authorization tests).
- Mobile responsiveness pass. API review for future Flutter readiness.
