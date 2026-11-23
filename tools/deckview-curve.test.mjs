// The deck curve used by the deck overview and the builder panel (src/site/deckview.js, summary()):
// 7 columns ≤1, 2, 3, 4, 5, 6, 7+. A cost-0 card counts in "≤1" and a cost above 7 in "7+", so the columns always add
// up to the known cards. Run: node tools/deckview-curve.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../src/site/deckview.js', import.meta.url), 'utf8'), ctx);
const DV = ctx.window.INKWELL_DECKVIEW({ esc: String, Tx: String, split: (n) => [n, ''], inksOf: () => [], imgUrl: () => '', setNo: () => 0, nameKey: (n) => n, LOC: 'pt-BR' });
let ok = 0, bad = 0;
const t = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) ok++; else { bad++; console.log(`✗ ${name}: got ${g}, want ${w}`); } };
const card = (cost, extra = {}) => ({ c: { name: `c${cost}${extra.n || ''}`, cost, type: 'Character', inkable: true, ...extra }, q: extra.q || 1 });
const s = DV.summary([card(0, { q: 2 }), card(1), card(2, { q: 3 }), card(7), card(9, { q: 2 }), card(4, { inkable: false, q: 4 })]);
t('cost 0 and 1 in ≤1', s.curve[0], 3);
t('cost 7 and 9 in 7+', s.curve[6], 3);
t('columns add up to the known cards', s.curve.reduce((a, b) => a + b, 0), s.total);
t('total', s.total, 13);
t('non-inkable', s.nonInk, 4);
t('seven columns', s.curve.length, 7);
t('average uses the real cost (0 is 0)', Math.round(s.avg * 1000) / 1000, Math.round(((0 * 2 + 1 + 2 * 3 + 7 + 9 * 2 + 4 * 4) / 13) * 1000) / 1000);
t('empty deck', DV.summary([]).curve, [0, 0, 0, 0, 0, 0, 0]);
console.log(`${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
