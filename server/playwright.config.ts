import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Isolated run: a throwaway DB + vault in a temp dir, a stable session secret, a fixed port.
// The webServer seeds this DB (user `dev` / `Password123!` + sample data) then serves the app.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tdx-e2e-'));
const PORT = 3117;
const baseURL = `http://127.0.0.1:${PORT}`;
const serverEnv = {
  ...process.env,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  DB_PATH: path.join(TMP, 'tdx.e2e.db'),
  VAULT_DIR: path.join(TMP, 'vault'),
  SESSION_SECRET: 'e2e-secret-stable',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one server + DB; serial avoids write races
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/state.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npx tsx scripts/seed-dev.ts && npx tsx src/app.ts',
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: serverEnv,
  },
});
