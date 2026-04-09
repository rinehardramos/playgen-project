import { test, expect } from '@playwright/test';

/**
 * /programs/new station-picker states (issue #249)
 *
 * The page fetches /api/v1/companies/:id/stations and renders one of three states:
 *   0 stations → CTA card linking to /stations
 *   1 station  → auto-selects station, full form shown, no picker
 *   ≥2 stations → dropdown picker shown
 *
 * We intercept the auth + stations API calls so these tests run without a live stack.
 */

const COMPANY_ID = 'company-1';
const JWT = 'test-token';

function mockAuth(page: import('@playwright/test').Page) {
  // getCurrentUser() reads from localStorage — set it before navigation.
  return page.addInitScript(() => {
    window.localStorage.setItem(
      'playgen_user',
      JSON.stringify({ company_id: 'company-1', id: 'user-1', role: 'admin' }),
    );
    window.localStorage.setItem('playgen_token', 'test-token');
  });
}

function stubStations(page: import('@playwright/test').Page, stations: { id: string; name: string }[]) {
  return page.route(`**/api/v1/companies/${COMPANY_ID}/stations`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stations) });
  });
}

function stubTemplates(page: import('@playwright/test').Page) {
  return page.route('**/api/v1/stations/*/templates', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// State 1 — zero stations
// ──────────────────────────────────────────────────────────────────────────────
test('zero stations — shows CTA card, not an error', async ({ page }) => {
  await mockAuth(page);
  await stubStations(page, []);
  await stubTemplates(page);

  await page.goto('/programs/new');

  // CTA card must be visible
  await expect(page.getByRole('heading', { name: /you need a station first/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /create a station/i })).toHaveAttribute('href', '/stations');

  // Form must not be rendered
  await expect(page.getByRole('button', { name: /create/i })).not.toBeVisible();

  // The red "Please select a station" error must not appear
  await expect(page.getByText(/please select a station/i)).not.toBeVisible();
});

// ──────────────────────────────────────────────────────────────────────────────
// State 2 — exactly one station
// ──────────────────────────────────────────────────────────────────────────────
test('one station — auto-selects, no dropdown shown', async ({ page }) => {
  await mockAuth(page);
  await stubStations(page, [{ id: 'station-1', name: 'WKRP Cincinnati' }]);
  await stubTemplates(page);

  await page.goto('/programs/new');

  // Full form must be present
  await expect(page.getByLabel(/program name/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /create & set up clock/i })).toBeVisible();

  // No station picker dropdown
  await expect(page.getByLabel(/station/i)).not.toBeVisible();
});

// ──────────────────────────────────────────────────────────────────────────────
// State 3 — multiple stations
// ──────────────────────────────────────────────────────────────────────────────
test('multiple stations — shows station dropdown', async ({ page }) => {
  await mockAuth(page);
  await stubStations(page, [
    { id: 'station-1', name: 'WKRP Cincinnati' },
    { id: 'station-2', name: 'WMTY Detroit'    },
  ]);
  await stubTemplates(page);

  await page.goto('/programs/new');

  // Station picker must be present with both options
  const select = page.getByLabel(/station/i);
  await expect(select).toBeVisible();
  await expect(select.getByRole('option', { name: 'WKRP Cincinnati' })).toBeAttached();
  await expect(select.getByRole('option', { name: 'WMTY Detroit' })).toBeAttached();

  // Full form must also be present
  await expect(page.getByLabel(/program name/i)).toBeVisible();
});
