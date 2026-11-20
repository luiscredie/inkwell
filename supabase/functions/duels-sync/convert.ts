// Conversion of a duels.ink match-history row + gamelog events to game log 1.0.
// Ported from tools/duels/duels_import.py (Catalog + convert), which is not in this repository and is not run by any
// workflow or function here; there is no parity check. This file is the converter in use (duels-sync). Converter 2 only
// adds fields (players[me].opening, source_ref.converter): a reader of 1.0 logs that ignores unknown keys reads it as before.
export type Json = Record<string, any>;

// ---------------------------------------------------------------- catalog ids
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export class Catalog {
  ids = new Set<string>();
  byName = new Map<string, string>();
  nameOf = new Map<string, string>();
  constructor(cards: Json[]) {
    const main = new Set(["C", "U", "R", "SR", "L"]);
    const sorted = [...cards].sort((a, b) => Number(!main.has(a.rarity)) - Number(!main.has(b.rarity)) || (a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0));
    for (const c of sorted) {
      this.ids.add(c.card_id);
      const base = norm(String(c.name_en || "").replace(/\s*\([^)]*\)\s*$/, ""));
      if (base) this.nameOf.set(c.card_id, base);
      if (base && !this.byName.has(base)) this.byName.set(base, c.card_id);
    }
  }
  // The same card in any printing (a promo, an enchanted or a reprint in a later set) -> one id: the main-rarity printing
  // with the same name, lowest id first. Printings of one card share the name in the catalog and differ only in art,
  // so a hand from the log and a deck list compare as the same card. An id the catalog lacks is returned as it is.
  baseOf(cardId?: string | null): string | null {
    if (!cardId) return null;
    const nm = this.nameOf.get(cardId);
    return (nm && this.byName.get(nm)) || cardId;
  }
  resolve(duelsId?: string | null, name?: string | null): string | null {
    const m = duelsId ? /^(\d+)-(\d+)$/.exec(duelsId) : null;
    if (m && this.ids.has(`LOR${m[1]}-${m[2]}`)) return `LOR${m[1]}-${m[2]}`;
    return name ? this.byName.get(norm(name)) ?? null : null;
  }
  // Deck lists: also variant printings (an alternate art is LOR4-224-E here, 4-224 on duels.ink),
  // other set codes (Q1-244) and, last, the card's name.
  resolveDeck(duelsId?: string | null, name?: string | null): string | null {
    const id = String(duelsId || "");
    const hit = this.resolve(id, name);
    if (hit) return hit;
    // 3-D23-3 on duels.ink is D23C-3 here (Ursula - Deceiver). Not D23-3: that id is another card (Elsa - Snow Queen).
    // Taken only when the D23C card is the same card as one of set {set}; otherwise unresolved, never a guess (#292).
    const d23 = /^(\d+)-D23-(\d+)$/i.exec(id);
    if (d23) {
      const c = `D23C-${d23[2]}`;
      return this.ids.has(c) && String(this.baseOf(c)).startsWith(`LOR${d23[1]}-`) ? c : null;
    }
    const cc = /^(\d+)-([A-Za-z]+\d*)-(\d+)$/.exec(id);   // 9-CC1-4 on duels.ink is DLPC1-4-CC1 here
    if (cc) for (const x of this.ids) if (x.endsWith(`-${cc[3]}-${cc[2].toUpperCase()}`)) return x;
    const m = /^([A-Za-z]*)(\d+)-(\d+)/.exec(id);
    if (m) {
      const bases = m[1] ? [`${m[1].toUpperCase()}${m[2]}-${m[3]}`] : [`LOR${m[2]}-${m[3]}`];
      for (const b of bases) {
        if (this.ids.has(b)) return b;
        for (const x of this.ids) if (x.startsWith(b + "-")) return x;
      }
    }
    return null;
  }
}

// duels.ink card id -> card name, from a game's events (cardId/cardName, targetCardId/targetCardName, ...)
export function namesFromEvents(events: Json[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events || []) {
    for (const d of [e, e?.data].filter((x) => x && typeof x === "object")) {
      for (const k of Object.keys(d)) {
        if (!/cardid$/i.test(k) || typeof d[k] !== "string") continue;
        const nm = d[k.replace(/Id$/, "Name").replace(/id$/, "name")];
        if (typeof nm === "string" && nm && !out.has(d[k])) out.set(d[k], nm);
      }
    }
  }
  return out;
}

// my deck list from a match-history row; names: duels.ink id -> name, for printings this catalog lacks
export function decklistOf(row: Json, cat: Catalog, names: Map<string, string> = new Map()): { list: Json[]; unresolved: Json[] } {
  const list: Json[] = [], unresolved: Json[] = [];
  for (const e of row.your_decklist || []) {
    const id = e.cardId ?? e.card_id ?? e.id ?? null, nm = e.cardName ?? e.name ?? names.get(id) ?? null;
    const card_id = cat.resolveDeck(id, nm);
    const qty = Number(e.count ?? e.qty ?? 0) || 0;
    if (!qty) continue;
    const have = card_id && list.find((x) => x.card_id === card_id);
    if (have) have.qty += qty; else if (card_id) list.push({ card_id, qty }); else unresolved.push({ duels_id: id, ...(nm ? { name: nm } : {}), qty });
  }
  return { list, unresolved };
}

// ---------------------------------------------------------------- opening hand and mulligan (converter 2)
// The log's owner only. duels.ink logs are from one player's side: the opponent's INITIAL_HAND and MULLIGAN cards come
// empty and only the count is public. Those hidden fields are never filled in.
//   status "recorded":
//     hand     = the 7 cards dealt (the original hand), in the log's order
//     mulligan = {count, returned, drawn}: what was put back and what came in its place. {count: 0, returned: [], drawn: []}
//                = kept all 7, only when the event says mulliganCount 0. null when it is unknown, never "kept all 7";
//                `mulligan_unknown` then says why: "no_event" (no MULLIGAN event), "event_without_data" (an event with no
//                count and no cards), "event_without_cards" (a count above 0 but not which cards)
//     kept     = the cards of the original hand that stayed (hand minus returned); null when the mulligan is unknown
//     final    = the hand the game started with: kept, then drawn (7 cards); null when the mulligan is unknown
//   status "absent": the log has no hand for this player (e.g. a concession before the game started).
//   status "invalid": the events disagree (hand not 7, a returned card not in the hand, two different hands, a hand after
//     the mulligan or the first turn, a mulligan after the first turn, ...). No card is kept then: nothing is guessed; `issues` says why.
// A returned card is matched to the hand by its duels.ink id first, then by the same card in another printing (a promo
// in the hand put back under its regular id is the same card, not an invalid event).
export const CONVERTER = 2;
export function openingOf(events: Json[], mine: number, cat: Catalog): Json {
  const ev = events || [];
  const at = (t: string) => ev.map((e, i) => [e, i] as [Json, number]).filter(([e]) => e?.type === t && Number(e.player) === mine);
  const hands = at("INITIAL_HAND").filter(([e]) => Array.isArray(e.data?.initialHandCards) && e.data.initialHandCards.length);
  if (!hands.length) {
    const started = ev.some((e) => e?.type === "TURN_START");
    return { status: "absent", reason: !started && ev.some((e) => e?.type === "GAME_CONCEDED") ? "conceded_before_start" : "not_in_log" };
  }
  const one = (c: Json) => {
    const card_id = cat.resolve(c?.id, c?.name), o: Json = { card_id, duels_id: c?.id ?? null };
    if (!card_id && c?.name) o.card_name = c.name;
    return o;
  };
  const issues: string[] = [];
  const bag = (cs: Json[]) => cs.map((c) => String(c?.id)).sort().join("|");
  const [[h0, hi]] = hands, hand0: Json[] = h0.data.initialHandCards;
  if (hands.some(([e]) => bag(e.data.initialHandCards) !== bag(hand0))) issues.push(`${hands.length} different initial hands`);
  if (hand0.length !== 7) issues.push(`hand has ${hand0.length} cards`);
  const mulls = at("MULLIGAN");
  if (mulls.length > 1) issues.push(`${mulls.length} mulligan events`);
  const firstTurn = ev.findIndex((e) => e?.type === "TURN_START");
  const lastHand = hands[hands.length - 1][1];
  if (firstTurn >= 0 && lastHand > firstTurn) issues.push("initial hand after the first turn");
  if (mulls.length && lastHand > mulls[0][1]) issues.push("initial hand after the mulligan");
  if (firstTurn >= 0 && mulls.some(([, i]) => i > firstTurn)) issues.push("mulligan after the first turn");
  let mulligan: Json | null = null, kept: Json[] | null = null, final: Json[] | null = null;
  let unknown: string | null = mulls.length ? null : "no_event";
  const d = mulls.length === 1 ? mulls[0][0].data || {} : null;
  if (d) {
    const has = (x: unknown) => Array.isArray(x) && x.length > 0;
    const count = typeof d.mulliganCount === "number" ? d.mulliganCount : null;
    // the cards say what happened; without them, only mulliganCount 0 says "kept all 7" (absent lists are not zero)
    if (!has(d.mulliganedCards) && !has(d.drawnCards)) {
      if (count === null) unknown = "event_without_data";
      else if (count > 0) unknown = "event_without_cards";
    }
  }
  if (d && !unknown) {
    const ret: Json[] = d.mulliganedCards || [], drew: Json[] = d.drawnCards || [];
    const count = d.mulliganCount ?? null;
    if (ret.length !== drew.length) issues.push(`${ret.length} returned, ${drew.length} drawn`);
    if (count !== null && Number(count) !== ret.length) issues.push(`count ${count}, ${ret.length} cards returned`);
    const left = [...hand0], same = (c: Json) => cat.baseOf(cat.resolve(c?.id, c?.name));
    for (const c of ret) {                       // returned ⊆ hand, as a multiset (two copies are two cards)
      let i = left.findIndex((h) => h?.id === c?.id);                                   // the same printing first
      if (i < 0 && same(c)) i = left.findIndex((h) => same(h) === same(c));             // then the same card
      if (i < 0) { issues.push(`returned ${c?.id} not in the hand`); continue; }
      left.splice(i, 1);
    }
    mulligan = { count: ret.length, returned: ret.map(one), drawn: drew.map(one) };
    kept = left.map(one);
    final = [...kept, ...mulligan.drawn];
  }
  if (issues.length) return { status: "invalid", issues };
  const out: Json = { status: "recorded", hand: hand0.map(one), mulligan, kept, final };
  if (unknown) out.mulligan_unknown = unknown;
  return out;
}
// Adds the opening to a log stored by an earlier converter (a reprocessing). Changes only players[me].opening and
// source_ref.converter: turns, result, deck and summary stay. True when something changed; running it again changes nothing.
export function addOpening(log: Json, row: Json, events: Json[], cat: Catalog): boolean {
  const me = log?.players?.find((p: Json) => p?.is_me);
  if (!me || log.source_ref?.game_id !== row?.game_id) return false;
  const next = openingOf(events, Number(row.your_player), cat);
  if (JSON.stringify(me.opening) === JSON.stringify(next) && log.source_ref?.converter === CONVERTER) return false;
  me.opening = next;
  log.source_ref = { ...(log.source_ref || {}), converter: CONVERTER };
  return true;
}

// ---------------------------------------------------------------- conversion (rules first ported from duels_import.convert)
const PRIMARY = new Set(["ink", "play", "shift", "sing", "quest", "challenge", "activate"]);
const REASON: Record<string, string | null> = { concession: "concede", lore: "lore", abandoned: "other", deck_out: "deck_out", timeout: "time" };

// A duels.ink best-of-3: the match id match history gives each of its games (match_id, match_format "bo3").
// The same cleaning as the match.json import in Jogos (src/site/coach), so both give the same id.
export function matchIdOf(row: Json): string | null {
  if (String(row?.match_format || "").toLowerCase() !== "bo3") return null;
  const id = String(row?.match_id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return id || null;
}
// A stored game's log gets the match id from its own history row (same duels.ink game id). True when it changed.
// A log already in a match (from match.json or an earlier sync) is left as it is: never moved to another match.
export function linkMatchFromRow(log: Json, row: Json): boolean {
  const id = matchIdOf(row);
  if (!id || !log || log.source_ref?.game_id !== row.game_id || log.event?.match_id) return false;
  log.event = { ...(log.event || {}), match_id: id, match_format: "bo3" };
  return true;
}

export function convert(row: Json, events: Json[], cat: Catalog, meName: string): Json {
  const mine = Number(row.your_player);
  const seatOf = (n: any) => (n === null || n === undefined ? null : Number(n) === mine ? "p1" : "p2");
  const starts = events.filter((e) => e.type === "TURN_START");
  const first = starts.length ? seatOf(starts[0].player) : row.went_first ? "p1" : "p2";
  const t0 = events.find((e) => e.type === "GAME_START")?.timestamp ?? events[0]?.timestamp ?? 0;
  const turns: Json[] = [];
  const lore: Json = { p1: 0, p2: 0 };
  const mull: Json = { p1: null, p2: null };
  const before = new WeakMap<object, Json>();
  let seq = 0, winner: string | null = null, reason: string | null | undefined = undefined;

  const add = (a: Json, prev?: Json) => {
    if (!turns.length) return;
    a.seq = ++seq;
    before.set(a, { ...(prev ?? lore) });
    turns[turns.length - 1].actions.push(a);
  };
  const undo = (seat: string | null) => {
    if (!turns.length) return;
    const acts = turns[turns.length - 1].actions;
    for (let i = acts.length - 1; i >= 0; i--) {
      if (PRIMARY.has(acts[i].type) && acts[i].by === seat) { Object.assign(lore, before.get(acts[i])); acts.splice(i); return; }
    }
  };
  const card = (id?: string, name?: string) => {
    const r = cat.resolve(id, name);
    return r || !name ? { card_id: r } : { card_id: r, card_name: name };
  };
  const setLore = (seat: string | null, total: any, byText: string | null, t: number, asQuest?: Json) => {
    if (total === null || total === undefined || !seat) return;
    const prev = { ...lore }, delta = Number(total) - lore[seat];
    lore[seat] = Number(total);
    if (asQuest) { Object.assign(asQuest, { value: delta, lore_after: { ...lore } }); add(asQuest, prev); }
    else if (delta) { const a: Json = { by: seat, type: "lore_adjust", value: delta, lore_after: { ...lore }, t }; if (byText) a.text = byText; add(a, prev); }
  };

  for (const e of events) {
    const typ = e.type, d = e.data || {}, who = seatOf(e.player);
    const t = Math.round(Math.max(0, e.timestamp - t0) / 100) / 10;
    if (typ === "FREE_UNDO") undo(who);
    else if (typ === "MULLIGAN" && who) mull[who] = d.mulliganCount ?? null;
    else if (typ === "TURN_START") {
      if (turns.length) turns[turns.length - 1].lore_end = { ...lore };
      turns.push({ number: turns.length + 1, player: who, actions: [] });
    } else if (typ === "CARD_INKED") add({ by: who, type: "ink", ...card(d.cardId, d.cardName), t });
    else if (typ === "CARD_PUT_INTO_INKWELL") add({ by: who, type: "ink", card_id: null, text: `from ${d.fromZone || "effect"}`, t });
    else if (typ === "CARD_PLAYED") {
      const a: Json = { by: who, ...card(d.cardId, d.cardName), t };
      if (d.usedShift) { const tg = cat.resolve(d.shiftTargetCardId, d.shiftTargetCardName); Object.assign(a, { type: "shift", targets: tg ? [tg] : [] }); }
      else if (d.singerCardId || d.singerCards) {
        const singers = d.singerCards || [{ cardName: d.singerCardName }];
        Object.assign(a, { type: "sing", text: "sung by " + singers.map((s: Json) => s.cardName || s.name || "?").join(", ") });
      } else a.type = "play";
      add(a);
    } else if (typ === "CARD_QUEST") setLore(who, d.newLoreTotal, null, t, { by: who, type: "quest", ...card(d.cardId, d.cardName), t });
    else if (typ === "LORE_GAINED") setLore(who, d.newLoreTotal, d.abilitySourceCardName ?? null, t);
    else if (typ === "ABILITY_TRIGGERED") {
      const src = d.abilitySourceCardName;
      for (const k of d.effectDescriptionKeys || []) {
        const p = k.params || {}, label = `${src}: ${d.abilityName || "ability"}`;
        if (k.key === "gainsLore") setLore(who, p.total, label, t);
        else if (k.key === "opponentLosesLore" && who) setLore(who === "p1" ? "p2" : "p1", p.total, label, t);
      }
    } else if (typ === "CARD_ATTACK") {
      const tg = cat.resolve(d.targetCardId, d.targetCardName);
      const a: Json = { by: who, type: "challenge", ...card(d.cardId, d.cardName), t };
      const acts = turns.length ? turns[turns.length - 1].actions : [];
      const prev = acts[acts.length - 1];
      if (prev && prev.type === "challenge" && prev.card_id === a.card_id
          && JSON.stringify(prev.targets) === JSON.stringify(tg ? [tg] : prev.targets) && !(prev.text || "").includes("dealt")) acts.pop();
      if (tg) a.targets = [tg]; else a.text = d.targetCardName || "?";
      if (d.actualDamageToDefender !== undefined && d.actualDamageToDefender !== null)
        a.text = `${a.text || ""} (${d.actualDamageToDefender} dealt, ${d.actualDamageToAttacker || 0} taken)`.trim();
      add(a);
    } else if (typ === "CARD_DESTROYED") add({ by: who, type: "banish", ...card(d.cardId, d.cardName), t });
    else if (typ === "ABILITY_ACTIVATED" || typ === "CARD_BOOSTED") {
      const label = d.abilityName || (typ === "CARD_BOOSTED" ? "Boost" : null);
      const a: Json = { by: who, type: "activate", ...card(d.cardId, d.cardName), t };
      if (label) a.text = label;
      add(a);
    } else if (typ === "DAMAGE_DEALT" && turns.length) {
      const tg = cat.resolve(d.cardId, d.cardName);
      const a: Json = { by: turns[turns.length - 1].player, type: "damage", value: Number(d.damage || 0), t, ...card(d.abilitySourceCardId, d.abilitySourceCardName) };
      if (tg) a.targets = [tg];
      add(a);
    } else if (typ === "GAME_END") {
      winner = seatOf(d.winner);
      reason = d.victoryReason in REASON ? REASON[d.victoryReason] : d.victoryReason == null ? null : "other";
      if (reason === null && (d.newLoreTotal || 0) >= 20) reason = "lore";
      if (winner && d.newLoreTotal !== undefined && d.newLoreTotal !== null) setLore(winner, d.newLoreTotal, "final lore", t);
    }
  }
  if (turns.length) turns[turns.length - 1].lore_end = { ...lore };

  const final: Json = { p1: row.your_lore, p2: row.opp_lore };
  for (const seat of ["p1", "p2"]) {
    if (final[seat] !== null && final[seat] !== undefined && final[seat] !== lore[seat] && turns.length) {
      const last = turns[turns.length - 1];
      setLore(seat, final[seat], "lore change not shown in the log", last.actions.length ? last.actions[last.actions.length - 1].t : 0);
      last.actions[last.actions.length - 1].confidence = 0.5;
      last.lore_end = { ...lore };
    }
  }
  winner ??= ({ win: "p1", loss: "p2", draw: "draw" } as Json)[row.result] ?? null;
  if (reason === undefined || reason === null) reason = ({ concede: "concede", lore: "lore" } as Json)[row.end_reason || ""] ?? "other";

  const deck = decklistOf(row, cat, namesFromEvents(events));
  const colors = (s?: string) => [...new Set(String(s || "").split("/").map((c) => c.trim()).filter(Boolean).map((c) => c[0].toUpperCase() + c.slice(1).toLowerCase()))].sort();
  const mid = matchIdOf(row);
  const ev: Json = { name: row.queue_name || row.mode, kind: "online", game_in_match: row.match_game_number, match_id: mid, match_format: mid ? "bo3" : null };
  for (const k of Object.keys(ev)) if (ev[k] === null || ev[k] === undefined) delete ev[k];
  return {
    format_version: "1.0", game_id: `duels-${row.game_id}`, source: "duels_ink",
    source_ref: { game_id: row.game_id, replay_url: row.replay_url ?? null, queue: row.queue_name ?? null, mmr_before: row.mmr_before ?? null, mmr_delta: row.mmr_delta ?? null, converter: CONVERTER },
    played_at: row.started_at,
    game_format: String(row.queue_id || row.queue_name || "").toLowerCase().includes("core") ? "core" : "other",
    event: ev,
    players: [
      { seat: "p1", name: meName, is_me: true, went_first: first === "p1", mulligan_count: mull.p1, opening: openingOf(events, mine, cat),
        deck: { inks: colors(row.your_deck_colors), list: deck.list, list_source: "duels_ink", ...(deck.unresolved.length ? { unresolved: deck.unresolved } : {}) } },
      { seat: "p2", name: row.opp_display_name || "Opponent", is_me: false, went_first: first === "p2", mulligan_count: mull.p2,
        deck: { archetype: row.opp_deck_colors || "Unknown", inks: colors(row.opp_deck_colors), list_source: "observed" } },
    ],
    turns, result: { winner, reason, final_lore: { ...lore } }, visibility: "private",
  };
}
