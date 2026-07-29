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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
