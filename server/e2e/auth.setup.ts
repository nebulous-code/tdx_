// auth.setup.ts — log in once as the seeded dev user and save the session, so the
// authenticated smokes start logged in. (The raw login flow itself is covered by login.spec.ts.)
import fs from 'node:fs';
import { expect, test as setup } from '@playwright/test';

const STATE = 'e2e/.auth/state.json';

setup('authenticate', async ({ page }) => {
  fs.mkdirSync('e2e/.auth', { recursive: true });
  await page.goto('/');
  await page.getByTestId('login-username').fill('dev');
  await page.getByTestId('login-password').fill('Password123!');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.context().storageState({ path: STATE });
});
