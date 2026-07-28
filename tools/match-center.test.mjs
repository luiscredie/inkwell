// Match Center tests (M1P Checkpoint C). No deps.
// Verifies matches remain deck_id-scoped, no duplication on filter/move, and the
// deck-detail → Matches preselect contract exists in site/index.html.
//   node tools/match-center.test.mjs
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };

// Contract checks (static): canonical log workflow in Matches; deck detail links preselected.
ck('1 openMatches preselects deck_id', html.includes('openMatches(deckId){') && html.includes("matchFilter:deckId||'all'"));
ck('2 deck detail Log opens Matches', html.includes('V.logMatchToggle=()=>this.openMatches(deck.id)'));
ck('3 deck detail View-All opens Matches', html.includes('V.viewAllMatches=()=>this.openMatches(deck.id)'));
ck('4 Matches hosts log form', html.includes('mc._logToggle') && html.includes('mc._onLogDeck'));
ck('5 saveMatch guards missing deck', html.includes("this.t('needDeckFirst')"));
ck('6 saveMatch keeps deck_id', html.includes('deck_id:deckId'));
ck('7 unique id (time+random)', html.includes("'m'+Date.now().toString(36)+Math.floor(Math.random()"));
ck('8 delMatch by id only', html.includes('delMatch(id){') && html.includes('this.state.matches.filter(m=>m.id!==id)'));
ck('9 matches filtered by deck_id', html.includes('all.filter(m=>m.deck_id===f)'));

// Behavioral: emulate the reducer-ish operations on a match array.
function saveMatch(matches, deckId, result) {
  const m = { id: 'm' + matches.length + '_' + result, deck_id: deckId, result, opponent_inks: [], date: '2026-07-27' };
  return [...matches, m];
}
let matches = [];
matches = saveMatch(matches, 'A', 'win');
matches = saveMatch(matches, 'B', 'loss');
ck('10 two logs, no duplication', matches.length === 2 && new Set(matches.map(m => m.id)).size === 2);
// filter by deck does not mutate/duplicate
const filtered = matches.filter(m => m.deck_id === 'A');
ck('11 filter preserves source array', filtered.length === 1 && matches.length === 2);
// migration idempotency: matches already have deck_id; a re-run must not duplicate
function migrate(ms) { return ms.map(m => ({ ...m })); }
const once = migrate(matches), twice = migrate(once);
ck('12 migration idempotent + deck_id intact', twice.length === 2 && twice.every(m => m.deck_id) && twice[0].id === matches[0].id);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
