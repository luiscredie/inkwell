// Visual Replay v2 unit tests (delta after da786668). No deps.
// Extracts simulateReplay/youPlayerOf from site/index.html via a stub instance.
//   node tools/visual-replay.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
const s = html.indexOf('class Component extends DCLogic');
const e = html.indexOf('</script>', s);
const Component = new Function('DCLogic', 'React', html.slice(s, e) + '\nreturn Component;')(class { setState() {} }, { createElement: (t, p, ...c) => ({ t, p, c }) });

const c = Object.create(Component.prototype);
c.cards = [
  { card_id: 'A', name_en: 'Aurora - Holding Court', card_type: 'Character', abilities: [] },
  { card_id: 'T', name_en: 'He Hurled His Thunderbolt', card_type: 'Action', abilities: [] },
  { card_id: 'L', name_en: 'Luisa Madrigal - Pushing Through', card_type: 'Character', abilities: [{ type: 'keyword', name: 'Challenger', parameter: '+2' }] },
];
c.byId = {}; for (const x of c.cards) c.byId[x.card_id] = x;
c._byName = {}; for (const x of c.cards) { const k = x.name_en.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim(); (c._byName[k] = c._byName[k] || []).push(x); }
for (const m of ['nameKey', 'cardByName', 'buildNameIndex', 'cardKeywordMods', 'simulateReplay', 'youPlayerOf', 'deckById']) c[m] = Component.prototype[m];
c.state = { decks: [] };

let pass = 0, fail = 0;
const ck = (n, cond) => { cond ? pass++ : fail++; console.log((cond ? '✓ ' : '✗ ') + n); };

const ev = [
  { text: "Player 2's starting hand: Luisa Madrigal - Pushing Through" },
  { text: "Player 1's turn begins" },
  { text: 'Player 1 added Some Card to ink' },
  { text: 'Player 1 played Aurora - Holding Court (cost 1)' },
  { text: 'Player 1 played He Hurled His Thunderbolt (cost 3)' },
];
const sim = c.simulateReplay(ev, 4);
ck('action card excluded from board', sim.S[1].board.every(x => x.name !== 'He Hurled His Thunderbolt'));
ck('character on board', sim.S[1].board.some(x => x.name === 'Aurora - Holding Court'));
ck('freshly played character is drying', sim.S[1].board.find(x => x.name === 'Aurora - Holding Court').drying === true);
ck('ink total tracked', sim.S[1].inkTotal === 1);
ck('opponent hand revealed for training', sim.S[2].hand.includes('Luisa Madrigal - Pushing Through'));

// drying clears at owner's next turn; exert on quest
const ev2 = ev.concat([
  { text: "Player 2's turn begins" },
  { text: "Player 1's turn begins" },
  { text: 'Player 1 quested with Aurora - Holding Court (1 -> 1)' },
]);
const sim2 = c.simulateReplay(ev2, ev2.length - 1);
const aur = sim2.S[1].board.find(x => x.name === 'Aurora - Holding Court');
ck('drying clears after a turn cycle', aur.drying === false);
ck('quest exerts the character', aur.exerted === true);

// keyword modifier active only on owner turn
const ev3 = [
  { text: "Player 1's turn begins" },
  { text: 'Player 1 added X to ink' },
  { text: 'Player 1 played Luisa Madrigal - Pushing Through (cost 1)' },
];
let sim3 = c.simulateReplay(ev3, 2); // still P1 turn
let lu = sim3.S[1].board.find(x => x.name === 'Luisa Madrigal - Pushing Through');
ck('keyword mod present', lu.mods.length === 1 && /Challenger/.test(lu.mods[0].label));
ck('mod active on owner turn', lu.mods[0].active === true);
const ev4 = ev3.concat([{ text: "Player 2's turn begins" }]);
sim3 = c.simulateReplay(ev4, ev4.length - 1);
lu = sim3.S[1].board.find(x => x.name === 'Luisa Madrigal - Pushing Through');
ck('mod grey off owner turn', lu.mods[0].active === false);

// perspective: youPlayerOf via deck card ownership
c.state = { decks: [] };
const you = c.youPlayerOf({ deck_id: 'd1', raw_log: 'Player 2 played Luisa Madrigal - Pushing Through (cost 1)\nPlayer 1 played Aurora - Holding Court (cost 1)' });
c.deckById = () => ({ id: 'd1', cards: { 'L': 4 } });
ck('youPlayerOf detects you=2 from deck cards', c.youPlayerOf({ deck_id: 'd1', raw_log: 'Player 2 played Luisa Madrigal - Pushing Through (cost 1)' }) === 2);

// regression: missing state / decks / deck_id must not throw, returns neutral default
const cSafe = Object.create(Component.prototype);
for (const m of ['nameKey', 'cardByName', 'buildNameIndex', 'youPlayerOf', 'deckById']) cSafe[m] = Component.prototype[m];
cSafe.cards = c.cards; cSafe.byId = c.byId; cSafe._byName = c._byName;
cSafe.state = undefined;
let threw = false, res;
try { res = cSafe.youPlayerOf({ deck_id: 'x', raw_log: 'Player 1 played Aurora - Holding Court (cost 1)' }); } catch (e) { threw = true; }
ck('youPlayerOf survives missing state (no throw, neutral)', !threw && res === 1);
cSafe.state = { decks: [] };
ck('youPlayerOf survives empty decks + unknown id', cSafe.youPlayerOf({ deck_id: 'nope', raw_log: 'Player 1 played X' }) === 1);
ck('youPlayerOf survives match without deck_id', cSafe.youPlayerOf({ raw_log: 'Player 1 played X' }) === 1);

// ---- v3: per-instance, zones, You/Opponent grammar, undo, banish-on-challenge ----
const c3 = Object.create(Component.prototype);
c3.cards = [
  { card_id: 'A', name_en: 'Aurora - Holding Court', card_type: 'Character', ink_cost: 1, strength: 1, willpower: 3, lore: 1, abilities: [] },
  { card_id: 'G', name_en: 'Guidebook', card_type: 'Item', ink_cost: 2, abilities: [] },
  { card_id: 'N', name_en: 'Lantern', card_type: 'Location', ink_cost: 3, willpower: 6, abilities: [] },
  { card_id: 'M', name_en: 'Mickey - Brave', card_type: 'Character', ink_cost: 4, strength: 3, willpower: 4, lore: 2, abilities: [{ type: 'keyword', name: 'Challenger', parameter: '+2' }] },
];
c3.byId = {}; for (const x of c3.cards) c3.byId[x.card_id] = x;
c3._byName = {}; for (const x of c3.cards) { const k = x.name_en.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim(); (c3._byName[k] = c3._byName[k] || []).push(x); }
for (const m of ['nameKey', 'cardByName', 'buildNameIndex', 'cardKeywordMods', 'simulateReplay', 'inkList']) c3[m] = Component.prototype[m];
c3.state = { decks: [] };
const z = c3.simulateReplay([
  { text: "You's turn begins" }, { text: 'You added Aurora - Holding Court to ink' },
  { text: 'You played Aurora - Holding Court (cost 1)' }, { text: 'You played Aurora - Holding Court (cost 1)' },
  { text: 'You played Guidebook (cost 2)' }, { text: 'You played Lantern (cost 3)' },
], 5);
ck('v3 two instances of same character', z.S[1].chars.filter(x => x.name === 'Aurora - Holding Court').length === 2);
ck('v3 distinct instance ids', z.S[1].chars[0].iid !== z.S[1].chars[1].iid);
ck('v3 item zone separate', z.S[1].items.length === 1 && z.S[1].items[0].name === 'Guidebook');
ck('v3 location zone separate', z.S[1].locations.length === 1);
ck('v3 exact_board_state false', z.exact === false);
ck('v3 You maps to player 1', z.active === 1);
const zc = c3.simulateReplay([
  { text: "You's turn begins" }, { text: 'You added Mickey - Brave to ink' }, { text: 'You played Mickey - Brave (cost 4)' },
  { text: "Opponent's turn begins" }, { text: 'Opponent added Aurora - Holding Court to ink' }, { text: 'Opponent played Aurora - Holding Court (cost 1)' },
  { text: "You's turn begins" },
  { text: 'You challenged Aurora - Holding Court with Mickey - Brave | 3 [STRENGTH] dealt 3 dmg to Aurora - Holding Court (3/3 [WILLPOWER] - banished!), took 1 dmg' },
], 7);
ck('v3 banish-on-challenge removes defender', zc.S[2].chars.length === 0);
ck('v3 attacker takes per-instance damage', zc.S[1].chars[0].damage === 1);
ck('v3 free-undo rolls back ink', c3.simulateReplay([{ text: "You's turn begins" }, { text: 'You added Aurora - Holding Court to ink' }, { text: 'You took back their action (free undo)' }], 2).S[1].inkTotal === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
