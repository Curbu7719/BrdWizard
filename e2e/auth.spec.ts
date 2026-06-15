/**
 * E2E: Authentication flow — Login page (S1)
 *
 * Covers:
 *   - Page renders username/password fields and Sign In button
 *   - Invalid credentials show an error message
 *   - Valid credentials redirect to the dashboard
 *   - Unauthenticated navigation to /brd/:id redirects to /login
 *
 * GATED: All tests skip when VITE_SUPABASE_URL is a placeholder.
 * Set E2E_EMAIL and E2E_PASSWORD env vars for the test user account.
 */

import { test, expect } from '@playwright/test';
import { isSupabaseConfigured, E2E_EMAIL, E2E_PASSWORD, loginAs } from './helpers';

const SKIP_REASON = 'Requires a live Supabase project (VITE_SUPABASE_URL placeholder detected)';

test.describe('Login page — structure', () => {
  test('renders the login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('Sign In button is disabled when fields are empty', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  test('Sign In button enables when both fields are filled', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });
});

test.describe('Login — authentication (requires Supabase)', () => {
  test.beforeEach(() => {
    test.skip(!isSupabaseConfigured(), SKIP_REASON);
  });

  test('shows error message for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('wrong@vodafone.com.tr');
    await page.getByLabel(/password/i).fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid username or password/i, {
      timeout: 10_000,
    });
  });

  test('redirects to dashboard on valid login', async ({ page }) => {
    await loginAs(page, E2E_EMAIL, E2E_PASSWORD);
    await expect(page).toHaveURL('/');
  });

  test('unauthenticated access to /brd/:id redirects to /login', async ({ page }) => {
    // Navigate directly to a workspace URL without being logged in
    await page.goto('/brd/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
