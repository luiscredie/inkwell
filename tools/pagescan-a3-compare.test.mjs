// tools/pagescan-a3-compare.mjs: the video × photo comparison scores with the procedure's own definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compare, rows, paired, mcnemar, markdown, pageName } from './pagescan-a3-compare.mjs';
import { verdict, summarise } from './pagescan-report.mjs';

// a record as the site writes it (?medicao=a3, format a3: 2)
const P = (status, id, top = []) => ({ status, id, group: [], top, score: 0.8, ocr: false });
const mode = (from, pockets, extra = {}) => ({ from, exp: { detrend: true }, px: from === 'video' ? '1080x1920' : '3024x4032', kept: from === 'video' ? '1080x1920' : '2250x3000',
  quad: [[0, 0], [1, 0], [1, 1], [0, 1]], engineMs: 900, ocrMs: 300, ocrN: 2, numbers: true, worker: true, pockets, ...extra });
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const rec = (name, video, foto, extra = {}) => ({ a3: 2, name, at: '2026-11-26T18:00:00Z', ua: 'iPhone', layout: '3x3', used: 'video', fallback: 'foto desligada (padrão)', align: 0.93, aligned: true,
  times: { frameMs: 20, stillMs: 700, alignMs: 300 }, seen: { ready: 1800, ocr: 2500 }, modes: { video: mode('video', video), foto: foto && mode('foto', foto) }, pictures: { video: JPEG, ...(foto ? { foto: JPEG } : {}) }, ...extra });
const CARDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', null];
const truth = { real: false, pages: [{ file: 'a3-p01-x-foto.jpg', device: 'iPhone 13', os: 'ios', light: 'reflexo', cards: CARDS }, { file: 'a3-p02-x-foto.jpg', device: 'Moto G', os: 'android', light: 'boa', cards: CARDS }] };
// video: 4 automatic right, 2 right suggestions, 1 wrong suggestion, 1 not offered, empty right
const V = [P('ok', 'A'), P('ok', 'B'), P('ok', 'C'), P('ok', 'D'), P('check', 'E'), P('check', 'F'), P('check', 'X', ['X', 'G']), P('unknown', null), P('empty', null)];
// photo: 7 automatic right, 1 false positive (H read as Z), empty right
const F = [P('ok', 'A'), P('ok', 'B'), P('ok', 'C'), P('ok', 'D'), P('ok', 'E'), P('ok', 'F'), P('ok', 'G'), P('ok', 'Z'), P('empty', null)];

test('rows: one per pocket and reading, with the procedure\'s verdicts; "site" is what the page used', () => {
  const r = rows([rec('a3-p01-x', V, F)], truth);
  assert.equal(r.filter((x) => x.mode === 'video').length, 9);
  assert.equal(r.filter((x) => x.mode === 'foto').length, 9);
  assert.deepEqual(r.filter((x) => x.mode === 'site').map((x) => x.v), r.filter((x) => x.mode === 'video').map((x) => x.v));
  for (const x of r) assert.equal(x.v, verdict(x));                                   // the same definitions as the rest of A3
  assert.equal(r.find((x) => x.mode === 'video' && x.i === 6).v, 'alt-right');          // G among the suggestions
  assert.equal(r.find((x) => x.mode === 'foto' && x.i === 7).v, 'false-positive');
  // time on the phone: capture + engine + numbers
  assert.equal(r.find((x) => x.mode === 'video').device_s, 1.2);                        // 20 + 900 + 300 ms
  assert.equal(r.find((x) => x.mode === 'foto').device_s, 2.2);                         // 20 + 700 + 300 + 900 + 300 ms
});

test('compare: per reading and per device, with summarise from pagescan-report', () => {
  const r = compare([rec('a3-p01-x', V, F), rec('a3-p02-x', V, F, { ua: 'Android' })], truth);
  assert.deepEqual(Object.keys(r.modes), ['video', 'foto', 'site']);
  assert.deepEqual(r.modes.video, summarise(rows([rec('a3-p01-x', V, F), rec('a3-p02-x', V, F)], truth).filter((x) => x.mode === 'video')));
  assert.equal(r.modes.video.auto_right_pct, 50); assert.equal(r.modes.video.false_positive, 0);
  assert.equal(r.modes.foto.auto_right_pct, 87.5); assert.equal(r.modes.foto.false_positive, 2);
  assert.deepEqual(Object.keys(r.by_device), ['iPhone 13', 'Moto G']);
  assert.equal(r.capture.used_video, 2); assert.deepEqual(r.capture.fallback_reasons, { 'foto desligada (padrão)': 2 });
  assert.equal(r.capture.align_median, 0.93); assert.equal(r.capture.devices, 2);
});

test('paired: discordant pockets, McNemar, false positives and wrong suggestions only one side makes', () => {
  const r = compare([rec('a3-p01-x', V, F), rec('a3-p02-x', V, F)], truth), p = r.paired.find((x) => x.a === 'foto');
  assert.equal(p.cards, 16);
  assert.equal(p.a_only_identified, 2);       // G on both pages: the photo got it alone, the video only had it among the suggestions
  assert.equal(p.b_only_identified, 0);
  assert.equal(p.false_positive_a_only, 2);   // H read as Z by the photo, on both pages
  assert.equal(p.wrong_suggestion_b_only, 2);
  assert.equal(p.meets_gain_rule, false);     // more identified, but more false positives (and too few to be significant)
  assert.equal(p.gain, null); assert.equal(p.judgement, 'não avaliável');   // and 2 synthetic pages are no set to judge
});

test('mcnemar: exact two-sided values', () => {
  assert.equal(mcnemar(0, 0), 1);
  assert.equal(mcnemar(8, 0), 0.008);
  assert.equal(mcnemar(6, 1), 0.125);
  assert.equal(mcnemar(10, 2), 0.039);
});

test('gain: only with more identified, p < 0.05 and no more false positives', () => {
  const Vw = [P('check', 'X'), P('check', 'X'), P('check', 'X'), P('check', 'X'), P('check', 'X'), P('check', 'X'), P('check', 'X'), P('check', 'X'), P('empty', null)];
  const Fr = CARDS.map((c) => (c ? P('ok', c) : P('empty', null)));
  const r = compare([rec('a3-p01-x', Vw, Fr), rec('a3-p02-x', Vw, Fr)], truth), p = r.paired.find((x) => x.a === 'foto');
  assert.equal(p.a_only_identified, 16); assert.equal(p.p, 0); assert.equal(p.meets_gain_rule, true);
  // the numbers meet the rule, but 2 synthetic pages are not the set of sections 1 and 6.1: no gain is declared
  assert.equal(r.evaluable, false); assert.equal(p.gain, null); assert.equal(p.judgement, 'não avaliável');
  assert.doesNotMatch(markdown(r), /Evidência de ganho/); assert.match(markdown(r), /\*\*Não avaliável:\*\*/);
});

test('fallback, missing gabarito, the glare runs, and a site without the numbers step', () => {
  const noPhoto = rec('a3-p01-x', V, null, { used: 'video', fallback: 'sem ImageCapture', align: null, aligned: false });
  const glare = rec('a3-p02-x', V, F); glare.modes['video+reflexo'] = mode('video', V); glare.modes['foto+reflexo'] = mode('foto', F);
  const old = rec('a3-p03-x', V, F); for (const m of Object.values(old.modes)) m.numbers = false;
  const r = compare([noPhoto, glare, old], truth);
  assert.deepEqual(r.missing_truth, ['a3-p03-x']);
  assert.equal(r.capture.photo_taken, 1); assert.deepEqual(r.capture.fallback_reasons, { 'sem ImageCapture': 1, 'foto desligada (padrão)': 1 });
  assert.deepEqual(Object.keys(r.modes), ['video', 'foto', 'video+reflexo', 'foto+reflexo', 'site']);
  assert.deepEqual(r.paired.map((x) => x.label), ['Foto × vídeo', 'Filtro de reflexo × sem (vídeo)', 'Filtro de reflexo × sem (foto)']);
  assert.equal(compare([old], { pages: [{ file: 'a3-p03-x-video.jpg', cards: CARDS }] }).capture.numbers_step, false);
  assert.match(markdown(compare([old], { pages: [{ file: 'a3-p03-x-video.jpg', cards: CARDS }] })), /não estava disponível/);
  assert.equal(pageName('a3-p07-202611261830-video.jpg'), 'a3-p07-202611261830');
});

test('markdown: synthetic sets are said to be synthetic; no gain claimed without evidence', () => {
  const md = markdown(compare([rec('a3-p01-x', V, F)], truth));
  assert.match(md, /sintéticas \(não valem como resultado do produto\)/);
  assert.match(md, /Não avaliável/);
  assert.doesNotMatch(md, /Evidência de ganho\b(?! )/);
});

test('CLI: extract the pictures, report from truth.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a3c-'));
  for (const r of [rec('a3-p01-x', V, F), rec('a3-p02-x', V, F)]) fs.writeFileSync(path.join(dir, `${r.name}.json`), JSON.stringify(r));
  execFileSync('node', ['tools/pagescan-a3-compare.mjs', 'extract', dir]);
  assert.ok(fs.existsSync(path.join(dir, 'a3-p01-x-foto.jpg')) && fs.existsSync(path.join(dir, 'a3-p02-x-video.jpg')));
  fs.writeFileSync(path.join(dir, 'truth.json'), JSON.stringify(truth));
  const md = execFileSync('node', ['tools/pagescan-a3-compare.mjs', 'report', dir, path.join(dir, 'a3-relatorio.json'), path.join(dir, 'a3-relatorio.md')]).toString();
  assert.match(md, /2 páginas/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'a3-relatorio.json'), 'utf8')).modes.foto.false_positive, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});


// the set of sections 1 and 6.1, as tools/pagescan-report.test.mjs builds it: 3 devices × 10 pages, with the site's records
const IOS184 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
const IOS17 = IOS184.replace('18_4', '17_5').replace('18.4', '17.5');
const ANDROID = (m) => `Mozilla/5.0 (Linux; Android 14; ${m}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36`;
function fullSet(iosUA = IOS184) {
  const pages = [], recs = [], C = (i) => `LOR13-${i + 1}`;
  for (const [d, os, older, ua] of [['iPhone 13', 'ios', false, iosUA], ['Galaxy A54', 'android', false, ANDROID('SM-A546B')], ['Moto G7 (2019)', 'android', true, ANDROID('moto g(7)')]]) {
    for (let k = 0; k < 10; k++) {
      const light = k < 6 ? 'boa' : k < 8 ? 'reflexo' : 'fraca', tilt = k === 4 || k === 5;
      const cards = Array.from({ length: 9 }, (_, i) => C(i));
      if (k === 0 && d !== 'Moto G7 (2019)') cards[8] = null; if (k === 1) cards[7] = null; if (k === 2 && d === 'iPhone 13') cards[6] = null;
      if (k === 3) cards[1] = cards[0];
      const foil = cards.map((c, i) => !!c && k < 2 && i < 3), name = `a3-p${d.replace(/\W/g, '')}${k}`;
      pages.push({ file: `${name}-foto.jpg`, device: d, device_older: older, binder: k % 2 ? 'preto' : 'transparente', light, tilt, reprint: k === 9, foil, cards });
      // video: every card only among the suggestions; photo: every card automatic and right
      const vid = cards.map((c) => (c ? P('check', 'X', ['X', c]) : P('empty', null))), fot = cards.map((c) => (c ? P('ok', c) : P('empty', null)));
      recs.push(rec(name, vid, fot, { ua, used: 'foto' }));
    }
  }
  return { truth: { real: true, pages }, recs };
}

test('a complete, real set (sections 1 and 6.1): the gain is judged; OS and time on the phone come from the records', () => {
  const { truth: t, recs } = fullSet(), r = compare(recs, t), p = r.paired.find((x) => x.a === 'foto');
  assert.equal(r.evaluable, true, r.coverage.missing.join('; '));
  assert.equal(p.meets_gain_rule, true); assert.equal(p.gain, true); assert.equal(p.judgement, 'ganho');
  const md = markdown(r); assert.match(md, /Conjunto completo/); assert.match(md, /\*\*Evidência de ganho\.\*\*/);
});
test('not evaluable: synthetic photos, a missing item of section 1, no iPhone on iOS 18.4, a record without gabarito', () => {
  const judge = (t, recs) => { const r = compare(recs, t); return [r.evaluable, r.paired.find((x) => x.a === 'foto').judgement, r.coverage.missing.join('; ')]; };
  let s = fullSet(); s.truth.real = false; assert.deepEqual(judge(s.truth, s.recs).slice(0, 2), [false, 'não avaliável']);
  s = fullSet(); s.truth.pages = s.truth.pages.slice(1); s.recs = s.recs.slice(1);
  let [ev, j, why] = judge(s.truth, s.recs); assert.equal(ev, false); assert.equal(j, 'não avaliável'); assert.match(why, /29 de 30 páginas/);
  s = fullSet(IOS17); [ev, j, why] = judge(s.truth, s.recs); assert.equal(ev, false); assert.match(why, /iOS ≥ 18\.4/);
  s = fullSet(); s.recs.push(rec('a3-pextra', V, F)); [ev, j, why] = judge(s.truth, s.recs); assert.equal(ev, false); assert.match(why, /sem gabarito/);
  s = fullSet(); s.recs.forEach((x) => { x.ua = 'Mozilla/5.0 (Windows NT 10.0)'; }); [ev, , why] = judge(s.truth, s.recs); assert.equal(ev, false); assert.match(why, /sistema/);
});
