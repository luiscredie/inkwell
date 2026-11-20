// duels-sync, converter 2: the opening hand and mulligan of the log's owner, the same card in any printing, undone
// actions. Synthetic logs only (no player's real log in the repo). No SQL, no network.
//   node tools/duels-opening.test.mjs
import { convert, openingOf, addOpening, Catalog, CONVERTER } from '../supabase/functions/duels-sync/convert.ts';

let pass = 0, fail = 0;
const ck = (n, c, extra = '') => { c ? pass++ : fail++; console.log((c ? '✓ ' : '✗ ') + n + (c || !extra ? '' : `  → ${extra}`)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const cat = new Catalog([
  { card_id: 'LOR11-87', name_en: 'Tod - All Alone', rarity: 'C', ink_cost: 1, inkable: 1 },
  { card_id: 'LOR11-89', name_en: 'White Rabbit - Late Again', rarity: 'U', ink_cost: 2, inkable: 1 },
  { card_id: 'DLPC1-29-P3', name_en: 'White Rabbit - Late Again', rarity: 'P', ink_cost: 2, inkable: 1 },
  { card_id: 'LOR4-84', name_en: 'Pegasus - Gift for Hercules', rarity: 'C', ink_cost: 1, inkable: 1 },
  { card_id: 'LOR9-84', name_en: 'Pegasus - Gift for Hercules', rarity: 'C', ink_cost: 1, inkable: 1 },
  { card_id: 'DLPC1-1-C2', name_en: 'Pegasus - Gift for Hercules', rarity: 'P', ink_cost: 1, inkable: 1 },
  { card_id: 'LOR3-90', name_en: 'Ursula - Deceiver', rarity: 'U', ink_cost: 2, inkable: 1 },
  { card_id: 'D23C-3', name_en: 'Ursula - Deceiver', rarity: 'P', ink_cost: 2, inkable: 1 },
  { card_id: 'LOR11-86', name_en: 'Vixey - Forest Friend', rarity: 'U', ink_cost: 3, inkable: 1 },
  { card_id: 'LOR13-97', name_en: 'Mushu - Stealthy Dragon', rarity: 'L', ink_cost: 3, inkable: 1 },
  { card_id: 'LOR11-191', name_en: 'Angel - Experiment 624', rarity: 'SR', ink_cost: 4, inkable: 1 },
  { card_id: 'LOR12-86', name_en: 'Elinor - Renowned Diplomat', rarity: 'R', ink_cost: 4, inkable: 0 },
]);
const C = (id, name) => ({ id, name });
const TOD = C('11-87', 'Tod - All Alone'), WR = C('11-89', 'White Rabbit - Late Again'), PEG = C('4-84', 'Pegasus - Gift for Hercules');
const URS = C('3-90', 'Ursula - Deceiver'), VIX = C('11-86', 'Vixey - Forest Friend'), MUSHU = C('13-97', 'Mushu - Stealthy Dragon');
const ANGEL = C('11-191', 'Angel - Experiment 624'), ELI = C('12-86', 'Elinor - Renowned Diplomat');
const HAND = [VIX, MUSHU, TOD, ANGEL, WR, URS, URS];
const hand = (p, cards) => ({ type: 'INITIAL_HAND', player: p, data: cards ? { initialHandCards: cards } : {} });
const mull = (p, data) => ({ type: 'MULLIGAN', player: p, data });
const start = (p) => ({ type: 'TURN_START', player: p });
const row = (over = {}) => ({ game_id: 'g1', your_player: 2, started_at: '2026-11-20T00:00:00Z', queue_name: 'Core Set 14 BO3', your_decklist: [], ...over });
// the owner is player 2; the opponent's hand and returned cards come empty, as in duels.ink logs
const game = (mine) => [hand(1), hand(2, HAND), mull(1, { mulliganCount: 4 }), ...mine, { type: 'GAME_START' }, start(1)];

// ---- a mulligan with cards
const o = openingOf(game([mull(2, { mulliganCount: 1, mulliganedCards: [URS], drawnCards: [PEG] })]), 2, cat);
ck('recorded: the 7 cards, in the order of the log', o.status === 'recorded' && eq(o.hand.map((c) => c.card_id), ['LOR11-86', 'LOR13-97', 'LOR11-87', 'LOR11-191', 'LOR11-89', 'LOR3-90', 'LOR3-90']));
ck('returned and drawn are kept', eq(o.mulligan.returned.map((c) => c.card_id), ['LOR3-90']) && eq(o.mulligan.drawn.map((c) => c.card_id), ['LOR4-84']) && o.mulligan.count === 1);
ck('two copies are two cards: one Ursula returned, the other kept', o.kept.length === 6 && o.kept.filter((c) => c.card_id === 'LOR3-90').length === 1);
ck('the duels.ink id stays beside the catalog id (reprocess with a newer catalog)', o.hand[0].duels_id === '11-86');

// ---- absent is not zero
const zero = openingOf(game([mull(2, { mulliganCount: 0 })]), 2, cat);
ck('mulligan with 0 returned = kept all 7 (count 0, empty lists)', zero.status === 'recorded' && eq(zero.mulligan, { count: 0, returned: [], drawn: [] }) && zero.kept.length === 7);
const noEvent = openingOf(game([]), 2, cat);
ck('hand but no MULLIGAN event: mulligan unknown (null), never "kept all 7"', noEvent.status === 'recorded' && noEvent.mulligan === null && noEvent.hand.length === 7);
const conceded = openingOf([{ type: 'GAME_CONCEDED', player: 2, data: { winner: 1, concededBy: 2, victoryReason: 'concession' } }], 2, cat);
ck('concession before the game started: absent, with the reason', eq(conceded, { status: 'absent', reason: 'conceded_before_start' }));
ck('a log with no events at all: absent, not in log', eq(openingOf([], 2, cat), { status: 'absent', reason: 'not_in_log' }));
const log0 = convert(row({ result: 'loss' }), [{ type: 'GAME_CONCEDED', player: 2, data: { winner: 1, concededBy: 2, victoryReason: 'concession' } }, { type: 'GAME_END', data: { winner: 1, victoryReason: 'concession' } }], cat, 'Me');
ck('the converted log of that concession: no turns, opening absent, mulligan count stays null', log0.turns.length === 0 && log0.players[0].opening.status === 'absent' && log0.players[0].mulligan_count === null);

// ---- the opponent's hidden cards are never filled in
const oppSide = openingOf(game([mull(2, { mulliganCount: 0 })]), 1, cat);
ck("the opponent's side (empty hand in the log) is absent: no cards guessed", oppSide.status === 'absent');
const full = convert(row(), game([mull(2, { mulliganCount: 1, mulliganedCards: [URS], drawnCards: [PEG] })]), cat, 'Me');
ck('only the owner gets an opening; the opponent keeps just the public count', 'opening' in full.players[0] && !('opening' in full.players[1]) && full.players[1].mulligan_count === 4 && full.players[0].mulligan_count === 1);
ck('the log says which converter wrote it', full.source_ref.converter === CONVERTER && CONVERTER === 2);

// ---- inconsistent events: invalid, nothing kept
const bad = (m, h = HAND) => openingOf([hand(2, h), mull(2, m)], 2, cat);
ck('a returned card not in the hand: invalid', bad({ mulliganCount: 1, mulliganedCards: [ELI], drawnCards: [PEG] }).status === 'invalid');
ck('returned and drawn differ in number: invalid', bad({ mulliganCount: 2, mulliganedCards: [URS, TOD], drawnCards: [PEG] }).status === 'invalid');
ck('count disagrees with the cards: invalid', bad({ mulliganCount: 3, mulliganedCards: [URS], drawnCards: [PEG] }).status === 'invalid');
ck('hand of 6: invalid', bad({ mulliganCount: 0 }, HAND.slice(0, 6)).status === 'invalid');
ck('the same Ursula returned three times from a hand of two: invalid', bad({ mulliganCount: 3, mulliganedCards: [URS, URS, URS], drawnCards: [PEG, PEG, PEG] }).status === 'invalid');
const inv = bad({ mulliganCount: 1, mulliganedCards: [ELI], drawnCards: [PEG] });
ck('invalid keeps no cards, only the issues', !('hand' in inv) && !('kept' in inv) && inv.issues.length > 0, JSON.stringify(inv));
ck('two MULLIGAN events of the owner: invalid', openingOf([hand(2, HAND), mull(2, { mulliganCount: 0 }), mull(2, { mulliganCount: 0 })], 2, cat).status === 'invalid');

// ---- the same card in another printing
const alt = openingOf([hand(2, [C('9-C2-1', 'Pegasus - Gift for Hercules'), C('11-P3-29', 'White Rabbit - Late Again'), C('3-D23-3', 'Ursula - Deceiver'), TOD, VIX, MUSHU, ANGEL]), mull(2, { mulliganCount: 0 })], 2, cat);
ck('promo ids from the log (9-C2-1, 11-P3-29, 3-D23-3) resolve to the card by its name', eq(alt.hand.slice(0, 3).map((c) => c.card_id), ['LOR4-84', 'LOR11-89', 'LOR3-90']), JSON.stringify(alt.hand));
ck('their duels.ink ids are kept', eq(alt.hand.slice(0, 3).map((c) => c.duels_id), ['9-C2-1', '11-P3-29', '3-D23-3']));
ck('baseOf: a deck list printing (DLPC1-29-P3) and the hand (LOR11-89) are the same card', cat.baseOf('DLPC1-29-P3') === 'LOR11-89' && cat.baseOf('LOR11-89') === 'LOR11-89');
ck('baseOf: reprints in later sets too (LOR9-84 → LOR4-84, D23C-3 → LOR3-90)', cat.baseOf('LOR9-84') === 'LOR4-84' && cat.baseOf('D23C-3') === 'LOR3-90' && cat.baseOf('DLPC1-1-C2') === 'LOR4-84');
ck('baseOf: an id the catalog lacks comes back unchanged, null stays null', cat.baseOf('LOR99-1') === 'LOR99-1' && cat.baseOf(null) === null);
const unk = openingOf([hand(2, [C('77-1', 'A Card Not Yet In The Catalog'), TOD, VIX, MUSHU, ANGEL, WR, URS]), mull(2, { mulliganCount: 0 })], 2, cat);
ck('a card the catalog lacks: no id invented, its name kept', unk.status === 'recorded' && unk.hand[0].card_id === null && unk.hand[0].card_name === 'A Card Not Yet In The Catalog');

// ---- undone actions and two copies played (turns; the opening is not touched by undo)
const P = (p, c, x = {}) => ({ type: 'CARD_PLAYED', player: p, data: { cardId: c.id, cardName: c.name, cardCost: 1, ...x } });
const INK = (p, c) => ({ type: 'CARD_INKED', player: p, data: { cardId: c.id, cardName: c.name } });
const UNDO = (p) => ({ type: 'FREE_UNDO', player: p, data: {} });
const turnsOf = (evs) => convert(row(), [hand(2, HAND), mull(2, { mulliganCount: 0 }), start(2), ...evs], cat, 'Me').turns[0].actions.map((a) => `${a.type}:${a.card_id}`);
ck('an undone ink is gone; the ink made instead stays', eq(turnsOf([INK(2, TOD), UNDO(2), INK(2, WR)]), ['ink:LOR11-89']));
ck('an undone play is gone with what followed it (its challenge)', eq(turnsOf([INK(2, WR), P(2, TOD), { type: 'CARD_ATTACK', player: 2, data: { cardId: TOD.id, cardName: TOD.name, targetCardId: VIX.id, targetCardName: VIX.name } }, UNDO(2)]), ['ink:LOR11-89', 'play:LOR11-87']));
ck('two undos in a row undo two actions', eq(turnsOf([INK(2, WR), P(2, TOD), UNDO(2), UNDO(2)]), []));
ck('an undo with nothing left to undo does nothing (no earlier turn touched)', (() => {
  const t = convert(row(), [hand(2, HAND), mull(2, { mulliganCount: 0 }), start(2), INK(2, WR), start(1), UNDO(1), UNDO(1)], cat, 'Me').turns;
  return eq(t[0].actions.map((a) => a.type), ['ink']) && t[1].actions.length === 0;
})());
ck("an opponent's undo never removes my action", eq(turnsOf([INK(2, WR), UNDO(1)]), ['ink:LOR11-89']));
ck('two copies played in one turn stay two plays (not merged as a duplicate)', eq(turnsOf([INK(2, WR), P(2, TOD), P(2, TOD)]), ['ink:LOR11-89', 'play:LOR11-87', 'play:LOR11-87']));
ck('undo during the turns leaves the opening as it was', (() => {
  const l = convert(row(), [hand(2, HAND), mull(2, { mulliganCount: 1, mulliganedCards: [URS], drawnCards: [PEG] }), start(2), INK(2, URS), UNDO(2)], cat, 'Me');
  return l.players[0].opening.status === 'recorded' && l.players[0].opening.mulligan.count === 1;
})());
ck('an action is never added for an undo: no "undo" action in the log', !turnsOf([INK(2, WR), UNDO(2)]).length);

// ---- reprocessing a log stored by converter 1
const evs = game([mull(2, { mulliganCount: 1, mulliganedCards: [URS], drawnCards: [PEG] })]);
const old = convert(row(), evs, cat, 'Me');
delete old.players[0].opening; delete old.source_ref.converter;                     // as converter 1 stored it
const keep = JSON.stringify({ ...old, players: old.players.map(({ opening, ...p }) => p), source_ref: { ...old.source_ref, converter: undefined } });
ck('reprocessing adds the opening', addOpening(old, row(), evs, cat) === true && old.players[0].opening.status === 'recorded' && old.source_ref.converter === 2);
ck('only the opening and the converter changed: turns, result, deck, counts stay',
  JSON.stringify({ ...old, players: old.players.map(({ opening, ...p }) => p), source_ref: { ...old.source_ref, converter: undefined } }) === keep);
const once = JSON.stringify(old);
ck('again: nothing to write (idempotent)', addOpening(old, row(), evs, cat) === false && JSON.stringify(old) === once);
ck('same as a fresh conversion', eq(old.players[0].opening, convert(row(), evs, cat, 'Me').players[0].opening));
ck('a row of another game is not applied', addOpening(old, row({ game_id: 'g2' }), evs, cat) === false);
ck('reprocessing a concession records it as absent (not as kept 7)', (() => {
  const l = convert(row(), [], cat, 'Me'); delete l.players[0].opening;
  addOpening(l, row(), [{ type: 'GAME_CONCEDED', player: 2, data: {} }], cat);
  return l.players[0].opening.status === 'absent';
})());

// ---- (Conselho #1) the original cards kept vs the hand the game started with
const ids = (cs) => cs.map((c) => c.card_id);
const m4 = openingOf([hand(2, HAND), mull(2, { mulliganCount: 3, mulliganedCards: [ANGEL, URS, URS], drawnCards: [PEG, ELI, TOD] })], 2, cat);
ck('kept = only cards of the original hand (4), none of the drawn', eq(ids(m4.kept), ['LOR11-86', 'LOR13-97', 'LOR11-87', 'LOR11-89']));
ck('final = kept, then drawn: the 7 the game started with', eq(ids(m4.final), ['LOR11-86', 'LOR13-97', 'LOR11-87', 'LOR11-89', 'LOR4-84', 'LOR12-86', 'LOR11-87']) && m4.final.length === 7);
ck('a drawn copy of a card already kept is told apart: Tod in kept once, in final twice', ids(m4.kept).filter((x) => x === 'LOR11-87').length === 1 && ids(m4.final).filter((x) => x === 'LOR11-87').length === 2);
ck('hand stays the 7 dealt, untouched by the mulligan', eq(ids(m4.hand), ids(openingOf(game([mull(2, { mulliganCount: 0 })]), 2, cat).hand)));
ck('kept all 7: kept = final = hand', eq(ids(zero.kept), ids(zero.hand)) && eq(ids(zero.final), ids(zero.hand)));
ck('mulligan unknown: kept and final unknown too (null), not the 7 dealt', noEvent.kept === null && noEvent.final === null);

// ---- (Conselho #2) returned cards under another printing's id
const PEG_PROMO = C('9-C2-1', 'Pegasus - Gift for Hercules'), WR_PROMO = C('11-P3-29', 'White Rabbit - Late Again');
const promoHand = [PEG_PROMO, WR_PROMO, TOD, VIX, MUSHU, ANGEL, URS];
const r1 = openingOf([hand(2, promoHand), mull(2, { mulliganCount: 1, mulliganedCards: [PEG_PROMO], drawnCards: [ELI] })], 2, cat);
ck('promo in the hand, put back under the same promo id: recorded', r1.status === 'recorded' && r1.mulligan.returned[0].duels_id === '9-C2-1' && r1.kept.length === 6);
const r2 = openingOf([hand(2, promoHand), mull(2, { mulliganCount: 2, mulliganedCards: [PEG, WR], drawnCards: [ELI, URS] })], 2, cat);
ck('promo in the hand, put back under the regular id (4-84, 11-89): recorded, not invalid', r2.status === 'recorded', JSON.stringify(r2));
ck('…and it is that card that leaves the hand', !!r2.kept && !r2.kept.some((c) => ['9-C2-1', '11-P3-29'].includes(c.duels_id)) && r2.kept.length === 5);
const r3 = openingOf([hand(2, [PEG, PEG_PROMO, TOD, VIX, MUSHU, ANGEL, URS]), mull(2, { mulliganCount: 1, mulliganedCards: [PEG_PROMO], drawnCards: [ELI] })], 2, cat);
ck('both printings in the hand, the promo put back: the exact printing leaves, the regular one stays', r3.status === 'recorded' && r3.kept.some((c) => c.duels_id === '4-84') && !r3.kept.some((c) => c.duels_id === '9-C2-1'));
const r4 = openingOf([hand(2, [PEG_PROMO, TOD, VIX, MUSHU, ANGEL, URS, URS]), mull(2, { mulliganCount: 2, mulliganedCards: [PEG, PEG], drawnCards: [ELI, WR] })], 2, cat);
ck('one Pegasus in the hand, two put back: still invalid (printings do not create copies)', r4.status === 'invalid');
const r5 = openingOf([hand(2, promoHand), mull(2, { mulliganCount: 1, mulliganedCards: [C('77-1', 'A Card Not Yet In The Catalog')], drawnCards: [ELI] })], 2, cat);
ck('a returned card the catalog lacks and the hand lacks: invalid (no match by guess)', r5.status === 'invalid');

// ---- (Conselho #3) INITIAL_HAND repeated or contradictory
const twice = openingOf([hand(2, HAND), hand(2, [...HAND].reverse()), mull(2, { mulliganCount: 0 }), start(1)], 2, cat);
ck('the same hand twice (same cards, any order): recorded once, the first order kept', twice.status === 'recorded' && eq(ids(twice.hand), ids(zero.hand)));
const diffHands = openingOf([hand(2, HAND), hand(2, [...HAND.slice(0, 6), ELI]), mull(2, { mulliganCount: 0 })], 2, cat);
ck('two different hands for the owner: invalid', diffHands.status === 'invalid' && diffHands.issues.some((x) => /different initial hands/.test(x)), JSON.stringify(diffHands));
ck('an empty INITIAL_HAND beside the real one is not a second hand', openingOf([hand(2), hand(2, HAND), mull(2, { mulliganCount: 0 })], 2, cat).status === 'recorded');
const late = openingOf([mull(2, { mulliganCount: 0 }), hand(2, HAND)], 2, cat);
ck('a hand that comes after the mulligan: invalid', late.status === 'invalid' && late.issues.some((x) => /after the mulligan/.test(x)));
const afterTurn = openingOf([hand(2, HAND), mull(2, { mulliganCount: 0 }), start(1), hand(2, HAND)], 2, cat);
ck('a hand repeated after the first turn: invalid', afterTurn.status === 'invalid' && afterTurn.issues.some((x) => /after the first turn/.test(x)));
const oppCards = openingOf([hand(1, [TOD, TOD, TOD, TOD, VIX, VIX, VIX]), hand(2, HAND), mull(2, { mulliganCount: 0 })], 2, cat);
ck("an opponent's INITIAL_HAND with cards is ignored (only the owner's counts)", oppCards.status === 'recorded' && eq(ids(oppCards.hand), ids(zero.hand)));

// ---- (Conselho #4) compatibility: format 1.0, converter 1 fields unchanged
const v2 = convert(row(), game([mull(2, { mulliganCount: 1, mulliganedCards: [URS], drawnCards: [PEG] })]), cat, 'Me');
ck('format_version stays "1.0"', v2.format_version === '1.0');
const strip = (l) => { const c = JSON.parse(JSON.stringify(l)); delete c.players[0].opening; delete c.source_ref.converter; return c; };
ck('without the two new keys, the log has exactly the converter 1 keys', eq(Object.keys(strip(v2).players[0]).sort(), ['deck', 'is_me', 'mulligan_count', 'name', 'seat', 'went_first']) && eq(Object.keys(strip(v2).source_ref).sort(), ['game_id', 'mmr_before', 'mmr_delta', 'queue', 'replay_url']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
