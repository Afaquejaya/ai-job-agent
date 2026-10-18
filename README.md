# AI Job Agent

A personal AI agent that finds relevant jobs in India and the Middle East, analyses your CV,
prepares tailored applications, fills forms on supported sites, tracks every application, and
keeps working overnight. It asks for your approval before anything irreversible.

> **Current status: Phase 1 — foundation.** The repository contains the architecture,
> module contracts, tooling and health checks. **No job search, application, AI or
> authentication features are implemented yet.** See the
> [roadmap](docs/development/implementation-roadmap.md).

## Repository layout

```
apps/
  web/             Next.js app: UI + API route handlers (Vercel)
  worker/          Persistent Node.js worker: queues, schedules, retries, reports
  browser-agent/   Local agent on the user's machine (Phase 1: interfaces only)
  extension/       Chrome extension, Manifest V3 (Phase 1: README only)
packages/
  shared/                 Common types, Zod schemas, API + browser-agent protocol
  agent-core/             Task state machine, recovery rules, tool registry, orchestrator contract
  ai-providers/           Provider-neutral model interface and routing contracts
  job-sources/            Connector interface + deny-by-default source declarations
  job-processing/         Normalization, dedup, freshness, matching contracts
  application-workflows/  Preparation, form filling, verification, handoff contracts
  database/               Persistence primitives (Prisma schema arrives in Phase 2)
  security/               Auth context, ownership check, policy engine, audit types
  notifications/          Approval requests, alerts, morning report contracts
  observability/          JSON logger with redaction, metrics interface
docs/
  architecture/    System design (start with system-overview.md)
  development/     Roadmap and architecture decisions
tests/
  e2e/             Playwright tests (HTTP-level in Phase 1)
  integration/     Real-infrastructure tests (from Phase 2)
  fixtures/        Synthetic test data only
scripts/           Maintenance scripts (empty in Phase 1)
```

## Prerequisites

| Tool              | Version                                      | Notes                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------ |
| Node.js           | 22.12+ (24 recommended, see `.node-version`) |                                                        |
| pnpm              | 10.34.7 (pinned in `package.json`)           | Use Corepack. No global install needed.                |
| Git               | any recent                                   |                                                        |
| PostgreSQL, Redis | —                                            | **Not needed for Phase 1.** Needed from Phase 2 and 3. |

## Setup

```bash
# 1. Make the pinned pnpm available on PATH (once per machine).
#    Turborepo needs a `pnpm` binary on PATH.
corepack enable pnpm
#    If that fails with a permissions error (Windows without admin), install the shim into a
#    user folder that is already on PATH instead:
#    corepack enable pnpm --install-directory "$(npm config get prefix)"

# 2. Install dependencies
pnpm install

# 3. Optional in Phase 1: create your local env file (all values may stay empty)
cp .env.example .env

# 4. Verify everything
pnpm check
```

### Run locally

```bash
pnpm dev                                  # web (http://localhost:3000) + worker together
pnpm --filter @job-agent/web dev          # web only
pnpm --filter @job-agent/worker dev       # worker only (health on http://localhost:8081)
```

Health checks:

- Web: <http://localhost:3000/api/health>
- Worker: <http://localhost:8081/health> (liveness) and <http://localhost:8081/ready> (returns
  `503` by design in Phase 1, because no queue consumers exist yet)

Dependencies show `not_configured` (variable empty) or `not_checked` (configured, but no probe
exists yet). They never show a fake `up`.

## Everyday commands

| Command          | What it does                                                           |
| ---------------- | ---------------------------------------------------------------------- |
| `pnpm check`     | format check, lint, typecheck and unit tests. Run before every commit. |
| `pnpm lint`      | ESLint, including module-boundary rules                                |
| `pnpm typecheck` | `tsc --noEmit` in every package, plus Next route types                 |
| `pnpm test`      | Vitest unit tests in every package                                     |
| `pnpm test:e2e`  | Playwright (starts the web dev server on port 3100)                    |
| `pnpm build`     | Production build of the web app                                        |
| `pnpm format`    | Prettier write                                                         |

## Environment variables

All variables are listed with explanations in [`.env.example`](.env.example). Placeholders
only: **never commit real values**. Local development uses one `.env` at the repository root,
which both the web app and the worker read. Hosted environments use their own secret stores.

## Architecture docs

| Document                                                                    | Topic                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------- |
| [system-overview](docs/architecture/system-overview.md)                     | Components, cloud vs local, module boundaries      |
| [agent-execution-flow](docs/architecture/agent-execution-flow.md)           | How the agent loop plans, acts, observes, retries  |
| [application-state-machine](docs/architecture/application-state-machine.md) | Task states, transitions, durability rules         |
| [job-source-connectors](docs/architecture/job-source-connectors.md)         | Connector interface and capability registry        |
| [security-and-permissions](docs/architecture/security-and-permissions.md)   | Trust boundaries, approvals, secrets               |
| [database-design](docs/architecture/database-design.md)                     | Proposed schema, indexes, retention                |
| [background-processing](docs/architecture/background-processing.md)         | Queue, checkpoints, retries, schedules             |
| [ai-provider-routing](docs/architecture/ai-provider-routing.md)             | Model switching, fallback, costs                   |
| [deployment](docs/architecture/deployment.md)                               | Vercel, worker host, managed services, local agent |
| [implementation-roadmap](docs/development/implementation-roadmap.md)        | Phases and acceptance criteria                     |
| [decisions](docs/development/decisions.md)                                  | Architecture decision records                      |

## Safety principles (built in from the start)

- Every private record and action is scoped to the authenticated user.
- The agent never invents candidate information, and only reuses answers you have verified.
- Emails are never sent without your explicit approval of the exact content.
- Applications are submitted automatically only where the source **and** your settings
  explicitly allow it. Otherwise everything is prepared and handed to you.
- CAPTCHA, OTP, logins, access blocks and rate limits are never bypassed.
- A submission with an uncertain outcome is verified, never blindly retried.
