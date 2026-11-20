// duels-sync: deck lists with promo ids (#292). Synthetic catalog and rows only. No SQL, no network.
//   node tools/duels-deck.test.mjs
import { convert, Catalog } from '../supabase/functions/duels-sync/convert.ts';

let pass = 0, fail = 0;
const ck = (n, c, extra = '') => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n + (c || !extra ? '' : `  → ${extra}`)); };
const cat = new Catalog([
  { card_id: 'LOR3-90', name_en: 'Ursula - Deceiver', rarity: 'U' },
  { card_id: 'D23C-3', name_en: 'Ursula - Deceiver', rarity: 'P' },
  { card_id: 'D23-3', name_en: 'Elsa - Snow Queen', rarity: 'P' },
  { card_id: 'LOR1-42', name_en: 'Elsa - Snow Queen', rarity: 'R' },
  { card_id: 'LOR13-97', name_en: 'Mushu - Stealthy Dragon', rarity: 'L' },
  { card_id: 'D23C-12', name_en: 'Mushu - Stealthy Dragon', rarity: 'P' },
  { card_id: 'D23-12', name_en: 'Mickey Mouse - Other Card', rarity: 'P' },
  { card_id: 'D23C-7', name_en: 'Some Card - Set Five', rarity: 'P' },
  { card_id: 'LOR5-20', name_en: 'Some Card - Set Five', rarity: 'C' },
  { card_id: 'LOR11-89', name_en: 'White Rabbit - Late Again', rarity: 'U' },
  { card_id: 'DLPC1-29-P3', name_en: 'White Rabbit - Late Again', rarity: 'P' },
]);

ck('3-D23-3 without a name → D23C-3 (Ursula - Deceiver)', cat.resolveDeck('3-D23-3', null) === 'D23C-3');
ck('13-D23-12 without a name → D23C-12 (Mushu - Stealthy Dragon)', cat.resolveDeck('13-D23-12', null) === 'D23C-12');
ck('never D23-{n}, another card (D23-3 is Elsa, D23-12 another one)', cat.resolveDeck('3-D23-3', null) !== 'D23-3' && cat.resolveDeck('13-D23-12', null) !== 'D23-12');
ck('the D23C card belongs to another set (D23C-7 is set 5, the id says set 3): unresolved, not a guess', cat.resolveDeck('3-D23-7', null) === null);
ck('a D23C id the catalog lacks: unresolved', cat.resolveDeck('3-D23-99', null) === null);
ck('with the name, the name still wins (Ursula by name)', cat.resolveDeck('3-D23-3', 'Ursula - Deceiver') !== null && ['LOR3-90', 'D23C-3'].includes(cat.resolveDeck('3-D23-3', 'Ursula - Deceiver')));
ck('other promos unchanged: 11-P3-29 → DLPC1-29-P3', cat.resolveDeck('11-P3-29', null) === 'DLPC1-29-P3');
ck('regular ids unchanged: 3-90 → LOR3-90', cat.resolveDeck('3-90', null) === 'LOR3-90');

// the shape of the three synced games of #292: 60 cards, D23 promos without names
const row = { game_id: 'g', your_player: 1, started_at: '2026-11-20T00:00:00Z', your_decklist: [
  { id: '3-D23-3', count: 4 }, { id: '13-D23-12', count: 4 }, { id: '11-89', count: 4 }, { id: '3-90', count: 0 },
] };
const deck = convert(row, [], cat, 'Me').players[0].deck;
ck('a list with D23 promos: nothing left in deck.unresolved', !('unresolved' in deck), JSON.stringify(deck));
ck('…and every copy counted (12 of 12)', deck.list.reduce((s, x) => s + x.qty, 0) === 12, JSON.stringify(deck.list));
const bad = convert({ ...row, your_decklist: [{ id: '3-D23-7', count: 4 }] }, [], cat, 'Me').players[0].deck;
ck('an id that cannot be matched safely still goes to deck.unresolved with its count', bad.unresolved?.[0]?.duels_id === '3-D23-7' && bad.unresolved[0].qty === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
