// Event categories for the Eventos page, from the Play Hub's event_configuration_template (a template id on each event).
// Plain JS so rph-events (Deno) and the Node tests (tools/eventos-categories.test.mjs) share it.
//
// The category depends ONLY on the template id (and the templates list), never on the event's own name, so the same
// event gets the same category in every page, every location search and the single-event lookup.
// Sources, in order:
//   "api"      - the template's name from GET /event-configuration-templates/?game_slug=disney-lorcana
//   "observed" - OBSERVED below: ids that endpoint does not list, mapped by hand. NOT confirmed by Ravensburger.
//   "unknown"  - anything else (and an observed id a person set to status "suspended"). Shown under "Outros".
// event_type is not used: on 05/11/2026 all 428 upcoming events near São Paulo came as "LOCALS".
//
// Event names are only a check on OBSERVED: a name that names another category is flagged for investigation
// (the store may have typed it wrong). It never changes the category. reviewObserved() weighs the flags
// (proportion, number of stores) and says when a person should look at the id; suspending one is a code change.

export const CATEGORIES = ["prerelease", "set_championship", "weekly", "celebration", "other"];

// a template NAME returned by the API -> category (Weekly Play (Constructed/Draft/Sealed) are all "weekly")
const BY_TEMPLATE_NAME = [
  [/\bweekly play\b/i, "weekly"],
  [/\bpre-?release\b/i, "prerelease"],
  [/\bset championship\b/i, "set_championship"],
  [/\bworld championship celebration\b/i, "celebration"],
];

// Observed on 05/11/2026: GET /events/?game_slug=disney-lorcana&latitude=-23.55&longitude=-46.63&num_miles=400
// &page_size=100&display_statuses=upcoming (5 pages, 428 events; tools/fixtures/rph-events-2026-11-05.json).
// None of these ids is in /event-configuration-templates/, and GET /event-configuration-templates/<id>/ answers
// 401 for every id (listed ones too): that route needs a sign-in. Evidence: the events under each id, their stores,
// gameplay format and phase_template_group. Re-check when a new set launches: launch templates change.
export const OBSERVED = {
  "b6f02bc3-b546-4672-94e3-d1e7d5d075a3": { category: "set_championship", status: "active", events: 25, stores: 23,
    evidence: "24 named '… Set Championship' (Hyperia City); 1 named 'liga' (#1007371, Garbosa TCG), kept as Set Championship and flagged; all Core Constructed, one phase_template_group" },
  "e476de35-1806-4a10-9b7b-876a26ebb93a": { category: "prerelease", status: "active", events: 22,
    evidence: "'Into the Inkdark Prerelease (Sealed)' and variants, 1 'Evento de Lançamento de Into the Inkdark!'; all Sealed" },
  "6f672fc7-21cd-4b60-85a5-db97e1bfb3bf": { category: "prerelease", status: "active", events: 8,
    evidence: "'Into the Inkdark Prerelease (Pack Rush)'; all Pack Rush" },
  "823bdeec-b59e-47b0-87d7-be6fe7c2f55c": { category: "celebration", status: "active", events: 15,
    evidence: "'World Championship Celebration: Infinity'; all Infinity Constructed" },
};
export const OBSERVED_AT = "2026-11-05";

// what an event name may say about its category (for the check only)
const NAMES = {
  prerelease: /pr[eé][\s-]?release|lan[cç]amento/i,
  set_championship: /set championship/i,
  weekly: /weekly play|\bliga\b/i,
  celebration: /championship celebration/i,
};
const named = (name) => Object.keys(NAMES).filter((c) => NAMES[c].test(name));
// incompatible = the name names another category and not this one ("liga" under Set Championship). Names that name
// nothing ("Torneio da Forja") are neutral.
export function nameDivergent(name, category) {
  const n = named(String(name || ""));
  return n.length > 0 && !n.includes(category);
}

export function classify(templateId, templates = {}) {
  const name = templateId && templates[templateId] ? String(templates[templateId]) : null;
  if (name) {
    const hit = BY_TEMPLATE_NAME.find(([re]) => re.test(name));
    return { template_id: templateId, template_name: name, category: hit ? hit[1] : "other", category_source: "api" };
  }
  const o = templateId && OBSERVED[templateId];
  if (o && o.status !== "suspended") return { template_id: templateId, template_name: null, category: o.category, category_source: "observed" };
  return { template_id: templateId || null, template_name: null, category: "other", category_source: "unknown" };
}

// One event as the page gets it: its category plus, for an observed id, a flag when its name disagrees.
export function categorize(e, templates = {}) {
  const c = classify(e?.event_configuration_template, templates);
  return c.category_source === "observed" && nameDivergent(e?.name, c.category) ? { ...c, name_divergence: true } : c;
}

// For the log: per observed id with flagged names, how strong the disagreement is. needs_review only when it is
// spread (2+ stores) AND makes up at least half of the names that say a category; the category is never changed here.
export function reviewObserved(events, templates = {}) {
  const by = new Map();
  for (const e of events) {
    const c = classify(e?.event_configuration_template, templates);
    if (c.category_source !== "observed") continue;
    const r = by.get(c.template_id) || { template_id: c.template_id, category: c.category, events: 0, stores: new Set(), informative: 0, divergent: [], divergent_stores: new Set() };
    r.events++; r.stores.add(e.store?.id ?? e.store?.name ?? "?");
    if (named(String(e.name || "")).length) r.informative++;
    if (nameDivergent(e.name, c.category)) { r.divergent.push({ id: e.id, name: e.name, store: e.store?.name || null }); r.divergent_stores.add(e.store?.id ?? e.store?.name ?? "?"); }
    by.set(c.template_id, r);
  }
  return [...by.values()].filter((r) => r.divergent.length).map((r) => {
    const share = r.informative ? r.divergent.length / r.informative : 0;
    return { template_id: r.template_id, category: r.category, events: r.events, stores: r.stores.size, divergent: r.divergent,
      divergent_stores: r.divergent_stores.size, share: Math.round(share * 100) / 100, needs_review: r.divergent_stores.size >= 2 && share >= 0.5 };
  });
}
