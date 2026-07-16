// smoke.spec.ts — critical-path smokes across the three apps. Run authenticated (the
// `setup` project logs in + saves the session). Each test creates a UNIQUELY-named item
// and asserts its own, so the suite needs no reset. Assertions favor the toast ("it
// happened") + the rendered entity over relying on the debounced sync.
import { expect, test } from '@playwright/test';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test('create a task', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const title = `e2e task ${uniq()}`;
  const qa = page.getByTestId('task-quickadd');
  await qa.click(); // click, don't press `i` — dodges the focus-gated keyboard shortcut
  await qa.fill(title);
  await qa.press('Enter');
  await expect(page.getByTestId('toast').filter({ hasText: 'task added' })).toBeVisible();
  await expect(page.getByTestId('task-title').filter({ hasText: title })).toBeVisible();
});

test('run a query', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const q = page.getByTestId('query-input');
  await q.click();
  await q.fill('status:open');
  await q.press('Enter');
  // the seed has open tasks, so at least one row must render
  await expect(page.getByTestId('task-row').first()).toBeVisible();
});

test('create an event via the drawer', async ({ page }) => {
  await page.goto('/#/events');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.locator('.cal-grid')).toBeVisible(); // wait for the lazy-loaded calendar
  await page.keyboard.press('I'); // open the event editor for the cursor day (Events app)
  const title = page.getByTestId('event-title');
  await expect(title).toBeVisible();
  await title.fill(`e2e event ${uniq()}`);
  await page.getByTestId('event-create').click();
  // the editor closes the drawer on a successful save (no toast on this path)
  await expect(page.getByTestId('event-drawer')).toBeHidden();
});

test('create a note', async ({ page }) => {
  await page.goto('/#/notes');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const qa = page.getByTestId('note-quickadd'); // present once the lazy notes app renders
  await expect(qa).toBeVisible();
  const title = `e2e note ${uniq()}`;
  await qa.click();
  await qa.fill(title);
  await qa.press('Enter');
  await expect(page.getByTestId('note-editor')).toBeVisible();
  await expect(page.getByTestId('note-title')).toHaveValue(title);
});
