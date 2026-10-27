#!/usr/bin/env python3
"""Build the new site's pages from the sources in src/site.

    python tools/build_site_pages.py            rebuild every page
    python tools/build_site_pages.py --check    fail if a published page differs from its sources
                                                (the embedded card index is left out of the comparison, so a
                                                catalog update alone never fails the check)

Each page template (src/site/<dir>/<dir>.template.html) holds the page's markup, styles and code.
Three markers are filled in at build time, so shared code lives in one place:
  /*@CLOUD_JS@*/    src/site/cloud.js   sign-in and REST calls (one session for the whole site)
  /*@SHELL_JS@*/    src/site/shell.js   top bar, tab bar, account menu, sign-in sheet
  /*@PICKER_JS@*/   src/site/cardpicker.js   showcase card picker (search, filters, finish, zoom)
  /*@AIPROMPT_JS@*/ src/site/aiprompt.js     Jogos: a game as a prompt for the player's own AI
  /*@CARD_INDEX@*/  compact card index from site/data/cards.json (re-run after a catalog update)
  /*@APP_STATIC:name@*/  a pure static method copied verbatim from the Inkwell app (site/index.html), so both give the same answer
The Decks page has its own builder (tools/build_site_decks.py), which this script also runs.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "site"
SITE = ROOT / "site"
SKIP_TYPES = {"Non-Playable Insert", "Quest Component"}

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_site_decks  # noqa: E402


def site_index(catalog: dict) -> dict:
    """Coleção and Trocas: [id, name, cost, type, ink, rarity, set, number, image] + set names."""
    cards = [[c["card_id"], c.get("name_en"), c.get("ink_cost"), c.get("card_type"), c.get("ink_color"),
              c.get("rarity"), c.get("set_code"), c.get("card_number"), c.get("image_file")]
             for c in catalog.get("cards", []) if c.get("card_type") not in SKIP_TYPES and c.get("card_id")]
    sets = [{"code": s.get("code"), "name_en": s.get("name_en"), "name_pt": s.get("name_pt")} for s in catalog.get("sets", []) if isinstance(s, dict)]
    return {"generated_at": catalog.get("generated_at"), "sets": sets, "cards": cards}


def coach_index(catalog: dict) -> dict:
    """Jogos (Coach Review): [id, name, cost, type, ink, lore, inkable, rarity], sorted by id."""
    rows = sorted(([c["card_id"], c["name_en"], c.get("ink_cost"), c.get("card_type"), c.get("ink_color"), c.get("lore"), c.get("inkable"), c.get("rarity")]
                   for c in catalog["cards"] if c.get("card_type") not in SKIP_TYPES and c.get("name_en")), key=lambda r: r[0])
    return {"generated_at": catalog.get("generated_at"), "cards": rows}


PAGES = {   # site dir -> card index it embeds
    "feed": site_index,   # the public home shows example profiles with card art
    "colecao": site_index,
    "trades": site_index,
    "coach": coach_index,
    "precos": site_index,
    "perfil": site_index,   # My Inkwell: profile editor and public profile
    "admin": None,
    "comunidades": site_index,
    "comecar": site_index,       # Começar meu Inkwell: guest profile editor (behind INKWELL_FLAGS.guestProfile)   # communities: stores, cities, interests
    "entrar": None,              # the sign-in e-mail link lands here and waits for a click (mail scanners)
    "privacidade": None,         # terms and privacy          # members, reports, example accounts (admins only)
    "eventos": None,   # Play Hub events near me + my community tables (rph-events edge function)
    "counter": None,   # the Lore Counter (offline app); its sw.js and manifest are plain files next to it
}


def without_index(html: str) -> str:
    return "\n".join("const CARD_INDEX = …" if line.startswith("const CARD_INDEX = ") else line for line in html.split("\n"))


def app_static(name: str) -> str:
    """`static name(...) { ... }` from the Inkwell app, returned as `function name(...) { ... }`."""
    app = (SITE / "index.html").read_text(encoding="utf-8")
    start = app.index(f"static {name}(")
    depth, j = 0, app.index("{", start)
    for j in range(j, len(app)):
        if app[j] == "{":
            depth += 1
        elif app[j] == "}":
            depth -= 1
            if depth == 0:
                break
    return "function " + app[start + len("static "):j + 1]


def render(name: str, catalog: dict) -> str:
    html = (SRC / name / f"{name}.template.html").read_text(encoding="utf-8")
    html = re.sub(r"/\*@APP_STATIC:(\w+)@\*/", lambda m: app_static(m.group(1)), html)
    html = html.replace("/*@CLOUD_JS@*/", (SRC / "cloud.js").read_text(encoding="utf-8"))
    html = html.replace("/*@SHELL_JS@*/", (SRC / "shell.js").read_text(encoding="utf-8"))
    html = html.replace("/*@PICKER_JS@*/", (SRC / "cardpicker.js").read_text(encoding="utf-8"))
    html = html.replace("/*@AIPROMPT_JS@*/", (SRC / "aiprompt.js").read_text(encoding="utf-8"))
    if PAGES[name]:
        html = html.replace("/*@CARD_INDEX@*/", json.dumps(PAGES[name](catalog), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
    for marker in ("/*@CLOUD_JS@*/", "/*@SHELL_JS@*/", "/*@PICKER_JS@*/", "/*@AIPROMPT_JS@*/", "/*@CARD_INDEX@*/"):
        if marker in html:
            raise SystemExit(f"{name}: marker {marker} left unfilled")
    return html


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="compare instead of writing")
    a = ap.parse_args()
    catalog = json.loads((SITE / "data" / "cards.json").read_text(encoding="utf-8-sig"))
    stale = []
    for name in PAGES:
        out = SITE / name / "index.html"
        html = render(name, catalog)
        if a.check:
            if not out.exists() or without_index(out.read_text(encoding="utf-8")) != without_index(html):
                stale.append(str(out.relative_to(ROOT)))
        else:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(html, encoding="utf-8")
            print(out.relative_to(ROOT))
    if a.check:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            built = build_site_decks.build(Path(tmp) / "decks.html")
            if without_index(built.read_text(encoding="utf-8")) != without_index((SITE / "decks" / "index.html").read_text(encoding="utf-8")):
                stale.append("site/decks/index.html")
        if stale:
            print("Out of date (run python tools/build_site_pages.py):\n  " + "\n  ".join(stale))
            return 1
        print(f"{len(PAGES) + 1} pages match their sources")
        return 0
    print(build_site_decks.build().relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
