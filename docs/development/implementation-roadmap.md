# Implementation roadmap

Each phase ends with its checks green (`pnpm check`, plus the integration and e2e suites that
exist by then), its docs updated, and an explicit approval before the next phase starts.

| #   | Phase                                      | Main outcome                                                                    |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | Foundation                                 | Monorepo, contracts, docs, health checks ✅                                     |
| 2   | Data layer, authentication, user isolation | Real users and settings in PostgreSQL; every request scoped to a user 🟡        |
| 3   | Durable task engine                        | Queue, worker consumers, state transitions, checkpoints, retries, cancellation  |
| 4   | AI provider layer and chat shell           | Real model calls with routing, fallback, budget; chat UI driving tasks          |
| 5   | CV and candidate profile                   | Private upload, parsing, versions, verified answers library                     |
| 6   | Job sources and processing                 | First permitted connectors, normalization, dedup, freshness, source health      |
| 7   | Matching and tailored documents            | Explainable matching; tailored CV and cover letter with approval                |
| 8   | Application workflows and tracker          | Preparation, policy check, approvals, manual handoff, tracker UI                |
| 9   | Browser agent and extension                | Pairing, command protocol, assisted form fill, submission verification          |
| 10  | Email outreach                             | Drafts, approval bound to content, sending, delivery records                    |
| 11  | Overnight automation                       | Per-user schedules, daily target, morning report, self-recovery, retention jobs |
| 12  | Production hardening and deployment        | Worker bundle and Dockerfile, CI/CD, monitoring, security review, deploy        |

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

## Phase 2 — Data layer, authentication and user isolation 🟡 (built; database checks pending Docker)

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

| Criterion                                                                                                          | Status                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:migrate` creates the schema on an empty database; `pnpm db:seed` loads synthetic data; both documented    | ⏳ Written and documented. **Not yet run: needs Docker.**                                                                         |
| Sign-up, sign-in and sign-out work in the browser; protected pages and API routes return 401 without a session     | ✅ 401 envelope and redirect verified (unit + e2e + smoke test). ⏳ Real sign-up flow needs the database (e2e `account.spec.ts`). |
| Isolation tests with users A and B on every repository and implemented API route                                   | ⏳ Written (`repositories.int.test.ts`, `settings.int.test.ts`). **Not yet run: needs Docker.**                                   |
| Settings validation rejects invalid time zones, limits outside 0–50, unknown modes; changes audited without values | ✅ Validation unit-tested. ⏳ Audit-row tests need the database.                                                                  |
| `/api/health` shows `up` with the database running and `down` (503) with it stopped                                | ✅ `down`/503 verified against an unreachable database. ⏳ `up` needs Docker.                                                     |
| No secrets in the repository; `.env.example` updated; ~~session tokens stored hashed~~                             | ✅ Deviation: Better Auth cannot hash session tokens. Verification identifiers are hashed instead; see D-017.                     |
| `pnpm check`, integration and e2e tests pass locally and in CI                                                     | 🟡 `pnpm check` and build pass. Integration tests and 2 e2e tests are pending Docker. CI has not run (no remote).                 |
| Docs updated                                                                                                       | ✅                                                                                                                                |

### Remaining before Phase 2 can be signed off

1. Install Docker Desktop, then run `pnpm db:up`, `pnpm db:migrate`, `pnpm test:integration` and
   `pnpm test:e2e`.
2. Fix anything those runs reveal, and record the results here.

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

- Adapters for Anthropic, Gemini, OpenAI and OpenAI-compatible endpoints, with a router,
  fallback, timeouts, usage records and budget enforcement.
- Contract tests with recorded responses. There are no live API calls in CI.
- Orchestrator implementation (hand-written loop or LangGraph.js) with a step limit and only
  read-only tools.
- Chat UI that creates tasks and streams progress.

### Phase 5 — CV and candidate profile

- `ObjectStorage` port with local and S3 drivers. Private-only access through signed URLs.
- CV upload with type and size validation, versioning and sha256 dedup. AI parsing with schema
  validation, which the user reviews and confirms.
- Verified answers library. Answers are only usable after explicit verification.

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
