// Reading every page of a Play Hub event search, for rph-events. Plain JS so the Node tests
// (tools/eventos-paginate.test.mjs) run it against fake and recorded pages.
//
// What we know (05/11/2026, tools/fixtures/rph-events-pagination-2026-11-05.json):
// - page_size is capped at 250 by the API, whatever is asked;
// - results are ordered by start time, and events that start at the same minute have no fixed order between
//   pages, so an offset page can repeat an event from the previous page and skip another one. With page_size=100
//   #968324 came twice and #1188577 never came (count 428, 427 distinct); 250 and 200 got all 428; 50 lost another.
// So: ask for the largest page, keep each id once, and when fewer distinct events than `count` came, read the
// list once more with another page size (other boundaries) and add what was missing. Whatever is still short is
// reported, never hidden: { complete: false, issues: [...] }.
//
// fetchPage(page, size) -> the API's JSON ({ count, results, next_page_number }) or throws.

export const PAGE_SIZE = 250, RETRY_SIZE = 200;
export const MAX_EVENTS = 5000;          // safety cap: 20 pages of 250 (São Paulo at 400 miles had 428)
export const TIME_BUDGET_MS = 25000;     // the whole read, retry pass included

export async function fetchAll(fetchPage, { pageSize = PAGE_SIZE, retrySize = RETRY_SIZE, maxEvents = MAX_EVENTS, budgetMs = TIME_BUDGET_MS, now = Date.now } = {}) {
  const t0 = now(), byId = new Map(), issues = [];
  let count = null, repeated = 0;

  async function pass(size, first) {
    const maxPages = Math.ceil(maxEvents / size);
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1 && now() - t0 > budgetMs) { issues.push({ kind: "time_budget", page, size }); return false; }
      let d;
      try { d = await fetchPage(page, size); }
      catch (e) {
        if (first && page === 1) throw e;   // nothing to show: the caller answers 502, as before
        issues.push({ kind: "error", page, size, error: String(e?.message || e).slice(0, 120) });
        return false;
      }
      if (count == null && Number.isFinite(+(d?.count ?? d?.total))) count = +(d.count ?? d.total);
      const results = Array.isArray(d?.results) ? d.results : [];
      for (const e of results) { if (e?.id == null) continue; if (byId.has(e.id)) { if (first) repeated++; } else byId.set(e.id, e); }
      if (!d?.next_page_number || !results.length) return true;
      if (page === maxPages) { issues.push({ kind: "page_cap", pages: maxPages, size, max_events: maxEvents }); return false; }
    }
    return true;
  }

  let done = await pass(pageSize, true);
  const firstPass = byId.size;
  // short on events and the first read finished: one more read with other page boundaries
  if (done && count != null && byId.size < count && byId.size < maxEvents) {
    const before = byId.size;
    done = await pass(retrySize, false);
    issues.push({ kind: "retry", size: retrySize, recovered: byId.size - before });
  }
  const events = [...byId.values()];
  const missing = count != null ? Math.max(0, count - events.length) : 0;
  if (missing) issues.push({ kind: "missing", count, received: events.length, missing });
  if (repeated) issues.push({ kind: "repeated", repeated });
  // complete = every event the API counted came (repeats alone don't make it incomplete: they were removed;
  // an error in the retry pass doesn't either, if nothing is missing). Without a count, any stop is incomplete.
  const complete = count != null ? missing === 0 : !issues.some((i) => ["error", "page_cap", "time_budget"].includes(i.kind));
  return { events, count: count ?? events.length, received: events.length, first_pass: firstPass, complete, issues };
}
