// rph-events: Disney Lorcana events near a place, from the Ravensburger Play Hub (tcg.ravensburgerplay.com),
// for the Eventos page. Public data, no key (the same API the Play Hub site uses); cached here for 15 minutes.
//   GET ?lat=-23.55&lng=-46.63&km=100&from=2026-10-27&to=2027-01-31   -> { events: [...], total, received, complete, issues, divergences }
//   GET ?geocode=Campinas                                               -> { lat, lng, label } (Open-Meteo geocoder)
//   GET ?id=904881                                                      -> one event (to link a community table)
//   GET ?store=17617&from=…&to=…                                        -> that store's events, same shape as the list (store communities)
//   GET ?stores=Colecionaveis                                           -> [{ id, name, city, state, country, address }] Lorcana stores by name
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { categorize, reviewObserved } from "./categories.js";
import { fetchAll } from "./paginate.js";

const API = "https://api.cloudflare.ravensburgerplay.com/hydraproxy/api/v2";
const HEADERS = { "Content-Type": "application/json", Referer: "https://tcg.ravensburgerplay.com/" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 15 * 60 * 1000;
type Json = Record<string, any>;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
const num = (v: string | null, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function slim(e: Json, templates: Record<string, string> = {}) {
  const s = e.store || {};
  return {
    ...categorize(e, templates),   // template_id, template_name, category, category_source (+ name_divergence)
    id: e.id, name: e.name, start: e.start_datetime, end: e.end_datetime || null,
    format: e.gameplay_format?.name || null, type: e.event_type || e.event_format || null,
    cost_cents: e.cost_in_cents ?? null, currency: e.currency || null,
    capacity: e.capacity ?? null, registered: e.registered_user_count ?? null,
    status: e.display_status || null, online: !!e.event_is_online, headline: !!e.is_headlining_event,
    address: e.full_address || s.full_address || null, lat: e.latitude ?? s.latitude ?? null, lng: e.longitude ?? s.longitude ?? null,
    km: e.distance_in_miles != null ? Math.round(e.distance_in_miles * 1.609) : null,
    store: s.name ? { id: s.id, name: s.name, city: s.city || null, website: s.website || null, instagram: s.instagram_handle || null, phone: s.phone_number || null } : null,
    url: `https://tcg.ravensburgerplay.com/events/${e.id}`,
    description: typeof e.description === "string" ? e.description.slice(0, 1200) : null,
  };
}

// template id -> name (Weekly Play (Constructed), Learn-to-Play…). Best effort: if it fails, events still load
// and only the observed ids get a category (see categories.js).
let tpl: { at: number; data: Record<string, string> } | null = null;
async function templates() {
  if (tpl && Date.now() - tpl.at < 6 * 3600e3) return tpl.data;
  try {
    const r = await fetch(`${API}/event-configuration-templates/?game_slug=disney-lorcana`, { headers: HEADERS });
    if (!r.ok) throw new Error(`templates ${r.status}`);
    const d = await r.json(), list = Array.isArray(d) ? d : d?.results || [];
    tpl = { at: Date.now(), data: Object.fromEntries(list.filter((t: Json) => t?.id && t?.name).map((t: Json) => [t.id, t.name])) };
  } catch (e) { console.warn("rph-events: templates unavailable", String(e)); return tpl?.data || {}; }
  return tpl.data;
}

// near a place, or (store) at one Play Hub store wherever the visitor is: the same reading, categories and checks
async function events(where: { lat: number; lng: number; km: number } | { store: number }, from: string, to: string) {
  const key = ("store" in where ? ["store", where.store] : [where.lat.toFixed(2), where.lng.toFixed(2), where.km]).concat([from, to]).join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const by: Record<string, string> = "store" in where ? { store: String(where.store) }
    : { latitude: String(where.lat), longitude: String(where.lng), num_miles: String(Math.round(where.km / 1.609)) };
  // every page, each event once; a short or interrupted read is reported (paginate.js), never hidden
  const read = await fetchAll(async (page: number, size: number) => {
    const q = new URLSearchParams({ game_slug: "disney-lorcana", ...by,
      page: String(page), page_size: String(size), start_date_after: `${from}T00:00:00Z`, start_date_before: `${to}T23:59:59Z` });
    q.append("display_statuses", "upcoming"); q.append("display_statuses", "inProgress");
    const r = await fetch(`${API}/events/?${q}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`play hub ${r.status}`);
    return await r.json();
  });
  // monitoring: these lines are the ones to watch in the function's logs
  if (!read.complete) console.warn("rph-events: incomplete", JSON.stringify({ key, count: read.count, received: read.received, issues: read.issues }));
  else if (read.issues.length) console.info("rph-events: pagination", JSON.stringify({ key, count: read.count, received: read.received, issues: read.issues }));
  const t = await templates();
  const divergences = reviewObserved(read.events, t);   // flagged names, for investigation; categories are not changed
  if (divergences.length) console.warn("rph-events: event names that disagree with an observed template", JSON.stringify(divergences));
  const out = read.events.map((e) => slim(e, t));
  const data = { divergences, events: out.sort((a, b) => String(a.start).localeCompare(String(b.start))), total: read.count,
    received: read.received, complete: read.complete, issues: read.issues };
  cache.set(key, { at: read.complete ? Date.now() : Date.now() - TTL + 60_000, data });   // an incomplete read is kept 1 minute only
  return data;
}

// Lorcana stores by name, to pick a community's store. The Play Hub's /game-stores/ has one row per store and
// game (and ignores game_slug), so keep the Lorcana rows and each store once. Matches names only, not cities.
async function stores(q: string) {
  const key = "stores|" + q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const u = new URLSearchParams({ game_slug: "disney-lorcana", search: q, page_size: "50" });
  const r = await fetch(`${API}/game-stores/?${u}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`play hub ${r.status}`);
  const seen = new Set();
  const data = ((await r.json())?.results || [])
    .filter((g: Json) => g?.game?.slug === "disney-lorcana" && g?.store?.id && !seen.has(g.store.id) && seen.add(g.store.id))
    .slice(0, 20).map(({ store: s }: Json) => ({ id: s.id, name: s.name, city: s.city || null, state: s.state || null, country: s.country || null,
      address: typeof s.full_address === "string" ? s.full_address.replace(/\s*\n\s*/g, ", ").slice(0, 300) : null }));
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function geocode(q: string) {   // city names, via Open-Meteo's free geocoder (no key)
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=pt&format=json`);
  if (!r.ok) throw new Error(`geocode ${r.status}`);
  const d = (await r.json())?.results?.[0];
  return d ? { lat: +d.latitude, lng: +d.longitude, label: [d.name, d.admin1, d.country_code].filter(Boolean).join(", ") } : null;
}

// best-effort limit per address (each server instance counts on its own): this function is open to visitors,
// so it must not become a free relay to the Play Hub
const hits = new Map<string, { n: number; at: number }>();
const LIMIT = 90, WINDOW = 5 * 60 * 1000;
function limited(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "?").split(",")[0].trim();
  const now = Date.now(), h = hits.get(ip);
  if (!h || now - h.at > WINDOW) { hits.set(ip, { n: 1, at: now }); if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > WINDOW) hits.delete(k); return false; }
  h.n++;
  return h.n > LIMIT;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "GET only" }, 405);
  if (limited(req)) return json({ error: "too many requests, try again in a few minutes" }, 429);
  const u = new URL(req.url);
  try {
    const id = u.searchParams.get("id");
    if (id) {
      if (!/^\d{1,12}$/.test(id)) return json({ error: "bad id" }, 400);
      const hit = cache.get("id|" + id);
      if (hit && Date.now() - hit.at < TTL) return json(hit.data);
      const r = await fetch(`${API}/events/${id}/`, { headers: HEADERS });
      if (r.status === 404) return json(null, 404);
      if (!r.ok) throw new Error(`play hub ${r.status}`);
      const e = await r.json();
      if (e?.game?.slug && e.game.slug !== "disney-lorcana") return json(null, 404);
      const data = slim(e, await templates());   // same rule as the list: the category depends on the template only
      cache.set("id|" + id, { at: Date.now(), data });
      return json(data);
    }
    const st = u.searchParams.get("stores");
    if (st != null) return json(st.trim().length >= 2 ? await stores(st.trim().slice(0, 60)) : []);
    const g = u.searchParams.get("geocode");
    if (g) return json(g.trim().length >= 2 ? await geocode(g.trim().slice(0, 100)) : null);
    const lat = num(u.searchParams.get("lat"), -90, 90), lng = num(u.searchParams.get("lng"), -180, 180);
    const km = num(u.searchParams.get("km"), 5, 400) ?? 100;
    const today = new Date().toISOString().slice(0, 10);
    const from = day(u.searchParams.get("from")) ?? today;
    const to = day(u.searchParams.get("to")) ?? new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
    const store = u.searchParams.get("store");
    if (store != null) {
      if (!/^\d{1,12}$/.test(store) || +store < 1) return json({ error: "bad store" }, 400);
      return json(await events({ store: +store }, from, to));
    }
    if (lat == null || lng == null) return json({ error: "lat and lng are required" }, 400);
    return json(await events({ lat, lng, km }, from, to));
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 200) }, 502);
  }
});
