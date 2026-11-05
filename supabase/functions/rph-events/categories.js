// Event categories for the Eventos page, from the Play Hub's event_configuration_template (a template id on each event).
// Plain JS so rph-events (Deno) and the Node tests (tools/eventos-categories.test.mjs) share it.
//
// Sources, in order:
//   "api"      - the template's name from GET /event-configuration-templates/?game_slug=disney-lorcana
//   "observed" - OBSERVED below: ids that endpoint does not list, mapped by hand. NOT confirmed by Ravensburger.
//   "unknown"  - anything else, and any observed id whose consistency check fails. Shown under "Outros".
// event_type is not used: on 05/11/2026 all 428 upcoming events near São Paulo came as "LOCALS".
// Nothing here guesses a category from an event's own name; names are only used to check OBSERVED.

export const CATEGORIES = ["prerelease", "set_championship", "weekly", "celebration", "other"];

// a template NAME returned by the API -> category (Weekly Play (Constructed/Draft/Sealed) are all "weekly")
const BY_TEMPLATE_NAME = [
  [/\bweekly play\b/i, "weekly"],
  [/\bpre-?release\b/i, "prerelease"],
  [/\bset championship\b/i, "set_championship"],
  [/\bworld championship celebration\b/i, "celebration"],
];

// Observed on 05/11/2026: GET /events/?game_slug=disney-lorcana&latitude=-23.55&longitude=-46.63&num_miles=400
// &page_size=100&display_statuses=upcoming (all 5 pages, 428 events). None of these ids is in
// /event-configuration-templates/, and GET /event-configuration-templates/<id>/ answers 401 for every id
// (listed ones too), so the route needs a sign-in. Evidence: every event under the id, its gameplay format and
// its single phase_template_group (counts below). Re-check when a new set launches: launch templates change.
export const OBSERVED = {
  "b6f02bc3-b546-4672-94e3-d1e7d5d075a3": { category: "set_championship", events: 25, evidence: "24 named '… Set Championship' (Hyperia City), 1 named 'liga' (#1007371); all Core Constructed" },
  "e476de35-1806-4a10-9b7b-876a26ebb93a": { category: "prerelease", events: 22, evidence: "'Into the Inkdark Prerelease (Sealed)' and variants, 1 'Evento de Lançamento de Into the Inkdark!'; all Sealed" },
  "6f672fc7-21cd-4b60-85a5-db97e1bfb3bf": { category: "prerelease", events: 8, evidence: "'Into the Inkdark Prerelease (Pack Rush)'; all Pack Rush" },
  "823bdeec-b59e-47b0-87d7-be6fe7c2f55c": { category: "celebration", events: 15, evidence: "'World Championship Celebration: Infinity'; all Infinity Constructed" },
};
export const OBSERVED_AT = "2026-11-05";

// Consistency check for OBSERVED ids: an event name is incompatible when it names ANOTHER category
// (e.g. "liga" or "Weekly Play" under a Set Championship id). Names that name no category pass.
const NAMES = {
  prerelease: /pr[eé][\s-]?release|lan[cç]amento/i,
  set_championship: /set championship/i,
  weekly: /weekly play|\bliga\b/i,
  celebration: /championship celebration/i,
};
const namesOther = (name, category) => Object.entries(NAMES).some(([c, re]) => c !== category && re.test(name) && !NAMES[category].test(name));

// templates: { id: name } from the API. events: raw Play Hub events.
// Returns { suspended: Map(id -> divergence), divergences: [...] } for the observed ids seen in these events.
export function checkObserved(events) {
  const suspended = new Map();
  for (const e of events) {
    const id = e?.event_configuration_template, o = id && OBSERVED[id];
    if (!o || !namesOther(String(e.name || ""), o.category)) continue;
    const d = suspended.get(id) || { template_id: id, category: o.category, mismatched: [] };
    d.mismatched.push({ id: e.id, name: e.name });
    suspended.set(id, d);
  }
  return { suspended, divergences: [...suspended.values()] };
}

export function classify(templateId, templates = {}, suspended = new Map()) {
  const name = templateId && templates[templateId] ? String(templates[templateId]) : null;
  if (name) {
    const hit = BY_TEMPLATE_NAME.find(([re]) => re.test(name));
    return { template_id: templateId, template_name: name, category: hit ? hit[1] : "other", category_source: "api" };
  }
  const o = templateId && OBSERVED[templateId];
  if (o && !suspended.has(templateId)) return { template_id: templateId, template_name: null, category: o.category, category_source: "observed" };
  return { template_id: templateId || null, template_name: null, category: "other", category_source: "unknown" };
}
