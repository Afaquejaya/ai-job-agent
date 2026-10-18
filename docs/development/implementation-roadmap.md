# Implementation roadmap

Each phase ends with its checks green (`pnpm check`, plus the integration and e2e suites that
exist by then), its docs updated, and an explicit approval before the next phase starts.

| #   | Phase                                      | Main outcome                                                                    |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | Foundation                                 | Monorepo, contracts, docs, health checks ✅                                     |
| 2   | Data layer, authentication, user isolation | Real users and settings in PostgreSQL; every request scoped to a user           |
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

## Phase 1 — Foundation ✅ (this phase)

- [x] Directory structure and module boundaries documented
- [x] Architecture documents, consistent with each other and with the code
- [x] Workspace config, shared TypeScript settings, ESLint, Prettier, Vitest, Playwright
- [x] Health endpoints: web `GET /api/health`, worker `GET /health` and `GET /ready`
- [x] Contracts: AI providers, job-source connectors, task queue, browser-agent protocol
- [x] Implemented and tested core rules: task state machine, recovery decisions, submission and
      email policy, log redaction, source declaration invariants
- [x] Setup guide, `.env.example`, `.gitignore`

---

## Phase 2 — Data layer, authentication and user isolation (next, awaiting approval)

**Goal:** a person can sign up, sign in, and manage their settings. Every private record is
stored in PostgreSQL and scoped to them, and this is proven by tests.

### Scope

1. **Local infrastructure.** A `docker-compose.yml` with PostgreSQL and Redis for local
   development. If Docker is not wanted, a documented alternative: a free managed development
   database URL.
2. **Prisma in `packages/database`.** Schema and first migration for `users`, the auth library's
   tables, `user_settings`, `candidate_profiles` (minimal) and `audit_logs`, following the
   conventions in [database-design.md](../architecture/database-design.md). Generated client and
   a seed script with **synthetic** data only.
3. **Repositories** that take `userId` first, plus a Prisma `TransactionRunner`, a
   `DatabaseProbe` and an `AuditLog` adapter.
4. **Authentication** using the library chosen under D-014, with database sessions, secure
   cookies, sign-up, sign-in and sign-out pages, and a protected app area.
5. **API foundation:** a `withAuth` route wrapper that builds an `AuthContext`, Zod request
   validation, the `apiErrorSchema` error envelope, request ids, and structured request logging.
6. **Settings:** API and page for time zone (IANA, validated), submission mode (default
   `manual_only`), daily application limit (default 20, maximum 50) and target countries.
   Changes are audit-logged.
7. **Health:** web `/api/health` and worker `/health` report the database as `up` or `down` with
   a real probe.
8. **Version control and CI:** `git init`, a first commit, and a GitHub Actions workflow running
   `pnpm check` plus integration tests against a Postgres service container.

### Out of scope

Queues and workers processing jobs (Phase 3), AI calls (Phase 4), CV upload and storage
(Phase 5), anything touching job sites.

### Acceptance criteria

- `pnpm db:migrate` creates the schema on an empty database. `pnpm db:seed` loads synthetic
  data. Both are documented in the README.
- Sign-up, sign-in and sign-out work in the browser. Protected pages and API routes return
  `401` (`UNAUTHENTICATED` envelope) without a session.
- **Isolation tests (integration, real Postgres):** with users A and B, every repository and
  every implemented API route refuses A access to B's data and returns not-found semantics.
- Settings validation rejects invalid time zones, limits outside 0–50, and unknown submission
  modes. Accepted changes write an `audit_logs` row without secrets or personal content.
- `/api/health` shows `database: "up"` with the database running and `"down"` (HTTP 503) with it
  stopped. Verified manually and by an integration test.
- No secrets in the repository. `.env.example` is updated. Session tokens are stored hashed.
- `pnpm check`, integration tests and e2e tests pass locally and in CI. Results are reported
  with the exact commands.
- Docs updated: database-design (implemented vs proposed), security (chosen auth), decisions
  (D-014 resolved), README setup.

### Needed from you before starting

1. **Database access:** install Docker Desktop (recommended), or create a free managed
   PostgreSQL database and put its URL in `.env`.
2. **Auth decision (D-014):** confirm the recommended self-hosted library, or name a preference.
   Also choose the sign-in method: email + password, Google sign-in, or both. Google sign-in
   needs an OAuth client that you create.
3. **GitHub:** whether you want a GitHub repository for CI now, and its name.

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
