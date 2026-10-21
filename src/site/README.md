# Site sources

Sources for the new site pages that live under `site/`.

| File | Used by |
| --- | --- |
| `cloud.js` | sign-in and REST calls to Supabase (one session for the whole site) |
| `shell.js` | top bar, tab bar, account menu and the sign-in sheet |
| `decks/decks.template.html` | `/decks/` — build with `python tools/build_site_decks.py` |

`cloud.js` and `shell.js` are the same code that is inlined in `site/feed/`, `site/colecao/`, `site/trades/` and `site/coach/`.
Those four pages were built from sources kept outside this repo; when one of them changes, edit the built page and keep
these two files in step.
