import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only. Integration tests (*.int.test.ts) need PostgreSQL and run through
// vitest.integration.config.ts (`pnpm test:integration`).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
  },
});
