# AI Job Agent

A personal AI agent that finds relevant jobs in India and the Middle East, analyses your CV,
prepares tailored applications, fills forms on supported sites, tracks every application, and
keeps working overnight. It asks for your approval before anything irreversible.

> **Current status: Phase 2 — accounts, settings and data layer.** You can create an account,
> sign in, and manage settings stored in PostgreSQL. **No job search, application or AI
> features are implemented yet.** See the [roadmap](docs/development/implementation-roadmap.md).

## Repository layout

```
apps/
  web/             Next.js app: UI, auth, API route handlers (Vercel)
  worker/          Persistent Node.js worker: queues, schedules, retries, reports
  browser-agent/   Local agent on the user's machine (interfaces only so far)
  extension/       Chrome extension, Manifest V3 (README only so far)
packages/
  shared/                 Common types, Zod schemas, API + browser-agent protocol
  agent-core/             Task state machine, recovery rules, tool registry, orchestrator contract
  ai-providers/           Provider-neutral model interface and routing contracts
  job-sources/            Connector interface + deny-by-default source declarations
  job-processing/         Normalization, dedup, freshness, matching contracts
  application-workflows/  Preparation, form filling, verification, handoff contracts
  database/               Prisma schema + migrations, repositories, health probe
  security/               Auth context, ownership check, policy engine, audit types
  notifications/          Approval requests, alerts, morning report contracts
  observability/          JSON logger with redaction, metrics interface
docs/
  architecture/    System design (start with system-overview.md)
  development/     Roadmap and architecture decisions
tests/
  e2e/             Playwright tests (HTTP-level)
  integration/     Cross-app integration tests (package-level ones live next to the code)
  fixtures/        Synthetic test data only
scripts/           Local tooling (Postgres init script for Docker)
```

## Prerequisites

| Tool           | Version                                      | Notes                                                         |
| -------------- | -------------------------------------------- | ------------------------------------------------------------- |
| Node.js        | 22.12+ (24 recommended, see `.node-version`) |                                                               |
| pnpm           | 10.34.7 (pinned in `package.json`)           | Use Corepack. No global install needed.                       |
| Git            | any recent                                   |                                                               |
| Docker Desktop | any recent                                   | Runs local PostgreSQL 17 and Redis 7.4 (`docker-compose.yml`) |

## Setup

```bash
# 1. Make the pinned pnpm available on PATH (once per machine). Turborepo needs it.
corepack enable pnpm
#    Windows without admin rights: install the shim into a user folder already on PATH:
#    corepack enable pnpm --install-directory "$(npm config get prefix)"

# 2. Install dependencies (also downloads Prisma's migration engine)
pnpm install

# 3. Create your local env file, then set AUTH_SECRET (and SEED_DEMO_PASSWORD if you want
#    the demo account). Generate a secret with:
#    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
cp .env.example .env

# 4. Start Postgres + Redis, apply migrations, optionally seed synthetic data
pnpm db:up
pnpm db:migrate
pnpm db:seed

# 5. Verify everything
pnpm check
pnpm test:integration
pnpm test:e2e
```

The `.env.example` database values match `docker-compose.yml` and are for local use only.
Docker creates two databases: `job_agent` (development) and `job_agent_test` (tests only).

### Run locally

```bash
pnpm dev                                  # web (http://localhost:3000) + worker together
pnpm --filter @job-agent/web dev          # web only
pnpm --filter @job-agent/worker dev       # worker only (health on http://localhost:8081)
```

Then open <http://localhost:3000>, create an account, and open **Settings**.

Health checks:

- Web: <http://localhost:3000/api/health>. The database shows `up` or `down` (HTTP 503 when down).
- Worker: <http://localhost:8081/health> (liveness, same database probe) and
  <http://localhost:8081/ready>. `/ready` returns `503` by design until queue consumers exist
  (Phase 3).

A dependency shows `not_configured` when its variable is empty, and `not_checked` when it is
configured but no probe exists yet (Redis). Health checks never show a fake `up`.

## Everyday commands

| Command                                                      | What it does                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                 | Format check, lint, typecheck and unit tests. Run before every commit.                                                                                     |
| `pnpm test:integration`                                      | Migrates the `*_test` database, then runs the database-backed tests                                                                                        |
| `pnpm test:e2e`                                              | Playwright (starts its own dev server on port 3100 against the test database). Stop any running `pnpm dev` first: Next allows only one dev server per app. |
| `pnpm build`                                                 | Production build of the web app                                                                                                                            |
| `pnpm db:up` / `pnpm db:down`                                | Start / stop local Postgres and Redis (data is kept in Docker volumes)                                                                                     |
| `pnpm db:migrate`                                            | Apply pending migrations (non-destructive `prisma migrate deploy`)                                                                                         |
| `pnpm db:migrate:dev`                                        | Create a new migration after editing `schema.prisma`                                                                                                       |
| `pnpm db:status`                                             | Show applied and pending migrations                                                                                                                        |
| `pnpm db:seed`                                               | Create or refresh the synthetic demo account                                                                                                               |
| `pnpm db:generate`                                           | Regenerate the Prisma client (also done automatically before typecheck/test/build)                                                                         |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm format` | Individual checks                                                                                                                                          |

## Environment variables

All variables are listed with explanations in [`.env.example`](.env.example). **Never commit
real values.** Local development uses one `.env` at the repository root, which the web app, the
worker, Prisma and the test tools all read. Hosted environments use their own secret stores.
In production, sign-up is closed unless your email is in `AUTH_SIGNUP_ALLOWED_EMAILS`.

## Architecture docs

| Document                                                                    | Topic                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| [system-overview](docs/architecture/system-overview.md)                     | Components, cloud vs local, module boundaries        |
| [agent-execution-flow](docs/architecture/agent-execution-flow.md)           | How the agent loop plans, acts, observes, retries    |
| [application-state-machine](docs/architecture/application-state-machine.md) | Task states, transitions, durability rules           |
| [job-source-connectors](docs/architecture/job-source-connectors.md)         | Connector interface and capability registry          |
| [security-and-permissions](docs/architecture/security-and-permissions.md)   | Trust boundaries, authentication, approvals, secrets |
| [database-design](docs/architecture/database-design.md)                     | Implemented and proposed schema, indexes, retention  |
| [background-processing](docs/architecture/background-processing.md)         | Queue, checkpoints, retries, schedules               |
| [ai-provider-routing](docs/architecture/ai-provider-routing.md)             | Model switching, fallback, costs                     |
| [deployment](docs/architecture/deployment.md)                               | Vercel, worker host, managed services, local agent   |
| [implementation-roadmap](docs/development/implementation-roadmap.md)        | Phases and acceptance criteria                       |
| [decisions](docs/development/decisions.md)                                  | Architecture decision records                        |

## Safety principles (built in from the start)

- Every private record and action is scoped to the authenticated user.
- The agent never invents candidate information, and only reuses answers you have verified.
- Emails are never sent without your explicit approval of the exact content.
- Applications are submitted automatically only where the source **and** your settings
  explicitly allow it. Otherwise everything is prepared and handed to you.
- CAPTCHA, OTP, logins, access blocks and rate limits are never bypassed.
- A submission with an uncertain outcome is verified, never blindly retried.
