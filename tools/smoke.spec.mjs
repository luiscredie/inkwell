// Inkwell browser smoke test (M0R.1).
// Serve the deployed application root before running:
//   (cd site && python3 -m http.server 8080) &
//   INKWELL_URL=http://localhost:8080/index.html npx playwright test tools/smoke.spec.mjs
import { test, expect } from '@playwright/test';

const URL = process.env.INKWELL_URL || 'http://localhost:8080/index.html';

async function openView(page, label) {
  const button = page.locator('#rail button', { hasText: label }).first();
  await expect(button).toBeVisible();
  await button.click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const profile = {
      _schema: 2,
      display_name: 'Smoke Test',
      collection: { 'LOR9-45': { n: 4, f: 0 } },
      decks: [{
        id: 'smoke-deck',
        name: 'Smoke Deck',
        colors: ['Sapphire'],
        format: 'core',
        cards: {},
        notes: '',
        targetCopies: 1,
        portfolioPriority: 0,
      }],
      matches: [],
      overrides: {},
      wishlist: {},
      learnDone: {},
      activeDeckId: 'smoke-deck',
    };
    localStorage.setItem('inkwell_user_luiscredie', JSON.stringify(profile));
    localStorage.removeItem('inkwell_backup_luiscredie');
    localStorage.setItem('inkwell_active_user', 'luiscredie');
  });
});

test.describe('Inkwell release smoke', () => {
  test('boots without fatal runtime or data errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    await expect(page.locator('text=Data could not be loaded')).toHaveCount(0);
    await expect(page.locator('#rail button').first()).toBeVisible();
    expect(errors.join('\n')).not.toMatch(
      /ReferenceError|TypeError|SyntaxError|is not defined|Unexpected token/
    );
  });

  test('primary navigation reaches Decks, Matches, and Learn', async ({ page }) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await openView(page, /Decks/);
    await openView(page, /Matches|Partidas/);
    await openView(page, /Learn|Aprender/);
  });

  test('deck builder shows its full range and rejects a copy-limit add', async ({ page }) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await openView(page, /Decks/);

    const deckCard = page.locator('[data-testid="deck-card"]').first();
    await expect(deckCard).toBeVisible();
    await deckCard.click();

    const edit = page.locator('[data-testid="deck-edit-toggle"]');
    await expect(edit).toBeVisible();
    await edit.click();

    const range = page.locator('[data-testid="builder-range"]');
    await expect(range).toBeVisible();
    await expect(range).toHaveText(/\d+–\d+ \/ \d+/);

    // Build the copy-limit state from a card the current production dataset
    // declares legal for this deck. This avoids coupling the smoke fixture to a
    // specific printing or to future Core rotation changes.
    const candidate = page.locator(
      '[data-testid="builder-card"][data-invalid="false"]'
    ).first();
    await expect(candidate).toBeVisible();
    const candidateId = await candidate.getAttribute('data-card-id');
    expect(candidateId).toBeTruthy();

    const invalidCard = page.locator(
      `[data-testid="builder-card"][data-card-id="${candidateId}"]`
    );
    const cardCount = invalidCard.locator('[data-testid="builder-card-count"]');
    const total = page.locator('[data-testid="deck-total"]');
    await expect(cardCount).toHaveText('0');

    for (let copies = 1; copies <= 4; copies += 1) {
      await invalidCard.locator('[data-testid="builder-add"]').click();
      await expect(cardCount).toHaveText(String(copies));
    }

    await expect(invalidCard).toHaveAttribute('data-invalid', 'true');
    await expect(invalidCard).toBeVisible();
    await expect(invalidCard.locator(
      '[data-testid="builder-invalid-warning"]'
    )).toBeVisible();

    const countBefore = (await cardCount.innerText()).trim();
    const totalBefore = (await total.innerText()).trim();

    await invalidCard.locator('[data-testid="builder-add"]').click();
    await expect(page.locator('[data-testid="toast"]')).toContainText(
      /Copy limit reached/
    );
    await expect(cardCount).toHaveText(countBefore);
    await expect(total).toHaveText(totalBefore);
  });

  test('set-number sort and modal navigation preserve card identity and art', async ({ page }) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await openView(page, /Collection|Coleção|Cards/);

    const sort = page.locator('[data-testid="collection-sort"]');
    await expect(sort).toBeVisible();
    await sort.selectOption('setnum');
    await expect(sort).toHaveValue('setnum');

    // Collection defaults to Owned. The seeded smoke profile intentionally owns
    // one card, so switch to All before testing cross-card modal navigation.
    const allMode = page.locator(
      '[data-testid="collection-sort"] + div button'
    ).filter({ hasText: /^(All|Todos)$/ }).first();
    await expect(allMode).toBeVisible();
    await allMode.click();

    const cards = page.locator('[data-testid="collection-card"]');
    expect(await cards.count()).toBeGreaterThan(2);

    await expect.poll(async () => cards.evaluateAll(elements =>
      elements.findIndex((element, index) => {
        const image = element.querySelector('img');
        const nextImage = elements[index + 1]?.querySelector('img');
        return index > 0 && index < elements.length - 1 &&
          image && image.complete && image.naturalWidth > 0 &&
          nextImage && nextImage.complete && nextImage.naturalWidth > 0;
      })
    )).not.toBe(-1);

    // expect.poll returns no value, so resolve the verified index once more.
    const index = await cards.evaluateAll(elements =>
      elements.findIndex((element, position) => {
        const image = element.querySelector('img');
        const nextImage = elements[position + 1]?.querySelector('img');
        return position > 0 && position < elements.length - 1 &&
          image && image.complete && image.naturalWidth > 0 &&
          nextImage && nextImage.complete && nextImage.naturalWidth > 0;
      })
    );
    const currentId = await cards.nth(index).getAttribute('data-card-id');
    const expectedNextId = await cards.nth(index + 1).getAttribute('data-card-id');

    await cards.nth(index).click();
    const modal = page.locator('[data-testid="card-modal"]');
    await expect(modal).toBeVisible();
    await expect(page.getByText(/Lowest · Liga|Menor · Liga/).first()).toBeVisible();

    const art = page.locator('[data-testid="modal-card-art"]');
    await expect(art).toBeVisible();
    await expect.poll(() => art.evaluate(image =>
      image.complete && image.naturalWidth > 0
    )).toBe(true);
    await expect(art).toHaveAttribute('data-cid', currentId);
    await expect(page.locator('[data-testid="modal-prev"]')).toBeEnabled();
    await expect(page.locator('[data-testid="modal-next"]')).toBeEnabled();

    await page.keyboard.press('ArrowRight');
    await expect(art).toHaveAttribute('data-cid', expectedNextId);
    await page.keyboard.press('ArrowLeft');
    await expect(art).toHaveAttribute('data-cid', currentId);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    await cards.first().click();
    await expect(page.locator('[data-testid="card-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="modal-prev"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="card-modal"]')).toHaveCount(0);
  });

  test('Overview shows gameplay KPIs before Collection Value, and price movers exist', async ({ page }) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await openView(page, /Overview|Visão/);
    const ready = page.locator('[data-testid="kpi-ready"]');
    const value = page.locator('[data-testid="collection-value"]');
    await expect(ready).toBeVisible();
    await expect(value).toBeVisible();
    // gameplay KPI precedes financial value in DOM order
    const order = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="kpi-ready"]');
      const v = document.querySelector('[data-testid="collection-value"]');
      return r && v ? (r.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'before' : 'after' : 'missing';
    });
    expect(order).toBe('before');

    await openView(page, /Prices|Preços/);
    const movers = page.locator('[data-testid="price-movers"]');
    const insufficient = page.getByText(/Not enough price history|Ainda não há histórico/);
    // either the movers boxes or the insufficient-history state must be present
    expect((await movers.count()) + (await insufficient.count())).toBeGreaterThan(0);
  });
  test('V4 portfolio advisor plan and shared cards', async ({ page }) => {
    // Deterministic fixture: fresh CI browser context; seed the active profile with a
    // guaranteed shared-card conflict (1 owned copy, two decks needing 2 each).
    await page.addInitScript(() => {
      const user = {
        _schema: 2,
        collection: { 'LOR9-45': { n: 1, f: 0 } },
        decks: [
          { id: 'v4a', name: 'V4 Fixture A', colors: ['Amber'], format: 'core', cards: { 'LOR9-45': 2 }, targetCopies: 1 },
          { id: 'v4b', name: 'V4 Fixture B', colors: ['Amber'], format: 'core', cards: { 'LOR9-45': 2 }, targetCopies: 1 },
        ],
        matches: [], overrides: {}, wishlist: {}, learnDone: {},
      };
      localStorage.setItem('inkwell_active_user', 'luiscredie');
      localStorage.setItem('inkwell_user_luiscredie', JSON.stringify(user));
    });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.locator('#rail button', { hasText: /Decks/ }).first().click();
    const adv = page.locator('button', { hasText: /Deck Advisor|Consultor/ }).first();
    await expect(adv).toBeVisible();
    await adv.click();
    // plan summary present, raw keys absent
    await expect(page.getByText(/Deck portfolio plan|Plano para seus decks/)).toBeVisible();
    // targetCopies control is mandatory
    const plus = page.locator('button', { hasText: '+' }).first();
    await expect(plus).toBeVisible();
    await plus.click();
    // shared cards section with the seeded conflict listing both decks
    const shared = page.getByText(/Shared cards|Cartas compartilhadas/).first();
    await expect(shared).toBeVisible();
    await expect(page.getByText('V4 Fixture A').first()).toBeVisible();
    await expect(page.getByText('V4 Fixture B').first()).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/portfolioHead|portfolioMissing|undefined|NaN|\[object Object\]/);
  });

});
