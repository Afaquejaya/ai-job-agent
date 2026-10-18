# @job-agent/worker

Persistent Node.js process for background work: queue consumers, scheduled runs (daily
discovery, morning reports), retries and recovery. It runs on a host that keeps processes
alive (not on Vercel), so work continues after the user closes the website.

**Phase 1 status:** starts a health server only. It does not connect to Redis or PostgreSQL
and processes no jobs. `/ready` returns `503` on purpose until queue consumers exist (Phase 3).

| Endpoint      | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `GET /health` | Process is alive. Dependencies show `not_configured` or `not_checked`. |
| `GET /ready`  | Worker can take jobs. Phase 1: always `503`.                           |

```bash
pnpm --filter @job-agent/worker dev
```
