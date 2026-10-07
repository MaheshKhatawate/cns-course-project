import { defineConfig } from 'vitest/config';

// Runs against a real PostgreSQL database (DATABASE_URL). See README → Testing.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
