// events-near: once a day (cron in supabase/event_places.sql), looks for Play Hub events near the places people
// saved in their account, and hands each person's list to near_events(), which keeps what is new and writes
// the notices (push goes out through the notifications trigger). Called with the x-push-key header.
// People close to each other share one Play Hub search (~11 km cells), so the API is called once per area.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const API = "https://api.cloudflare.ravensburgerplay.com/hydraproxy/api/v2";
const HEADERS = { "Content-Type": "application/json", Referer: "https://tcg.ravensburgerplay.com/" };
type Json = Record<string, any>;

const rpc = async (name: string, body: Json) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name} ${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
};
const km = (a: number, b: number, c: number, d: number) => {   // haversine
  const R = 6371, x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function search(lat: number, lng: number, radiusKm: number) {
  const out: Json[] = [];
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ game_slug: "disney-lorcana", latitude: String(lat), longitude: String(lng), num_miles: String(Math.ceil(radiusKm / 1.609)),
      page: String(page), page_size: "100", start_date_after: `${from}T00:00:00Z`, start_date_before: `${to}T23:59:59Z` });
    q.append("display_statuses", "upcoming");
    const r = await fetch(`${API}/events/?${q}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`play hub ${r.status}`);
    const d = await r.json();
    for (const e of d.results || []) {
      const la = e.latitude ?? e.store?.latitude, lo = e.longitude ?? e.store?.longitude;
      if (e.event_is_online || la == null || lo == null) continue;
      out.push({ id: e.id, name: String(e.name || "").slice(0, 120), start: e.start_datetime, store: e.store?.name ? String(e.store.name).slice(0, 80) : null, lat: +la, lng: +lo });
    }
    if (!d.next_page_number) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const key = req.headers.get("x-push-key") || "";
  if (!key) return new Response("no key", { status: 401 });
  let places: Json[];
  try { places = await rpc("near_places", { p_key: key }); } catch (e) { return new Response(String((e as Error).message), { status: 403 }); }
  // one search per ~11 km cell, wide enough for everyone in it
  const cells = new Map<string, { lat: number; lng: number; r: number; people: Json[] }>();
  for (const p of places) {
    const lat = +p.lat, lng = +p.lng, k = `${lat.toFixed(1)}|${lng.toFixed(1)}`;
    const c = cells.get(k) || { lat: +lat.toFixed(1), lng: +lng.toFixed(1), r: 0, people: [] };
    c.r = Math.max(c.r, +p.km + 12); c.people.push(p); cells.set(k, c);
  }
  const report = { places: places.length, searches: 0, notified: 0, errors: 0 };
  for (const c of cells.values()) {
    let evs: Json[];
    try { evs = await search(c.lat, c.lng, Math.min(c.r, 320)); report.searches++; } catch (e) { report.errors++; console.error(String((e as Error).message)); continue; }
    for (const p of c.people) {
      const mine = evs.filter((e) => km(+p.lat, +p.lng, e.lat, e.lng) <= +p.km).map(({ id, name, start, store }) => ({ id, name, start, store }));
      try { report.notified += await rpc("near_events", { p_key: key, p_user: p.user, p_events: mine }); } catch (e) { report.errors++; console.error(String((e as Error).message)); }
    }
  }
  return Response.json(report);
});
