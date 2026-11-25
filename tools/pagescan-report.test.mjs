// tools/pagescan-report.mjs: verdicts, the split of every card into automatic / first suggestion / manual, coverage of
// the protocol, and targets judged only on a complete, real set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verdict, summarise, coverage, targets, report, markdown } from './pagescan-report.mjs';

const R = (truth, status, id, extra = {}) => ({ file: 'a.jpg', device: 'A', cond: 'boa', truth, status, id, group: [], top: [], desktop_ms: 1000, device_s: 3, ...extra });

test('verdict: every case of the protocol', () => {
  assert.equal(verdict(R('X', 'ok', 'X')), 'auto-right');
  assert.equal(verdict(R('X', 'ok', 'Y')), 'false-positive');
  assert.equal(verdict(R(null, 'ok', 'Y')), 'false-positive');
  assert.equal(verdict(R('X', 'check', 'X')), 'first-right');
  assert.equal(verdict(R('X', 'choose', 'Y', { group: ['Y', 'X'] })), 'alt-right');
  assert.equal(verdict(R('X', 'check', 'Y', { top: [{ id: 'Z' }, { id: 'X' }] })), 'alt-right');
  assert.equal(verdict(R('X', 'unknown', null)), 'not-offered');
  assert.equal(verdict(R('X', 'empty', null)), 'card-as-empty');
  assert.equal(verdict(R(null, 'empty', null)), 'empty-right');
  assert.equal(verdict(R(null, 'check', 'Y')), 'empty-asked');
});

test('summarise: automatic + first suggestion + manual + read as empty + false positives = every card', () => {
  const rows = [R('A', 'ok', 'A'), R('B', 'ok', 'A'), R('C', 'check', 'C'), R('D', 'choose', 'X', { group: ['X', 'D'] }), R('E', 'unknown', null), R('F', 'empty', null), R(null, 'empty', null)];
  for (const x of rows) x.v = verdict(x);
  const s = summarise(rows);
  assert.equal(s.cards, 6); assert.equal(s.empty_pockets, 1);
  assert.equal(s.auto_right_pct, 16.7); assert.equal(s.first_right_pct, 16.7); assert.equal(s.manual_pct, 33.3);
  assert.equal(s.false_positive, 1); assert.equal(s.false_positive_cards, 1); assert.equal(s.card_as_empty, 1);
  const parts = rows.filter((x) => x.truth).length;
  assert.equal(['auto-right', 'first-right', 'alt-right', 'not-offered', 'card-as-empty', 'false-positive'].reduce((n, v) => n + rows.filter((x) => x.truth && x.v === v).length, 0), parts);
  assert.equal(s.device_s_median, 3); assert.equal(s.desktop_ms_median, 1000);
});

test('coverage: a small or synthetic set is incomplete and says why; targets are then not judged', () => {
  const truth = { real: false, pages: [{ file: 'a.jpg', device: 'A', cond: 'boa', cards: ['A'] }] };
  const rows = [R('A', 'ok', 'A')]; for (const x of rows) x.v = verdict(x);
  const cov = coverage(truth, rows);
  assert.equal(cov.complete, false);
  assert.ok(cov.missing.some((m) => /sintéticas/.test(m)));
  assert.ok(cov.missing.some((m) => /1 de 30 páginas/.test(m)));
  assert.ok(cov.missing.some((m) => /1 de 3 aparelhos/.test(m)));
  const t = targets(summarise(rows), { A: summarise(rows) }, cov);
  assert.ok(Object.values(t).every((v) => v === 'não avaliável'));
});

// A set that meets every item of section 1: 3 devices (iPhone, Android, an old Android) × 10 pages, per device 4 good
// light and straight, 2 glare, 2 dim, 2 tilted; 18 foil cards on 6 pages; 6 empty pockets on 6 pages; 3 pages with
// the same card twice; 3 pages with a reprint; 2 binders; a phone time on every page.
const CARD = (i) => `LOR13-${i + 1}`;
function fullSet() {
  const pages = [];
  for (const [d, os, older] of [['iPhone 13', 'ios', false], ['Galaxy A54', 'android', false], ['Moto G7 (2019)', 'android', true]]) {
    for (let k = 0; k < 10; k++) {
      const light = k < 6 ? 'boa' : k < 8 ? 'reflexo' : 'fraca', tilt = k === 4 || k === 5;
      const cards = Array.from({ length: 9 }, (_, i) => CARD(i));
      if (k === 0 && d !== 'Moto G7 (2019)') cards[8] = null;                       // empties: 2 devices × 1 page …
      if (k === 1) cards[7] = null;                                                 // … + 3 devices × 1 page = 5 pages …
      if (k === 2 && d === 'iPhone 13') cards[6] = null;                            // … + 1 = 6 pages, 6 pockets
      if (k === 3) cards[1] = cards[0];                                             // the same card twice (3 pages)
      const foil = cards.map((c, i) => !!c && k < 2 && i < 3);                       // 3 per page on 2 pages per device = 18 on 6 pages
      pages.push({ file: `${d}-${k}.jpg`, device: d, os, device_older: older, binder: k % 2 ? 'preto' : 'transparente', light, tilt,
        reprint: k === 9, foil, cards, cond: light, device_s: 2.5, where: os === 'ios' ? 'app-ios' : 'app-android' });
    }
  }
  return { real: true, pages };
}
const rowsOf = (truth) => truth.pages.flatMap((p) => p.cards.map((c, i) => ({ file: p.file, device: p.device, cond: p.cond, i, truth: c, status: c ? 'ok' : 'empty', id: c, group: [], top: [], desktop_ms: 900, device_s: p.device_s })));

test('coverage: a set that meets every item of section 1 is complete', () => {
  const t = fullSet(), cov = coverage(t, rowsOf(t));
  assert.equal(cov.complete, true, cov.missing.join('; '));
  assert.ok(cov.checks.length >= 14);
});

// each item broken alone makes the set incomplete, with the reason said
const broken = {
  'fotos sintéticas': (t) => { t.real = false; },
  '29 páginas': (t) => { t.pages.pop(); },
  'só 2 aparelhos': (t) => { for (const p of t.pages) if (p.device === 'Galaxy A54') p.device = 'iPhone 13'; },
  'nenhum iPhone': (t) => { for (const p of t.pages) if (p.os === 'ios') p.os = 'android'; },
  'sistema não registrado': (t) => { delete t.pages[3].os; },
  'nenhum aparelho antigo': (t) => { for (const p of t.pages) p.device_older = false; },
  'marcação de antigo não registrada': (t) => { delete t.pages[0].device_older; },
  'aparelho com 9 páginas': (t) => { t.pages[29].device = 'Outro'; },
  'sem reflexo num aparelho': (t) => { for (const p of t.pages) if (p.device === 'Galaxy A54' && p.light === 'reflexo') p.light = 'boa'; },
  'só 1 inclinada num aparelho': (t) => { t.pages.find((p) => p.device === 'iPhone 13' && p.tilt).tilt = false; },
  'luz não registrada': (t) => { delete t.pages[5].light; },
  'só 14 foils (ainda em 6 páginas)': (t) => { t.pages.filter((x) => x.foil.some(Boolean)).slice(0, 4).forEach((x) => { x.foil[0] = false; }); },
  'foil por posição não registrado': (t) => { delete t.pages[12].foil; },
  'vazios em só 5 páginas': (t) => { t.pages.find((p) => p.device === 'iPhone 13' && p.file.endsWith('-2.jpg')).cards[6] = 'LOR13-7'; },
  'carta repetida em só 2 páginas': (t) => { const p = t.pages.find((x) => x.file.endsWith('-3.jpg')); p.cards[1] = 'LOR13-2'; },
  'reimpressão em só 2 páginas': (t) => { t.pages.find((p) => p.reprint).reprint = false; },
  'reimpressão não registrada': (t) => { delete t.pages[8].reprint; },
  'um só fichário': (t) => { for (const p of t.pages) p.binder = 'preto'; },
  'fichário não registrado': (t) => { t.pages[2].binder = ''; },
  'página sem tempo no aparelho': (t) => { t.pages[7].device_s = null; },
};
for (const [name, br] of Object.entries(broken)) {
  test(`coverage: ${name} → incompleto`, () => {
    const t = fullSet(); br(t);
    const cov = coverage(t, rowsOf(t));
    assert.equal(cov.complete, false, `${name}: deveria ser incompleto`);
    assert.ok(cov.missing.length >= 1);
    assert.ok(Object.values(targets(summarise(rowsOf(t).map((x) => ({ ...x, v: verdict(x) }))), {}, cov)).every((v) => v === 'não avaliável'));
  });
}

test('a complete real set: targets judged as measured (met and not met)', () => {
  const t = fullSet();
  for (const p of t.pages) if (p.device === 'Moto G7 (2019)') p.device_s = 5.2;
  const r = report(t, rowsOf(t));
  assert.equal(r.coverage.complete, true, r.coverage.missing.join('; '));
  assert.equal(r.targets['Identificação ≥ 95% no total'], 'atingida');
  assert.equal(r.targets['Falso positivo = 0'], 'atingida');
  assert.equal(r.targets['Tempo ≤ 4 s no aparelho mais lento'], 'não atingida');   // the old Moto
  const md = markdown(r);
  assert.match(md, /Fotos:\*\* reais · \*\*Conjunto:\*\* completo/);
  assert.match(md, /\| Moto G7 \(2019\) \| 10 \|/);
});
