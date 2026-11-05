// duels-sync: the best-of-3 match id from match history (match_id, match_format "bo3") — on new games (convert)
// and on games already stored (linkMatchFromRow, used by the refresh). No SQL, no network.
//   node --experimental-strip-types tools/duels-match.test.mjs   (Node 23.6+: plain node)
import { convert, linkMatchFromRow, matchIdOf, Catalog } from '../supabase/functions/duels-sync/convert.ts';

let pass = 0, fail = 0;
const ck = (n, c) => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n); };
const cat = new Catalog([]);
const row = (n, over = {}) => ({ game_id: `g${n}`, match_id: 'M-1', match_format: 'bo3', match_game_number: n, result: n === 1 ? 'loss' : 'win', queue_name: 'Core Set 14 BO3',
  started_at: '2026-11-04T20:00:00Z', your_player: 1, opp_display_name: 'Zé', your_decklist: [], ...over });

// new games
const log = convert(row(2), [], cat, 'Luís');
ck('a new Bo3 game carries its match id', log.event.match_id === 'M-1' && log.event.match_format === 'bo3' && log.event.game_in_match === 2);
ck('a Bo1 game has no match id (even if the row had one)', !('match_id' in convert(row(1, { match_format: 'bo1', match_game_number: null }), [], cat, 'Luís').event));
ck('no match id in the row: none in the log', !('match_id' in convert(row(1, { match_id: null }), [], cat, 'Luís').event));
ck('the id is cleaned like the match.json import (same id from both)', matchIdOf({ match_format: 'BO3', match_id: 'ab-12_x<>"' }) === 'ab-12_x');

// games already stored (refresh)
const old = convert(row(1), [], cat, 'Luís'); delete old.event.match_id; delete old.event.match_format;
const before = JSON.stringify({ ...old, event: undefined });
ck('an old game gets the match id from its own row', linkMatchFromRow(old, row(1)) === true && old.event.match_id === 'M-1');
ck('only the event changes: players, turns, result, deck stay', JSON.stringify({ ...old, event: undefined }) === before);
ck('again: nothing to write (idempotent)', linkMatchFromRow(old, row(1)) === false);
const other = convert(row(3), [], cat, 'Luís'); other.event.match_id = 'FROM-MATCH-JSON';
ck('a game already in a match is never moved', linkMatchFromRow(other, row(3)) === false && other.event.match_id === 'FROM-MATCH-JSON');
const wrong = convert(row(2), [], cat, 'Luís'); delete wrong.event.match_id;
ck('a row of another game does not link', linkMatchFromRow(wrong, row(3)) === false && !wrong.event.match_id);
ck('a Bo1 row does not link', linkMatchFromRow(wrong, { ...row(2), match_format: 'bo1' }) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
