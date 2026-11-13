"""Gera site/dlc-londres/index.html com os standings oficiais do Play Hub (DLC London: Main Event 1).

Uso:  python tools/dlc-londres/build.py
Busca o evento, os standings de cada rodada concluída e as partidas (para as tintas do deck),
casa os jogadores pelo username do Play Hub e grava os dados dentro da página (página estática).
"""
import json, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.cloudflare.ravensburgerplay.com/hydraproxy/api/v2"
EVENT = 1254364
HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "site" / "dlc-londres" / "index.html"

# (equipe, nome exibido, username no Play Hub)
PLAYERS = [
    ("TZ", "Caique Barral", "Caique Barral"), ("NekoDan", "Sor Alan", "[NekoDan] Sor Alan"),
    ("pimp", "Vitor Fasanaro", "| pimp | Vitor Fasanaro"), ("RL", "Inglês", "[RL] Inglês"),
    ("TZ", "Carioca", "[TZ] Carioca"), ("pimp", "Carolinne", "| pimp | Carolinne"),
    ("INKRJ", "Coelho", "[INKRJ] Coelho"), ("RL", "Daniel Kabra da Peste", "[RL] Daniel Kabra da Peste"),
    ("BR", "Gaybol", "Gaybol"), ("pimp", "Ivan Silva", "| pimp | Ivan Silva"),
    ("INKRJ", "Joao Geleia", "[INKRJ] Joao Geleia"), ("TZ", "Lari Rosa", "[TZ] Lari Rosa"),
    ("INKRJ", "Leo Dantas", "[INKRJ] Leo Dantas"), ("NekoDan", "LorKá", "[NekoDan] LorKá"),
    ("TZ", "Maju Souza", "[TZ] Maju Souza"), ("INKRJ", "Matheus Pessoa", "[INKRJ] Matheus Pessoa"),
    ("TZ", "Meneghesso", "[TZ] Meneghesso"), ("TZ", "Renan Reis", "[TZ] Renan Reis"),
    ("pimp", "Rômulo Rocha", "| pimp | Rômulo Rocha"), ("TZ", "Rufino", "[TZ]Rufino"),
    ("pimp", "Lucas Paglia", "| pimp | Lucas Paglia"), ("pimp", "Caio Giovanni", "| pimp | Caio Giovanni"),
    ("TZ", "Gab Soares", "[TZ] Gab Soares"),
]


def get(path):
    req = urllib.request.Request(f"{API}/{path}", headers={"Referer": "https://tcg.ravensburgerplay.com/", "User-Agent": "Inkwell"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def pages(path):
    out, page = [], 1
    while True:
        d = get(f"{path}?page={page}&page_size=1000")
        out += d["results"]
        if not d.get("next"):
            return out
        page += 1


def main():
    ev = get(f"events/{EVENT}/")
    rounds = [r for ph in ev["tournament_phases"][:1] for r in ph["rounds"]]
    done = [r for r in rounds if r["status"] == "COMPLETE"]
    live = next((r["round_number"] for r in rounds if r["status"] == "IN_PROGRESS"), None)
    names = {u for _, _, u in PLAYERS}
    standings, inks = {}, {u: set() for u in names}
    for r in done:
        rows = pages(f"tournament-rounds/{r['id']}/standings/paginated/")
        assert all(x["round_number"] == r["round_number"] for x in rows)
        standings[r["round_number"]] = {x["user_event_status"]["best_identifier"]: x for x in rows}
    for r in [x for x in rounds if x["status"] in ("COMPLETE", "IN_PROGRESS")]:
        for m in pages(f"tournament-rounds/{r['id']}/matches/paginated/"):
            for pm in m["player_match_relationships"]:
                s = pm["user_event_status"]
                if s["best_identifier"] in names:
                    lab = s.get("deck_descriptor_label") or {}
                    keys = tuple(sym["symbol_key"] for p in lab.get("parts", []) for sym in p.get("symbols", []))
                    if keys:
                        inks[s["best_identifier"]].add(keys)
    last = max(standings)
    players, missing = [], []
    for team, name, user in PLAYERS:
        if user not in standings[last]:
            missing.append(name)
            continue
        x = standings[last][user]
        deck = inks[user]
        players.append(dict(
            team=team, name=name, username=user, legal=x["player"]["best_identifier"], pid=x["player"]["id"],
            rounds={k: dict(rank=v[user]["rank"], rec=v[user]["match_record"], pts=v[user]["match_points"]) for k, v in standings.items() if user in v},
            status=x["user_event_status"]["registration_status"],
            inks=list(next(iter(deck))) if len(deck) == 1 else None,
        ))
    if missing:
        sys.exit(f"não localizados: {missing}")
    data = dict(fetched_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), last_round=last, live_round=live,
                total=ev.get("starting_player_count") or len(standings[last]), players=players)
    html = (HERE / "template.html").read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"R{last} concluída, R{live} em andamento · {len(players)} jogadores · {OUT}")


if __name__ == "__main__":
    main()
