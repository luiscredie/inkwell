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
  assert.equal(verdict(R('X', 'check', 'Y', { top: ['Z', 'X'] })), 'alt-right');   // the site's A3 record keeps ids
  assert.equal(verdict(R('X', 'check', 'Y', { top: ['Z'] })), 'not-offered');
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

// §6: video × photo, from the site's A3 records, with the same verdict and summary as the bench
import { a3Compare, a3Markdown, mcnemar, uaInfo } from './pagescan-report.mjs';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
const AND = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
// a record: video reads every card as the engine's first suggestion; the photo reads them automatically, except where told
function rec(name, cards, { ua = AND, used = 'foto', fotoWrong = [], videoWrong = [], ready = 2400 } = {}) {
  const pk = (wrong, auto) => cards.map((c, i) => (!c ? { status: 'empty', id: null, group: [], top: [] } : wrong.includes(i) ? { status: 'check', id: 'LOR1-1', group: [], top: ['LOR1-1', c] }
    : { status: auto ? 'ok' : 'check', id: c, group: [], top: [c] }));
  return { a3: 1, name, ua, used, fallback: used === 'foto' ? null : 'no-imagecapture', align: 0.9, aligned: used === 'foto', times: { frameMs: 40, stillMs: 900, alignMs: 300 }, seen: { ready },
    modes: { video: { px: '1080x1920', engineMs: 1500, ocrMs: 200, pockets: pk(videoWrong, false) }, foto: used === 'foto' ? { px: '2160x3840', engineMs: 1700, ocrMs: 200, pockets: pk(fotoWrong, true) } : undefined } };
}

test('§6: mcnemar and the user agent', () => {
  assert.equal(mcnemar(0, 0), 1); assert.equal(mcnemar(9, 10), 0.021); assert.equal(mcnemar(5, 10), 1);
  assert.deepEqual(uaInfo(IOS), { os: 'ios', ios_version: 18.4, chrome: false });
  assert.equal(uaInfo(AND).os, 'android'); assert.equal(uaInfo(AND).chrome, true);
});

test('§6: the same verdicts as the bench, per mode; the site column is what was used; time and system from the record', () => {
  const cards = Array.from({ length: 9 }, (_, i) => (i === 8 ? null : `LOR13-${i + 1}`));
  const recs = [rec('a3-p01', cards, { fotoWrong: [0] }), rec('a3-p02', cards, { used: 'video', ready: 3100 })];
  const truth = { real: false, pages: [{ file: 'a3-p01-foto.jpg', device: 'A', cards }, { file: 'a3-p02-video.jpg', device: 'A', cards }] };
  const r = a3Compare(recs, truth);
  assert.equal(r.all.video.cards, 16); assert.equal(r.all.video.first_right_pct, 100); assert.equal(r.all.video.auto_right_pct, 0);
  assert.equal(r.all.foto.cards, 8); assert.equal(r.all.foto.auto_right_pct, 87.5); assert.equal(r.all.foto.alt_right_pct, 12.5);   // the wrong one has the right card second
  assert.equal(r.all.site.cards, 16);                                                            // photo where used, video where not
  assert.equal(r.capture.fallback, 1); assert.deepEqual(r.capture.fallback_reasons, { 'no-imagecapture': 1 });
  assert.equal(r.pair.pockets, 8); assert.equal(r.pair.video_only, 1); assert.equal(r.pair.foto_only, 0);
  assert.ok(r.verdicts.every((x) => typeof x.v === 'string'));
  assert.equal(r.coverage.complete, false);                                                       // 2 synthetic pages
  assert.ok(r.coverage.missing.some((m) => /iOS ≥ 18.4/.test(m)));
  assert.ok(Object.entries(r.criteria).filter(([k]) => !/interação/.test(k)).every(([, v]) => v === 'não avaliável'));
  assert.match(a3Markdown(r), /Conjunto:\*\* incompleto/);
});

test('§6: a complete real set of 30 pages (iPhone iOS 18.4 + Androids with Chrome): criteria judged as measured', () => {
  const t = fullSet();
  const recs = t.pages.map((p, k) => rec(p.file.replace(/\.jpg$/, ''), p.cards, { ua: p.os === 'ios' ? IOS : AND, videoWrong: p.cards[2] && k % 2 ? [2] : [] }));
  const truth = { real: true, pages: t.pages.map((p) => ({ ...p, file: p.file.replace(/\.jpg$/, '-foto.jpg') })) };
  const r = a3Compare(recs, truth);
  assert.equal(r.coverage.complete, true, r.coverage.missing.join('; '));
  assert.ok(r.pair.foto_only >= 10 && r.pair.video_only === 0);
  assert.equal(r.criteria['Foto > Vídeo em identificação, McNemar p < 0,05'], 'atingido');
  assert.equal(r.criteria['Falsos positivos da foto ≤ vídeo'], 'atingido');
  assert.equal(r.criteria['Site não pior que Vídeo em nenhum aparelho'], 'atingido');
  assert.equal(r.criteria['Nenhuma perda de interação'], 'verificar nos testes e no uso no aparelho');
});
