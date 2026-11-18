// duels-sync: copies new duels.ink games into public.game_logs, on a schedule (pg_cron, every 30 minutes).
//
// Port of tools/duels/duels_import.py (convert + Catalog). Each run:
//   1. checks the caller's key (x-sync-key) against the one in Vault, via public.duels_sync_begin
//   2-3. sync.ts: reads match history since the newest stored game (minus OVERLAP_DAYS), imports the games not stored
//        yet (up to MAX_PER_RUN, paced under duels.ink's limits) and reports what it saw, left out and still misses
//   4. records the result (public.duels_sync_finish)
// Tokens: each player's own (saved with public.set_my_duels_token, supabase/duels_tokens.sql);
// a row without one may use the DUELS_TOKEN secret (read-only duels.ink API token) only if it is the owner's row. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Catalog, decklistOf, linkMatchFromRow, namesFromEvents, type Json } from "./convert.ts";
import { sharedTokenAllowed, syncUser } from "./sync.ts";

const BASE = "https://duels.ink";
// the site address; set the SITE_URL secret when the domain changes
const CATALOG_URL = (Deno.env.get("SITE_URL") || "https://luiscredie.github.io/inkwell/").replace(/\/*$/, "/") + "data/cards.json";
const UA = "inkwell-duels-sync/1.0 (personal use)";
const SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`db ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function duels(path: string, token: string, binary = false): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let r: Response;
    try {
      r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } });
    } catch {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (r.status === 429) { await sleep((Number(r.headers.get("Retry-After")) || 30) * 1000 + 1000); continue; }
    if (r.status === 401 || r.status === 403) throw new Error("duels.ink rejected the token (expired or revoked?)");
    if (r.status === 404) return null;
    if (!r.ok) { await sleep(2000 * (attempt + 1)); continue; }
    if (!binary) return await r.json();
    const buf = new Uint8Array(await r.arrayBuffer());
    const text = buf[0] === 0x1f && buf[1] === 0x8b
      ? await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
      : new TextDecoder().decode(buf);
    return JSON.parse(text);
  }
  throw new Error(`gave up on ${path}`);
}

// Rewrites my deck list in the duels.ink games already stored, from match history (fixes lists that lost cards
// the catalogue matched only by a variant id or by name). Lists the player edited by hand are left alone.
// Also gives each stored best-of-3 game its match id from the same history row (only the log changes; nothing is
// added; a game already in a match stays). Safe to run again: what is already linked or right is not written.
async function refreshDecks(userId: string, token: string, cat: Catalog) {
  const rows: Json[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 8; page++) {
    const q = new URLSearchParams({ format: "json", limit: "250", ...(cursor ? { cursor } : {}) });
    const res = await duels(`/api/me/match-history?${q}`, token);
    rows.push(...(res?.games || []));
    cursor = res?.next_cursor || null;
    if (!cursor) break;
    await sleep(3100);
  }
  // names for duels.ink ids this catalogue does not know: one game's events per unknown id
  const names = new Map<string, string>();
  const unknown = new Map<string, Json>();
  for (const r of rows) for (const e of r.your_decklist || []) { const id = e.cardId ?? e.card_id ?? e.id; if (id && !cat.resolveDeck(id, e.cardName ?? e.name ?? null) && !unknown.has(id)) unknown.set(id, r); }
  for (const [id, r] of [...unknown].slice(0, 10)) {
    if (names.has(id)) continue;
    const events = await duels(`/g/${encodeURIComponent(r.game_id)}`, token, true);
    for (const [k, v] of namesFromEvents(events || [])) if (!names.has(k)) names.set(k, v);
    await sleep(2100);
  }
  const byGame = new Map(rows.map((r) => [`duels-${r.game_id}`, r]));
  let changed = 0, checked = 0, linked = 0;
  const ids = [...byGame.keys()];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40).map((x) => `"${x}"`).join(",");
    const stored: Json[] = (await db(`game_logs?user_id=eq.${userId}&game_id=in.(${chunk})&select=game_id,log`)) || [];
    const patch: Json[] = [];
    for (const g of stored) {
      checked++;
      const row = byGame.get(g.game_id)!;
      const match = linkMatchFromRow(g.log, row);
      if (match) linked++;
      let deck = false;
      const me = (g.log?.players || []).find((p: Json) => p.is_me);
      if (me?.deck && !(me.deck.list_source && me.deck.list_source !== "duels_ink")) {
        const d = decklistOf(row, cat, names);
        const sum = (l: Json[]) => (l || []).reduce((n, e) => n + (Number(e.qty) || 0), 0);
        if (!(sum(d.list) <= sum(me.deck.list) && !d.unresolved.length === !me.deck.unresolved)) {
          me.deck.list = d.list;
          if (d.unresolved.length) me.deck.unresolved = d.unresolved; else delete me.deck.unresolved;
          deck = true;
        }
      }
      if (match || deck) patch.push(g);
    }
    for (const g of patch) {
      await db(`game_logs?user_id=eq.${userId}&game_id=eq.${encodeURIComponent(g.game_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ log: g.log }) });
      changed++;
    }
  }
  return { mode: "refresh_decks", history: rows.length, checked, changed, linked, more: !!cursor, unknown_ids: [...unknown.keys()].filter((id) => !names.has(id)) };
}

Deno.serve(async (req) => {
  const key = req.headers.get("x-sync-key") || "";
  const body: Json = await req.json().catch(() => ({}));
  const only = typeof body?.user === "string" && /^[0-9a-f-]{36}$/i.test(body.user) ? body.user : null;   // one player, right after they connect
  const users: Json[] = await db("rpc/duels_sync_begin", { method: "POST", body: JSON.stringify(only ? { p_key: key, p_user: only } : { p_key: key }) }).catch(() => null);
  if (!users) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  const fallback = (Deno.env.get("DUELS_TOKEN") || "").trim();
  // optional: the user id the shared token belongs to; unset = matched by the duels.ink account of their stored games
  const owner = (Deno.env.get("DUELS_TOKEN_USER") || "").trim() || null;
  const out: Json[] = [];
  let cat: Catalog | null = null;
  for (const u of users) {
    let result: Json;
    try {
      // a row without its own token may use the shared one only if it is the owner's (sync.ts: sharedTokenAllowed)
      const shared = !u.token;
      const token = String(u.token || fallback).trim();
      if (!/^[0-9a-f]{96}$/i.test(token)) throw new Error(u.token ? "the duels.ink token is malformed" : "no duels.ink token saved");
      cat ??= new Catalog((await (await fetch(CATALOG_URL)).json()).cards || []);
      const io = { duels: (p: string, bin = false) => duels(p, token, bin), db, sleep };
      const refresh = only && body?.refresh_decks === true;
      if (refresh && shared && !(await sharedTokenAllowed(u.user_id, (await duels("/api/me", token))?.name ?? null, io, owner)))
        throw new Error("no duels.ink token saved (the shared token belongs to another account)");
      result = { ok: true, ...(refresh
        ? await refreshDecks(u.user_id, token, cat)
        : await syncUser(u.user_id, cat, io, { state: u.state ?? null, ...(shared ? { shared: { ownerId: owner } } : {}) })) };
      if (!result.state && u.state) result.state = u.state;          // a deck refresh keeps the sync position
      // duels_sync_begin without the state column (supabase/duels_sync_state.sql not run yet): say so, plainly
      if (!("state" in u)) result.state_read = false;
    } catch (e) {
      // keep where the sync was (scan position, games waiting for a replay): a failed run must not lose it
      result = { ok: false, error: String((e as Error).message || e).slice(0, 300), ...(u.state ? { state: u.state } : {}) };
    }
    await db("rpc/duels_sync_finish", { method: "POST", body: JSON.stringify({ p_key: key, p_user: u.user_id, p_result: result }) }).catch(() => {});
    out.push({ user: u.user_id, ...result });
  }
  return new Response(JSON.stringify({ runs: out }), { headers: { "Content-Type": "application/json" } });
});
