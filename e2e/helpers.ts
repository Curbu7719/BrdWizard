/**
 * Shared helpers for BRD Wizard E2E tests.
 */

import { type Page, expect } from '@playwright/test';

/**
 * Returns true when a real Supabase project is configured.
 * Tests call test.skip(!isSupabaseConfigured(), '...') to gate themselves.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.VITE_SUPABASE_URL ?? '';
  return url.length > 0 && !url.includes('placeholder') && url.startsWith('https://');
}

/** Credentials injected from environment for the dedicated E2E test user. */
export const E2E_EMAIL = process.env.E2E_EMAIL ?? '';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? '';

/**
 * Log in via the login page and wait for the dashboard to appear.
 * Assumes the page starts at baseURL (/login or redirected there).
 */
export async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Wait for dashboard redirect
  await expect(page).toHaveURL('/', { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /my brds/i })).toBeVisible({ timeout: 10_000 });
}

/**
 * Creates a new BRD from the dashboard and navigates to its workspace.
 * Returns the BRD page URL.
 */
export async function createNewBrd(page: Page): Promise<string> {
  await page.getByRole('button', { name: /\+ new brd/i }).click();
  // Should navigate to /brd/:id
  await page.waitForURL(/\/brd\/[a-z0-9-]+/, { timeout: 10_000 });
  return page.url();
}

/**
 * Waits for the AI greeting message to appear in the chat panel.
 */
export async function waitForGreeting(page: Page) {
  await expect(
    page.getByText(/hello.*brd assistant/i).or(page.getByText(/what would you like to document/i))
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Sends a chat message and waits for the streaming response to complete.
 * "Complete" means the send button becomes re-enabled.
 */
export async function sendChatMessage(page: Page, text: string) {
  const textarea = page.getByPlaceholder(/type your message/i);
  await textarea.fill(text);
  await page.getByRole('button', { name: /send/i }).click();
  // Wait for streaming to finish — send button re-enables
  await expect(page.getByRole('button', { name: /send/i })).toBeEnabled({ timeout: 30_000 });
}
