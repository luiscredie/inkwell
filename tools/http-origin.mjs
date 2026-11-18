// Who answered an HTTP request to the published site, for tests that run against production.
//
// Seen on 18/11/2026 (docs/ocorrencias-503.md): inkwell.com.br is GitHub Pages behind Fastly. Real pages answered 200
// every time, even when the cache had to fetch them again. An address that does not exist sometimes gets, on its first
// fetch, a 503 from the Fastly edge itself (server: Varnish, no x-github-request-id); the next fetch gets GitHub's 404.
//
// expectNotFound() accepts only a 404. For that edge 503 alone it records the answer and asks again, at most twice
// more (after 2 s and 4 s; seen twice in a row on 18/11): any other status, a 503 from GitHub itself, or a third edge
// 503 fails the test. Nothing else is retried.
import { appendFileSync } from 'node:fs';

export function originOf(res) {
  const h = typeof res.headers === 'function' ? res.headers() : res.headers || {};
  return {
    status: typeof res.status === 'function' ? res.status() : res.status,
    server: h['server'] || null,
    github: !!h['x-github-request-id'],
    served_by: h['x-served-by'] || null,
    cache: h['x-cache'] || null,
    fastly_id: h['x-fastly-request-id'] || null,
  };
}
export const fromEdgeOnly = (o) => o.status === 503 && !o.github && /varnish/i.test(o.server || '');
export const describe = (o) => `${o.status} from ${o.github ? 'GitHub' : o.server || 'unknown'}${o.served_by ? ` (${o.served_by}, cache ${o.cache})` : ''}`;

// One line per 5xx seen, in .http-5xx.jsonl at the repo root (git-ignored; test-results/ is wiped on every run), so
// occurrences can be counted over time. HTTP_5XX_LOG changes the file.
export function record(url, o) {
  if (o.status < 500) return;
  try {
    appendFileSync(process.env.HTTP_5XX_LOG || '.http-5xx.jsonl', JSON.stringify({ at: new Date().toISOString(), url, ...o }) + '\n');
  } catch { /* recording must never fail a test */ }
}

export async function expectNotFound(request, url) {
  let o = originOf(await request.get(url));
  record(url, o);
  for (const wait of [2000, 4000]) {
    if (!fromEdgeOnly(o)) break;
    await new Promise((r) => setTimeout(r, wait));
    o = originOf(await request.get(url));
    record(url, o);
  }
  return o;   // the caller checks o.status === 404 and o.github, with describe(o) in the message
}
