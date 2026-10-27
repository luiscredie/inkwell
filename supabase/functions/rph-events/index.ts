// rph-events: Disney Lorcana events near a place, from the Ravensburger Play Hub (tcg.ravensburgerplay.com),
// for the Eventos page. Public data, no key (the same API the Play Hub site uses); cached here for 15 minutes.
//   GET ?lat=-23.55&lng=-46.63&km=100&from=2026-10-27&to=2027-01-31   -> { events: [...], total }
//   GET ?geocode=Campinas                                               -> { lat, lng, label } (Open-Meteo geocoder)
//   GET ?id=904881                                                      -> one event (to link a community table)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const API = "https://api.cloudflare.ravensburgerplay.com/hydraproxy/api/v2";
const HEADERS = { "Content-Type": "application/json", Referer: "https://tcg.ravensburgerplay.com/" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 15 * 60 * 1000;
type Json = Record<string, any>;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
const num = (v: string | null, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function slim(e: Json) {
  const s = e.store || {};
  return {
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

async function events(lat: number, lng: number, km: number, from: string, to: string) {
  const key = [lat.toFixed(2), lng.toFixed(2), km, from, to].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const out: Json[] = [];
  let total = 0;
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ game_slug: "disney-lorcana", latitude: String(lat), longitude: String(lng), num_miles: String(Math.round(km / 1.609)),
      page: String(page), page_size: "100", start_date_after: `${from}T00:00:00Z`, start_date_before: `${to}T23:59:59Z` });
    q.append("display_statuses", "upcoming"); q.append("display_statuses", "inProgress");
    const r = await fetch(`${API}/events/?${q}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`play hub ${r.status}`);
    const d = await r.json();
    total = d.count ?? d.total ?? 0;
    out.push(...(d.results || []).map(slim));
    if (!d.next_page_number) break;
  }
  const data = { events: out.sort((a, b) => String(a.start).localeCompare(String(b.start))), total };
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function geocode(q: string) {   // city names, via Open-Meteo's free geocoder (no key)
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=pt&format=json`);
  if (!r.ok) throw new Error(`geocode ${r.status}`);
  const d = (await r.json())?.results?.[0];
  return d ? { lat: +d.latitude, lng: +d.longitude, label: [d.name, d.admin1, d.country_code].filter(Boolean).join(", ") } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
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
      const data = slim(e);
      cache.set("id|" + id, { at: Date.now(), data });
      return json(data);
    }
    const g = u.searchParams.get("geocode");
    if (g) return json(g.trim().length >= 2 ? await geocode(g.trim().slice(0, 100)) : null);
    const lat = num(u.searchParams.get("lat"), -90, 90), lng = num(u.searchParams.get("lng"), -180, 180);
    const km = num(u.searchParams.get("km"), 5, 400) ?? 100;
    const today = new Date().toISOString().slice(0, 10);
    const from = day(u.searchParams.get("from")) ?? today;
    const to = day(u.searchParams.get("to")) ?? new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
    if (lat == null || lng == null) return json({ error: "lat and lng are required" }, 400);
    return json(await events(lat, lng, km, from, to));
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 200) }, 502);
  }
});
