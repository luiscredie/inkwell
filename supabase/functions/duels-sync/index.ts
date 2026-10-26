// duels-sync: copies new duels.ink games into public.game_logs, on a schedule (pg_cron, every 30 minutes).
//
// Port of tools/duels/duels_import.py (convert + Catalog). Each run:
//   1. checks the caller's key (x-sync-key) against the one in Vault, via public.duels_sync_begin
//   2. reads match history since the newest duels.ink game already stored (minus 2 days of overlap)
//   3. downloads and converts up to MAX_PER_RUN games not stored yet, paced under duels.ink's limits
//   4. upserts them as private games and records the result (public.duels_sync_finish)
// Tokens: each player's own (saved with public.set_my_duels_token, supabase/duels_tokens.sql);
// a row without one uses the DUELS_TOKEN secret (read-only duels.ink API token). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Catalog, convert, decklistOf, namesFromEvents, type Json } from "./convert.ts";

const BASE = "https://duels.ink";
const CATALOG_URL = "https://luiscredie.github.io/inkwell/data/cards.json";
const MAX_PER_RUN = 12;
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

async function syncUser(userId: string, token: string, cat: Catalog) {
  const newest = await db(`game_logs?user_id=eq.${userId}&source=eq.duels_ink&select=played_at&order=played_at.desc.nullslast&limit=1`);
  const since = newest?.[0]?.played_at ? new Date(Date.parse(newest[0].played_at) - 2 * 864e5).toISOString() : null;
  const me = await duels("/api/me", token);
  const rows: Json[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 8; page++) {
    const q = new URLSearchParams({ format: "json", limit: "250", ...(cursor ? { cursor } : {}), ...(since ? { from: since } : {}) });
    const res = await duels(`/api/me/match-history?${q}`, token);
    rows.push(...(res?.games || []));
    cursor = res?.next_cursor || null;
    if (!cursor || !since) break;          // first run without a stored game: the newest page is enough here
    await sleep(3100);
  }
  const wanted = rows.filter((r) => ["win", "loss", "draw"].includes(r.result) && !r.opp_is_bot);
  const ids = wanted.map((r) => `duels-${r.game_id}`);
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map((x) => `"${x}"`).join(",");
    for (const r of (await db(`game_logs?user_id=eq.${userId}&game_id=in.(${chunk})&select=game_id`)) || []) have.add(r.game_id);
  }
  const todo = wanted.filter((r) => !have.has(`duels-${r.game_id}`)).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))).slice(0, MAX_PER_RUN);
  const logs: Json[] = [];
  for (const r of todo) {
    const events = await duels(`/g/${encodeURIComponent(r.game_id)}`, token, true);
    if (events) logs.push(convert(r, events, cat, me?.name || "Me"));
    await sleep(2100);
  }
  if (logs.length) {
    await db("game_logs?on_conflict=user_id,game_id", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(logs.map((l) => ({ user_id: userId, game_id: l.game_id, source: "duels_ink", played_at: l.played_at, log: l, visibility: "private" }))),
    });
  }
  return { seen: wanted.length, already: have.size, added: logs.length, waiting: Math.max(0, wanted.length - have.size - logs.length) };
}

// Rewrites my deck list in the duels.ink games already stored, from match history (fixes lists that lost cards
// the catalogue matched only by a variant id or by name). Lists the player edited by hand are left alone.
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
  let changed = 0, checked = 0;
  const ids = [...byGame.keys()];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40).map((x) => `"${x}"`).join(",");
    const stored: Json[] = (await db(`game_logs?user_id=eq.${userId}&game_id=in.(${chunk})&select=game_id,log`)) || [];
    const patch: Json[] = [];
    for (const g of stored) {
      checked++;
      const me = (g.log?.players || []).find((p: Json) => p.is_me);
      if (!me?.deck || (me.deck.list_source && me.deck.list_source !== "duels_ink")) continue;
      const d = decklistOf(byGame.get(g.game_id)!, cat, names);
      const sum = (l: Json[]) => (l || []).reduce((n, e) => n + (Number(e.qty) || 0), 0);
      if (sum(d.list) <= sum(me.deck.list) && !d.unresolved.length === !me.deck.unresolved) continue;
      me.deck.list = d.list;
      if (d.unresolved.length) me.deck.unresolved = d.unresolved; else delete me.deck.unresolved;
      patch.push(g);
    }
    for (const g of patch) {
      await db(`game_logs?user_id=eq.${userId}&game_id=eq.${encodeURIComponent(g.game_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ log: g.log }) });
      changed++;
    }
  }
  return { mode: "refresh_decks", history: rows.length, checked, changed, unknown_ids: [...unknown.keys()].filter((id) => !names.has(id)) };
}

Deno.serve(async (req) => {
  const key = req.headers.get("x-sync-key") || "";
  const body: Json = await req.json().catch(() => ({}));
  const only = typeof body?.user === "string" && /^[0-9a-f-]{36}$/i.test(body.user) ? body.user : null;   // one player, right after they connect
  const users: Json[] = await db("rpc/duels_sync_begin", { method: "POST", body: JSON.stringify(only ? { p_key: key, p_user: only } : { p_key: key }) }).catch(() => null);
  if (!users) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  const fallback = (Deno.env.get("DUELS_TOKEN") || "").trim();
  const out: Json[] = [];
  let cat: Catalog | null = null;
  for (const u of users) {
    let result: Json;
    try {
      const token = String(u.token || fallback).trim();
      if (!/^[0-9a-f]{96}$/i.test(token)) throw new Error(u.token ? "the duels.ink token is malformed" : "no duels.ink token saved");
      cat ??= new Catalog((await (await fetch(CATALOG_URL)).json()).cards || []);
      result = { ok: true, ...(only && body?.refresh_decks === true ? await refreshDecks(u.user_id, token, cat) : await syncUser(u.user_id, token, cat)) };
    } catch (e) {
      result = { ok: false, error: String((e as Error).message || e).slice(0, 300) };
    }
    await db("rpc/duels_sync_finish", { method: "POST", body: JSON.stringify({ p_key: key, p_user: u.user_id, p_result: result }) }).catch(() => {});
    out.push({ user: u.user_id, ...result });
  }
  return new Response(JSON.stringify({ runs: out }), { headers: { "Content-Type": "application/json" } });
});
