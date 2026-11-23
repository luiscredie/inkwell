// Preços › Valor da coleção: "Valor agora" (today's prices, Liga Lorcana where recent, else TCGplayer) and the chart
// (one history, TCGplayer) are two valuations; the page labels the last record, the highest one and why they differ.
// Fixture prices and history, so every number below can be checked by hand. Chromium, and WebKit with PW_WEBKIT=1.
import { test, expect } from '@playwright/test';

const BASE = new URL('precos/', process.env.INKWELL_URL || 'http://localhost:8080/index.html').href;
const ME = '11111111-1111-4111-8111-111111111111';
// A: Liga today (30), TCGplayer 20 · B: TCGplayer normal 10 + foil 15 · C: TCGplayer 4, missing from one snapshot
// D: no price at all · E: normal price only (2), held as a foil → estimated
const [A, B, C, D, E] = ['LOR10-1', 'LOR10-10', 'LOR10-11', 'LOR10-12', 'LOR10-13'];
const PRICES = {
  schema_version: 2, generated_at: new Date().toISOString(), usd_brl: 5, liga_date: new Date().toISOString().slice(0, 10),
  liga_prices: { [A]: { n: 30, nl: 30, nh: 30 } },
  tcg_prices: { [A]: { n: 20, nl: 20, nh: 20 }, [B]: { n: 10, nl: 10, nh: 10, f: 15, fl: 15, fh: 15 }, [C]: { n: 4, nl: 4, nh: 4 } },
  prices: { [A]: { n: 30, nl: 30, nh: 30 }, [B]: { n: 10, nl: 10, nh: 10, f: 15, fl: 15, fh: 15 }, [C]: { n: 4, nl: 4, nh: 4 }, [E]: { n: 2, nl: 2, nh: 2 } },
};
const DAYS = {
  '2026-11-18': { [B]: [1, 1] },                                // covers 1 of 3 cards: left out, and said
  '2026-11-19': { [A]: [10, null], [B]: [8, 12] },               // C missing → today's TCGplayer price (4)
  '2026-11-20': { [A]: [25, null], [B]: [9, 13], [C]: [4, null] },   // the highest
  '2026-11-21': { [A]: [20, null], [B]: [10, 15], [C]: [4, null] },  // the last
};
const COLL = { [A]: { n: 1, f: 0 }, [B]: { n: 1, f: 1 }, [C]: { n: 2, f: 0 }, [D]: { n: 1, f: 0 }, [E]: { n: 0, f: 1 } };

async function setup(page, { collection = COLL, prices = PRICES, days = DAYS } = {}) {
  await page.addInitScript((me) => {
    localStorage.setItem('inkwell-lang', 'pt');
    localStorage.removeItem('inkwell-prices-view-v1');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('inkwell-counter-auth', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ sub: me, exp })) + '.y', refresh_token: 'r', expires_at: exp, user: { id: me, email: 'luis@example.com' } }));
  }, ME);
  await page.route('**/rest/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/rest\/v1\//, '');
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (path === 'inkwell_profiles') return json([{ profile: 'luiscredie', collection, wishlist: {} }]);
    return json([]);
  });
  const json = (v) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('**/data/prices.json', (r) => r.fulfill(json(prices)));
  await page.route('**/data/price-history-tcg.json', (r) => r.fulfill(json({ schema_version: 1, path: 'price-history-tcg/{date}.json', days: Object.keys(days).map((date) => ({ date })) })));
  await page.route('**/data/price-history-tcg/*.json', (r) => { const date = r.request().url().match(/(\d{4}-\d\d-\d\d)\.json/)[1]; r.fulfill(json({ date, usd_brl: 5, prices: days[date] })); });
}
const brl = (s) => s.replace(/\s/g, ' ');

test('Valor agora, last record, highest record and why they differ — each from its own prices', async ({ page }) => {
  await setup(page);
  await page.goto(BASE + '?tab=value');
  // today: A 30 (Liga) + B 10 + 15 + C 2 × 4 + E foil at the normal 2 = 65; D has no price
  await expect(page.getByTestId('value-now')).toHaveText(/R\$\s65,00/);
  await expect(page.getByTestId('value-unpriced')).toHaveText('+ 1 carta sem preço (fora do valor)');
  await expect(page.getByTestId('value-estimated')).toContainText('Inclui 1 foil com preço estimado');
  await expect(page.getByTestId('value-sources')).toHaveText('Valor agora: Liga Lorcana em 1 cópia, TCGplayer em 5 cópias.');
  // chart, TCGplayer only: 19/11 = 10 + 8 + 12 + 8 (C at today's TCGplayer 4) + 2 = 40; 20/11 = 57; 21/11 = 55
  await expect(page.getByTestId('value-last')).toContainText('Último registro · 21 de nov.');
  await expect(page.getByTestId('value-last')).toContainText(/R\$\s55,00/);
  await expect(page.getByTestId('value-peak')).toContainText('Maior valor no gráfico · 20 de nov.');
  await expect(page.getByTestId('value-peak')).toContainText(/R\$\s57,00/);
  await expect(page.getByTestId('value-stats')).toContainText('+37,5%');
  await expect(page.getByTestId('value-stats')).toContainText('No gráfico (3 registros)');
  // the difference (65 − 55 = 10) is explained as possible contributions, not as one cause
  const why = page.getByTestId('value-why');
  expect(brl(await why.locator('p').textContent())).toBe('O “Valor agora” fica R$ 10,00 acima do último registro (21 de nov.). O que pode contribuir para a diferença:');
  await expect(why.locator('li')).toHaveText([
    'preços da Liga Lorcana em 1 das 6 cópias com preço (o gráfico usa só preços do TCGplayer);',
    /^datas diferentes: os preços atuais são de \d+ de \w+\.?, o último registro é de 21 de nov\.;$/,
    '2 cartas sem preço do TCGplayer em alguma data, contadas pelo preço de hoje nessas datas.',
  ]);
  await expect(page.getByTestId('value-chart')).toContainText('1 registro com menos da metade das cartas não aparece.');
  await expect(page.locator('svg.vchart')).toHaveAttribute('aria-label', /último registro R\$\s55,00; maior valor R\$\s57,00 em 20 de nov\./);
});

test('a card with no TCGplayer quote anywhere: its today price counts on every date, so it moves neither the line nor the gap', async ({ page }) => {
  // F: priced only by Liga Lorcana (R$ 6), absent from tcg_prices and from every snapshot
  const F = 'LOR10-14';
  const prices = { ...PRICES, liga_prices: { ...PRICES.liga_prices, [F]: { n: 6, nl: 6, nh: 6 } }, prices: { ...PRICES.prices, [F]: { n: 6, nl: 6, nh: 6 } } };
  await setup(page, { prices, collection: { ...COLL, [F]: { n: 1, f: 0 } } });
  await page.goto(BASE + '?tab=value');
  await expect(page.getByTestId('value-now')).toHaveText(/R\$\s71,00/);   // 65 + 6
  await expect(page.getByTestId('value-last')).toContainText(/R\$\s61,00/);   // 55 + 6
  await expect(page.getByTestId('value-peak')).toContainText(/R\$\s63,00/);   // 57 + 6
  await expect(page.getByTestId('value-stats')).toContainText('+32,6%');   // 46 → 61
  const why = page.getByTestId('value-why');
  await expect(why.locator('p')).toContainText(/R\$\s10,00 acima/);   // the same gap: F is on both sides
  await expect(why.locator('li').nth(0)).toHaveText('preços da Liga Lorcana em 2 das 7 cópias com preço (o gráfico usa só preços do TCGplayer);');
  await expect(why.locator('li').nth(2)).toHaveText('3 cartas sem preço do TCGplayer em alguma data, contadas pelo preço de hoje nessas datas.');
});

test('same source today and in the chart: no difference to explain; the last record is also the highest', async ({ page }) => {
  const prices = { ...PRICES, liga_prices: {}, prices: { ...PRICES.prices, [A]: { n: 20, nl: 20, nh: 20 } } };
  const days = { '2026-11-20': DAYS['2026-11-19'], '2026-11-21': DAYS['2026-11-21'] };
  await setup(page, { prices, days, collection: { [A]: { n: 1, f: 0 }, [B]: { n: 1, f: 1 }, [C]: { n: 2, f: 0 } } });
  await page.goto(BASE + '?tab=value');
  await expect(page.getByTestId('value-now')).toHaveText(/R\$\s53,00/);   // 20 + 10 + 15 + 8
  await expect(page.getByTestId('value-last')).toContainText(/R\$\s53,00/);
  await expect(page.getByTestId('value-peak')).toHaveCount(0);
  await expect(page.getByTestId('value-why')).toHaveCount(0);
  await expect(page.getByTestId('value-sources')).toHaveText('Valor agora: preços do TCGplayer.');
});

for (const w of [320, 360, 390, 430]) {
  test(`phone ${w}px: the whole value fits its card, nothing overflows`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 760 });
    // a large collection: values with five digits and cents
    await setup(page, { collection: { [A]: { n: 900, f: 0 }, [B]: { n: 300, f: 400 }, [C]: { n: 2, f: 0 } } });
    await page.goto(BASE + '?tab=value');
    await expect(page.getByTestId('value-now')).toBeVisible();
    const over = await page.$$eval('[data-testid="value-stats"] .stat b, [data-testid="value-points"] dd, [data-testid="value-points"] dt', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth).map((e) => e.textContent));
    expect(over).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const now = await page.getByTestId('value-now').boundingBox(), cards = await page.locator('[data-testid="value-stats"] .stat').nth(1).boundingBox();
    expect(cards.y).toBeGreaterThan(now.y + now.height - 1);   // "Valor agora" has its own row
  });
}
