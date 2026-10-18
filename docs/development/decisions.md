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

### D-014 Authentication library — Proposed (decide at Phase 2 start)

Requirements: database sessions on PostgreSQL through Prisma, secure cookies, works on Vercel,
supports separate device and extension tokens, and stays actively maintained. Candidates:
**Better Auth**, **Auth.js**, or a managed provider such as **Clerk**. Recommendation:
self-hosted, database-session library (Better Auth or Auth.js). Data stays in our database and
there is no per-user cost. Confirm the maintenance status and Next.js 16 compatibility before
choosing.

### D-015 Health endpoints report `not_checked` instead of guessing — Accepted

Until real database and Redis clients exist, health endpoints say a dependency is
`not_configured` or `not_checked`, never `up`. The worker's `/ready` returns 503 until it has
consumers.

### D-016 Single root `.env` for local development — Accepted

`next.config.ts` (via `@next/env`) and the worker (`process.loadEnvFile`) both read the
repository-root `.env`. Hosted environments inject variables, and existing variables are never
overridden.
