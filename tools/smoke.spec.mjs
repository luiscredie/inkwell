// Inkwell browser smoke test (M0R). Real Playwright spec.
// Run against a local static serve of the repository root (default
// http://localhost:8080). The candidate site/index.html must first be copied to
// root index.html so relative data/, users/, ink/, images/, and support.js paths
// match production.
//   npm i -D @playwright/test && npx playwright install chromium
//   cp site/index.html index.html && cp site/support.js support.js
//   python3 -m http.server 8080 &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/smoke.spec.mjs
//
// Execution is unverified in the authoring environment (no runner); the assertions
// below are the M0R smoke contract and run in any Playwright-capable CI.
import { test, expect } from '@playwright/test';

const URL = process.env.INKWELL_URL || 'http://localhost:8080/index.html';

async function boot(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header h1')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Data could not be loaded')).toHaveCount(0);
}

test.describe('Inkwell smoke', () => {
  test('boots without fatal data error', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await boot(page);
    await expect(page.locator('#rail button').first()).toBeVisible();
    expect(errors.join('\n')).not.toMatch(/ReferenceError|is not defined|Unexpected token/);
  });

  test('primary navigation reaches Decks, Matches, Learn', async ({ page }) => {
    await boot(page);
    for (const [label, heading] of [
      [/Decks/, /DECKS/],
      [/Matches|Partidas/, /MATCHES|PARTIDAS/],
      [/Learn|Aprender/, /LEARN|APRENDER/],
    ]) {
      const btn = page.locator('#rail button', { hasText: label }).first();
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(page.locator('header h1')).toHaveText(heading);
    }
  });

  test('deck builder paginates and rejects invalid adds', async ({ page }) => {
    await boot(page);
    await page.locator('#rail button', { hasText: /Decks/ }).first().click();
    const deck = page.getByRole('button', { name: /Amber\/Ruby Midrange/ }).first();
    await expect(deck).toBeVisible();
    await deck.click();
    await expect(page.getByText('Amber/Ruby Midrange', { exact: true }).first()).toBeVisible();

    const edit = page.getByRole('button', { name: /Edit cards|Editar/ }).first();
    await expect(edit).toBeVisible();
    await edit.click();
    await expect(page.getByText(/\d+–\d+ \/ \d+ cards/).first()).toBeVisible();

    // The builder initially filters to the deck's two inks. Add Emerald to the
    // pool so an off-color card is visible, then assert the attempted add is
    // rejected by the authoritative validator.
    await page.getByRole('button', { name: 'Emerald' }).first().click();
    const invalidBadge = page.locator('[title^="Off-color for this deck"]').first();
    await expect(invalidBadge).toBeVisible();
    const invalidCard = invalidBadge.locator('..');
    const before = await invalidCard.locator('span').filter({ hasText: /^\d+$/ }).last().textContent();
    await invalidCard.getByRole('button', { name: '+' }).click();
    await expect(page.getByText(/⚠ Off-color for this deck/)).toBeVisible();
    await expect(invalidCard.locator('span').filter({ hasText: /^\d+$/ }).last()).toHaveText(before || '0');
  });

  test('card modal shows full art and price label', async ({ page }) => {
    await boot(page);
    await page.locator('#rail button', { hasText: /Collection|Coleção|Cards/ }).first().click();
    const tile = page.locator('[role="button"][aria-label]').first();
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page.locator('.ink-card-modal img[data-cid]')).toBeVisible();
    await expect(page.getByText(/Lowest · Liga|Menor · Liga/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ink-card-modal')).toHaveCount(0);
  });
});
