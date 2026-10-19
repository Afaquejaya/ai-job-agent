import { defineConfig } from 'vitest/config';

// Unit tests only. Integration tests (*.int.test.ts) need Redis and run through
// vitest.integration.config.ts (`pnpm test:integration`).
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
  },
});
