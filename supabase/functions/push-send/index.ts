// push-send: sends one Inkwell notice to the devices where its person turned push on.
// Called by the notifications_push trigger (supabase/push.sql) with { id } and the x-push-key header.
// It reads what to send through push_payload(id, key) — the key lives in the vault — and drops devices
// the push service says are gone (404/410).
// VAPID: the public key is below and in src/site/shell.js; the private one comes from the vault with the payload.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;   // these RPCs are granted to service_role only (hardening.sql)
const SITE = "https://luiscredie.github.io/inkwell/";
const VAPID_PUBLIC = "BLvoLCTQgS3n-1MGGoQXBZ3OO50n_-mWuhLqRbWFVK38DvLNVEK3IOO_CCSMxDkq2AoRCiInC9R4mrEM23pWQdk";

type Json = Record<string, any>;
const rpc = async (name: string, body: Json) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return r.status === 204 ? null : r.json();
};

const SAYS: Record<string, string> = {
  like: "curtiu seu post", comment: "comentou no seu post", rsvp: "vai na sua mesa", event: "marcou uma mesa",
  community_invite: "convidou você para uma comunidade", join_request: "pediu para entrar na comunidade", join_accepted: "aceitou seu pedido",
  share_accepted: "aceitou dividir a sua coleção", loan_request: "pediu cartas emprestadas", loan_offer: "quer emprestar cartas para você",
};
function message(p: Json) {
  const ref = p.ref || {}, text = p.text ? String(p.text).slice(0, 120) : "";
  let url = SITE + "feed/";
  if (ref.post) url = `${SITE}feed/#post-${encodeURIComponent(ref.post)}`;
  else if (ref.rph || /^event_near/.test(p.kind)) url = `${SITE}eventos/`;
  else if (/^loan_/.test(p.kind)) url = `${SITE}trades/`;
  else if (p.kind === "share_accepted") url = `${SITE}colecao/`;
  else if (ref.slug) url = `${SITE}comunidades/?c=${encodeURIComponent(ref.slug)}${["event", "rsvp", "event_soon"].includes(p.kind) ? "#mesas" : ""}`;
  if (p.kind === "event_near") return { title: "Evento novo perto de você", body: [text, ref.store, ref.at ? new Date(ref.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""].filter(Boolean).join(" · "), url: SITE + "eventos/" };
  if (p.kind === "event_near_many") return { title: "Eventos novos perto de você", body: `${ref.n || "Vários"} eventos novos${text ? ` perto de ${text}` : ""} no Play Hub.`, url: SITE + "eventos/" };
  if (p.kind === "event_soon") return { title: "Lembrete de evento", body: text ? `${text} é amanhã ou hoje.` : "Seu evento está chegando.", url };
  const who = p.actor || "Alguém";
  return { title: "Inkwell", body: `${who} ${SAYS[p.kind] || "mandou um aviso"}${text ? `: ${text}` : ""}`, url };
}

Deno.serve(async (req) => {
  if (req.method === "GET" && new URL(req.url).searchParams.has("selftest")) {   // encryption works here? (no sending, no data)
    try {
      const { createECDH, randomBytes } = await import("node:crypto");
      const ec = createECDH("prime256v1"); ec.generateKeys();
      const fake = webpush.generateVAPIDKeys();
      const d = webpush.generateRequestDetails({ endpoint: "https://push.example.invalid/x", keys: { p256dh: ec.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } }, "{}", { vapidDetails: { subject: SITE, publicKey: fake.publicKey, privateKey: fake.privateKey } });
      return Response.json({ ok: true, bytes: d.body?.length || 0 });
    } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 }); }
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const key = req.headers.get("x-push-key") || "";
  let id = "";
  try { id = String((await req.json())?.id || ""); } catch { /* */ }
  if (!/^[0-9a-f-]{36}$/i.test(id) || !key) return new Response("bad request", { status: 400 });
  let p: Json | null;
  try { p = await rpc("push_payload", { p_id: id, p_key: key }); } catch (e) { return new Response(String((e as Error).message), { status: 403 }); }
  if (!p || !(p.subs || []).length) return Response.json({ sent: 0 });
  if (!p.vapid || /HERE/.test(p.vapid)) return new Response("no vapid key", { status: 500 });
  webpush.setVapidDetails(SITE, VAPID_PUBLIC, p.vapid);
  const m = message(p);
  const payload = JSON.stringify({ ...m, tag: `iw-${id}`, badge: Number(p.unread) || 0 });
  let sent = 0, gone = 0;
  await Promise.all(p.subs.map(async (s: Json) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      const code = (e as Json)?.statusCode;
      if (code === 404 || code === 410) { gone++; await rpc("push_gone", { p_endpoint: s.endpoint, p_key: key }).catch(() => {}); }
      else console.error("push failed", code, String((e as Error)?.message || e).slice(0, 200));
    }
  }));
  return Response.json({ sent, gone });
});
