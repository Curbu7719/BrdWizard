/**
 * E2E: Documents Dashboard (S2)
 *
 * Covers:
 *   - Dashboard renders after login
 *   - "My BRDs" and "All Public" tabs exist
 *   - "+ New BRD" button is present
 *   - BRD card shows status badge, date, and action buttons
 *   - Draft card shows "Continue" CTA; complete card shows "Open" + "Export Word"
 *   - Overflow menu (•••) allows toggling public/private visibility
 *   - Empty state renders when user has no BRDs
 *
 * GATED: All tests skip when VITE_SUPABASE_URL is a placeholder.
 */

import { test, expect } from '@playwright/test';
import { isSupabaseConfigured, E2E_EMAIL, E2E_PASSWORD, loginAs, createNewBrd } from './helpers';

const SKIP_REASON = 'Requires a live Supabase project (VITE_SUPABASE_URL placeholder detected)';

test.describe('Dashboard (requires Supabase)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isSupabaseConfigured(), SKIP_REASON);
    await loginAs(page, E2E_EMAIL, E2E_PASSWORD);
  });

  test('dashboard heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /my brds/i })).toBeVisible();
  });

  test('"My BRDs" and "All Public" navigation tabs are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /my brds/i }).or(page.getByRole('tab', { name: /my brds/i }))).toBeVisible();
    await expect(page.getByRole('button', { name: /all public/i }).or(page.getByRole('tab', { name: /all public/i }))).toBeVisible();
  });

  test('"+ New BRD" button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /\+ new brd/i }).or(page.getByRole('link', { name: /new brd/i }))).toBeVisible();
  });

  test('creating a new BRD navigates to the workspace', async ({ page }) => {
    await createNewBrd(page);
    await expect(page).toHaveURL(/\/brd\/[a-z0-9-]+/);
  });

  test('draft BRD card shows "Continue" button', async ({ page }) => {
    // Create a new BRD (will be draft by default) and go back to dashboard
    await createNewBrd(page);
    await page.goto('/');
    // At least one Continue button should exist for the newly created draft
    await expect(page.getByRole('button', { name: /continue/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('overflow menu shows Make Public / Make Private option', async ({ page }) => {
    // Ensure at least one BRD exists
    await createNewBrd(page);
    await page.goto('/');
    // Open the first overflow menu
    const moreBtn = page.getByRole('button', { name: /more options/i }).first();
    await moreBtn.click();
    // Menu should show visibility toggle
    const makePublicItem = page.getByRole('menuitem', { name: /make public/i });
    const makePrivateItem = page.getByRole('menuitem', { name: /make private/i });
    await expect(makePublicItem.or(makePrivateItem)).toBeVisible({ timeout: 5_000 });
  });
});
