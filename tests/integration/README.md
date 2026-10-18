# Integration tests

Tests that need real infrastructure (PostgreSQL, later Redis).

**Where they live (decision D-019):** package-level integration tests sit next to the code as
`*.int.test.ts`:

- `packages/database/src/repositories.int.test.ts`: migrations, repositories, user isolation,
  the append-only audit log, and the CHECK constraints.
- `apps/web/src/app/api/settings/settings.int.test.ts`: real sign-up and sign-in through
  Better Auth, the settings API, cross-user isolation, validation, and the health probe.

This folder is reserved for future tests that span several apps (for example web + worker +
queue in Phase 3).

Run them with:

```bash
pnpm db:up
pnpm test:integration
```

They only ever use the database named in `TEST_DATABASE_URL`, which must end in `_test`. They
apply migrations with the non-destructive `prisma migrate deploy` and never reset or drop
anything (decision D-021).
