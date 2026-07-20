import { defineConfig } from '@playwright/test';

// e2e ходит в реальный devnet: таймауты щедрые, повторов нет (транзакции не идемпотентны).
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  // Пользуемся уже запущенным dev-сервером (next dev на 3000).
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
});
