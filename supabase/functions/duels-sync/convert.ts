// Conversion of a duels.ink match-history row + gamelog events to game log 1.0.
// Same rules as tools/duels/duels_import.py (Catalog + convert); parity.mjs checks they produce the same logs.
export type Json = Record<string, any>;

// ---------------------------------------------------------------- catalog ids
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export class Catalog {
  ids = new Set<string>();
  byName = new Map<string, string>();
  constructor(cards: Json[]) {
    const main = new Set(["C", "U", "R", "SR", "L"]);
    const sorted = [...cards].sort((a, b) => Number(!main.has(a.rarity)) - Number(!main.has(b.rarity)) || (a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0));
    for (const c of sorted) {
      this.ids.add(c.card_id);
      const base = norm(String(c.name_en || "").replace(/\s*\([^)]*\)\s*$/, ""));
      if (base && !this.byName.has(base)) this.byName.set(base, c.card_id);
    }
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

// ---------------------------------------------------------------- conversion (same rules as duels_import.convert)
const PRIMARY = new Set(["ink", "play", "shift", "sing", "quest", "challenge", "activate"]);
const REASON: Record<string, string | null> = { concession: "concede", lore: "lore", abandoned: "other", deck_out: "deck_out", timeout: "time" };

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
  const ev: Json = { name: row.queue_name || row.mode, kind: "online", game_in_match: row.match_game_number };
  for (const k of Object.keys(ev)) if (ev[k] === null || ev[k] === undefined) delete ev[k];
  return {
    format_version: "1.0", game_id: `duels-${row.game_id}`, source: "duels_ink",
    source_ref: { game_id: row.game_id, replay_url: row.replay_url ?? null, queue: row.queue_name ?? null, mmr_before: row.mmr_before ?? null, mmr_delta: row.mmr_delta ?? null },
    played_at: row.started_at,
    game_format: String(row.queue_id || row.queue_name || "").toLowerCase().includes("core") ? "core" : "other",
    event: ev,
    players: [
      { seat: "p1", name: meName, is_me: true, went_first: first === "p1", mulligan_count: mull.p1,
        deck: { inks: colors(row.your_deck_colors), list: deck.list, list_source: "duels_ink", ...(deck.unresolved.length ? { unresolved: deck.unresolved } : {}) } },
      { seat: "p2", name: row.opp_display_name || "Opponent", is_me: false, went_first: first === "p2", mulligan_count: mull.p2,
        deck: { archetype: row.opp_deck_colors || "Unknown", inks: colors(row.opp_deck_colors), list_source: "observed" } },
    ],
    turns, result: { winner, reason, final_lore: { ...lore } }, visibility: "private",
  };
}
