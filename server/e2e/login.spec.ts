// login.spec.ts — the raw login flow (no saved session).
import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('login: seeded credentials reach the app shell', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('dev');
  await page.getByTestId('login-password').fill('Password123!');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
});
