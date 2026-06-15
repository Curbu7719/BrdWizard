import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for BRD Wizard.
 *
 * Tests require a live Supabase project. They are guarded with
 * `test.skip` when VITE_SUPABASE_URL is a placeholder, so running
 * `npm run e2e` against a dev environment with placeholders will simply
 * skip all specs rather than hard-failing.
 *
 * To run E2E tests against a real environment:
 *   1. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
 *   2. Set E2E_EMAIL and E2E_PASSWORD environment variables for the test user
 *   3. Run: npm run e2e
 *
 * To run with interactive UI:
 *   npm run e2e:ui
 */
export default defineConfig({
  testDir: './e2e',
  /* Each test file runs in isolation with a fresh browser context */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in source */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* Desktop-first per UI-UX-SPEC.md §0 — min 1280px */
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start the Vite dev server before E2E tests run */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
