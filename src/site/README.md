# Site sources

Everything the new site's pages are built from. Edit here, never the published `site/<page>/index.html`.

| Source | Published page |
| --- | --- |
| `feed/feed.template.html` | `site/feed/` — Início |
| `colecao/colecao.template.html` | `site/colecao/` — Coleção |
| `decks/decks.template.html` | `site/decks/` — Decks and the Consultor |
| `coach/coach.template.html` | `site/coach/` — Jogos (Coach Review) |
| `trades/trades.template.html` | `site/trades/` — Trocas, empréstimos e Mural |
| `counter/counter.template.html` | `site/counter/` — Lore Counter (offline) |
| `cloud.js` | sign-in and REST calls, inlined in every page above |
| `shell.js` | top bar, tab bar, account menu, sign-in sheet (all pages but the counter) |

Build all pages (also after a card catalog update, to refresh the embedded card index):

    python tools/build_site_pages.py

The release checks run `python tools/build_site_pages.py --check`, which fails when a published page
no longer matches its source. Browser tests for Decks: `tools/decks.spec.mjs`.
