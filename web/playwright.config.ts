import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uv run voyara-server',
      cwd: '../server',
      url: 'http://127.0.0.1:8000/api/tiers',
      env: { VOYARA_WEB_BASE_URL: 'http://localhost:5173' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173/quote/',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
