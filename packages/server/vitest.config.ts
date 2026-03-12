import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Each test file runs in its own isolated worker (fork), so module-level
    // singletons (DB, config, rate-limit map) are always fresh per file.
    pool: 'forks',
    // Suppress noisy Fastify/MCP logs during tests
    silent: false,
  },
});
