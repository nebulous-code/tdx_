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

// A created task must survive a full reload — i.e. the debounced diff-sync actually
// persisted it to the DB, not just painted it optimistically. This is the failure the
// other smokes CAN'T see (they assert the optimistic row) and the scariest one: silent
// data loss when sync breaks.
test('a created task survives a full reload (real persistence)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const title = `e2e persist ${uniq()}`;
  const qa = page.getByTestId('task-quickadd');
  await qa.click();
  await qa.fill(title);
  // arm the wait BEFORE committing: the create POST fires ~300ms later (debounced persist)
  const posted = page.waitForResponse(
    (r) => /\/api\/tasks$/.test(r.url()) && r.request().method() === 'POST' && r.ok(),
  );
  await qa.press('Enter');
  await posted; // the server has the task
  await page.reload(); // boot from scratch — bootstrap must return it from the DB
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('task-title').filter({ hasText: title })).toBeVisible();
});

// Completing a recurring task must spawn its next occurrence (the recurrence engine wired
// to completion, end-to-end). Uses the seeded "Water the tomatoes" (every 3 days). Retry-safe:
// completing one occurrence spawns another, so an open occurrence is always present.
test('completing a recurring task spawns the next occurrence', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const q = page.getByTestId('query-input');
  await q.click();
  await q.fill('recurring:true'); // surface the seeded recurring tasks
  await q.press('Enter');
  // an OPEN (not yet completed) occurrence of the seeded recurring task
  const row = page.locator('.task:not(.done)', { hasText: 'Water the tomatoes' }).first();
  await expect(row).toBeVisible();
  await row.locator('.checkbox').click(); // complete it → runs the recurrence engine
  await expect(page.getByTestId('toast').filter({ hasText: '↻ next' })).toBeVisible();
});

// The app is keyboard-first, so prove the core list loop: j/k move the cursor, e opens the
// task drawer, esc closes it. If this works the keyboard model is wired; if it's broken here
// it's broken everywhere.
test('keyboard: j/k move the cursor and e opens/closes the task drawer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('task-row').first()).toBeVisible();
  await page.locator('.list-head .grow').click(); // blur any input so the list keymap is live
  const sel = page.locator('.task.sel');
  await page.keyboard.press('j'); // land the cursor on a row
  await expect(sel).toHaveCount(1);
  const firstTitle = await sel.getByTestId('task-title').textContent();
  await page.keyboard.press('j'); // move to a different row
  await expect(async () => {
    expect(await page.locator('.task.sel').getByTestId('task-title').textContent()).not.toBe(firstTitle);
  }).toPass();
  await page.keyboard.press('e'); // open the task detail drawer
  await expect(page.getByTestId('app-shell')).toHaveClass(/detail-open/);
  await page.keyboard.press('Escape'); // close it
  await expect(page.getByTestId('app-shell')).not.toHaveClass(/detail-open/);
});
