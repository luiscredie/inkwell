# 503 errors on inkwell.com.br: occurrences and origin

How tests against production record them: `tools/http-origin.mjs` writes one line per 5xx to `.http-5xx.jsonl`
(git-ignored), with status, `server`, whether GitHub answered (`x-github-request-id`), the Fastly node
(`x-served-by`) and the cache state. The smoke and sweep failure messages say who answered.

## Occurrences

| When (UTC) | Address | Answer | Notes |
|---|---|---|---|
| 17/11, after the #246 deploy | a smoke check (old files must be 404) | 503 | headers not recorded; passed when run again |
| 17/11, after the #245 deploy | `push/` (sweep) and one smoke check | 503, then 404 | headers not recorded |
| 18/11 02:4x | `push/` | **503, `server: Varnish`, no GitHub id**, `cache-iad-*`, MISS | next 3 requests: GitHub 404 |
| 18/11 02:4x | `push/index.html`, `users/luis.json` | 503 Varnish (1×, 2× in a row), then GitHub 404 | |
| 18/11 02:4x | a random address that does not exist | 503 Varnish on the first request, then 404 ×5 | |
| 18/11 02:53 | `sim/game.js` (smoke) | 503 Varnish twice in a row (`cache-chi-*`), then GitHub 404 ×8 | |

Control, 18/11: `feed/`, `colecao/` and `data/prices.json` with a cache-busting query (forcing a MISS): **18 of 18
answered 200** from GitHub.

## What the evidence supports
- The 503s seen come from the **Fastly edge in front of GitHub Pages** (`server: Varnish`, no `x-github-request-id`),
  not from GitHub's servers and not from the site's code.
- So far they happened only on **addresses that do not exist** (where GitHub's answer is 404), on the first requests
  after a cache miss, on more than one Fastly node (IAD, CHI), and also when no deploy was running.
- No 503 seen on a real page. That is a small sample: it does not prove players never get one.

## Not known yet
- Whether real pages ever get it (more samples needed, including from Brazil: the nodes seen are in the US because
  that is where the tests run).
- Why the edge answers 503 instead of passing GitHub's 404 on.

## Tests
- `smoke`: "old files are not published" accepts only a 404. For that edge 503 alone it asks again at most twice more
  (after 2 s and 4 s), recording each answer. A 503 from GitHub, any other status, or a third edge 503 fails.
- `sweep`: each swept address must answer 200; the message says who answered. `push/` is not swept (see the spec).
