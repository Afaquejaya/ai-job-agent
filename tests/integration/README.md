# Integration tests

Tests that need real infrastructure (PostgreSQL, Redis) and cross several packages, for example
"a task transition writes the event and checkpoint in one transaction" or "user A cannot read
user B's application".

Phase 1: empty. The runner and a disposable database/Redis setup arrive with Phase 2 and 3.
Unit tests live next to the code (`*.test.ts`) and run with `pnpm test`.
