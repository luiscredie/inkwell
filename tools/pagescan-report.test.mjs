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
  const truth = { real: false, pages: [{ file: 'a.jpg', device: 'A', cond: 'boa' }] };
  const rows = [R('A', 'ok', 'A')]; for (const x of rows) x.v = verdict(x);
  const cov = coverage(truth, rows);
  assert.equal(cov.complete, false);
  assert.ok(cov.missing.some((m) => /sintéticas/.test(m)));
  assert.ok(cov.missing.some((m) => /1 de 30 páginas/.test(m)));
  assert.ok(cov.missing.some((m) => /1 de 3 aparelhos/.test(m)));
  const t = targets(summarise(rows), { A: summarise(rows) }, cov);
  assert.ok(Object.values(t).every((v) => v === 'não avaliável'));
});

test('a complete real set: targets judged as measured (met and not met)', () => {
  const pages = [], rows = [];
  for (const d of ['iPhone 13', 'Moto G', 'Galaxy A']) for (let k = 0; k < 10; k++) {
    const file = `${d}-${k}.jpg`; pages.push({ file, device: d, cond: k < 2 ? 'boa+foil' : 'boa', device_s: d === 'Moto G' ? 5.2 : 2.1 });
    for (let i = 0; i < 9; i++) rows.push(R(i === 8 && k < 2 ? null : `C${i}`, i === 8 && k < 2 ? 'empty' : 'ok', i === 8 && k < 2 ? null : `C${i}`, { file, device: d, cond: pages.at(-1).cond, device_s: pages.at(-1).device_s }));
  }
  const r = report({ real: true, pages }, rows);
  assert.equal(r.coverage.complete, true, r.coverage.missing.join('; '));
  assert.equal(r.targets['Identificação ≥ 95% no total'], 'atingida');
  assert.equal(r.targets['Falso positivo = 0'], 'atingida');
  assert.equal(r.targets['Tempo ≤ 4 s no aparelho mais lento'], 'não atingida');   // the Moto G
  const md = markdown(r);
  assert.match(md, /Fotos:\*\* reais · \*\*Conjunto:\*\* completo/);
  assert.match(md, /\| Moto G \| 10 \|/);
});
