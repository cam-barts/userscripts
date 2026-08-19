import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // .e2e.js, not .spec.js: vitest's default include would otherwise collect
  // these and blow up on the @playwright/test import during `npm test`.
  testMatch: '**/*.e2e.js',
  fullyParallel: true,
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
