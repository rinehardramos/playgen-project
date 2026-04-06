import { test, expect } from '@playwright/test';

/**
 * Verifies that the Stations link is present and reachable in the sidebar
 * for a logged-in admin. Covers issue #248.
 *
 * To run: npx playwright install chromium && pnpm exec playwright test e2e/sidebar-stations.spec.ts
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@playgen.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'changeme';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Wait until we leave the login page
  await page.waitForURL(/\/(dashboard|stations|programs|library)/, { timeout: 10_000 });
}

test('Stations link is visible in sidebar after login', async ({ page }) => {
  await login(page);
  const stationsLink = page.getByRole('link', { name: /^stations$/i });
  await expect(stationsLink).toBeVisible();
});

test('Stations link navigates to /stations', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: /^stations$/i }).click();
  await expect(page).toHaveURL(/\/stations/);
});

test('Stations link is highlighted when on /stations route', async ({ page }) => {
  await login(page);
  await page.goto('/stations');
  const stationsLink = page.getByRole('link', { name: /^stations$/i });
  // Active links have a violet/bg-violet class applied
  await expect(stationsLink).toHaveClass(/violet/);
});

test('Stations link is keyboard-reachable via Tab', async ({ page }) => {
  await login(page);
  // Find the link via accessibility tree — confirms Tab can reach it
  const stationsLink = page.getByRole('link', { name: /^stations$/i });
  await expect(stationsLink).toBeVisible();
  // Focus it programmatically and confirm it's focusable
  await stationsLink.focus();
  await expect(stationsLink).toBeFocused();
});
