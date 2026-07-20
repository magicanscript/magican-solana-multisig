import { defineConfig } from '@playwright/test';

// e2e goes to the real devnet: timeouts are generous, no retries (transactions aren't idempotent).
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  // We use the already running dev server (next dev on 3000).
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
});
