"""Gera site/dlc-londres/index.html com os standings oficiais do Play Hub (DLC London: Main Event 1).

Uso:  python tools/dlc-londres/build.py              (regera a página com os dados embutidos)
      python tools/dlc-londres/build.py --json X.json  (só os dados: usado pela Action a cada 5 min)
Busca o evento, os standings de cada rodada concluída e as partidas (para as tintas do deck),
casa os jogadores pelo username do Play Hub e grava os dados dentro da página (página estática).
"""
import json, sys, time, urllib.request
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
    ("TZ", "Gab Soares", "[TZ] Gab Soares"), ("TZ", "Vanessa Barral", "Vanessa Barral"),
]


def get(path, tries=4):
    req = urllib.request.Request(f"{API}/{path}", headers={"Referer": "https://tcg.ravensburgerplay.com/", "User-Agent": "Inkwell"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception:  # resposta cortada, timeout ou erro do servidor: tenta de novo
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def pages(path):
    out, page = [], 1
    while True:
        d = get(f"{path}?page={page}&page_size=1000")
        out += d["results"]
        if not d.get("next"):
            return out
        page += 1


def inks_of(status):
    lab = status.get("deck_descriptor_label") or {}
    return tuple(sym["symbol_key"] for p in lab.get("parts", []) for sym in p.get("symbols", []))


def collect():
    ev = get(f"events/{EVENT}/")
    rounds = [r for ph in ev["tournament_phases"][:1] for r in ph["rounds"]]
    done = [r for r in rounds if r["status"] == "COMPLETE"]
    live_r = next((r for r in rounds if r["status"] == "IN_PROGRESS"), None)
    names = {u for _, _, u in PLAYERS}
    standings, inks, live, hist = {}, {u: set() for u in names}, {}, {u: {} for u in names}
    for r in done:
        rows = pages(f"tournament-rounds/{r['id']}/standings/paginated/")
        assert all(x["round_number"] == r["round_number"] for x in rows)
        standings[r["round_number"]] = {x["user_event_status"]["best_identifier"]: x for x in rows}
    last = max(standings)
    for r in [x for x in rounds if x["status"] in ("COMPLETE", "IN_PROGRESS")]:
        for m in pages(f"tournament-rounds/{r['id']}/matches/paginated/"):
            rel = m["player_match_relationships"]
            for pm in rel:
                s = pm["user_event_status"]
                u = s["best_identifier"]
                if u not in names:
                    continue
                if inks_of(s):
                    inks[u].add(inks_of(s))
                if True:  # histórico de todas as rodadas jogadas
                    opp = next((o for o in rel if o is not pm), None)
                    me_id = (pm.get("player") or {}).get("id")
                    entry = dict(table=m.get("table_number"), status=m.get("status"), opp=None, opp_rec=None, opp_inks=None, result=None, score=None)
                    if opp:
                        ou = opp["user_event_status"]["best_identifier"]
                        prev = standings.get(r["round_number"] - 1, {}).get(ou)
                        entry.update(opp=ou, opp_rec=prev["match_record"] if prev else None, opp_inks=list(inks_of(opp["user_event_status"])) or None)
                    if m.get("match_is_bye"):
                        entry.update(result="W", status="COMPLETE", opp=None)
                    elif m.get("status") == "COMPLETE":
                        if m.get("match_is_intentional_draw") or m.get("match_is_unintentional_draw") or (m.get("winning_player") is None):
                            entry["result"] = "D"
                        else:
                            entry["result"] = "W" if m.get("winning_player") == me_id else "L"
                        if m.get("games_won_by_winner") is not None:
                            entry["score"] = f'{m["games_won_by_winner"]}-{m.get("games_won_by_loser") or 0}'
                    hist[u][r["round_number"]] = entry
                    if live_r and r["id"] == live_r["id"]:
                        live[u] = entry
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
            live=live.get(user),
            history=hist[user],
        ))
    if missing:
        sys.exit(f"não localizados: {missing}")
    return dict(fetched_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), last_round=last,
                live_round=live_r["round_number"] if live_r else None, event_status=ev.get("display_status"),
                total=ev.get("starting_player_count") or len(standings[last]), players=players)


def main():
    data = collect()
    if len(sys.argv) > 2 and sys.argv[1] == "--json":
        Path(sys.argv[2]).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"R{data['last_round']} concluída · R{data['live_round']} em andamento · {sys.argv[2]}")
        return
    html = (HERE / "template.html").read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    page2 = OUT.parent / "confrontos" / "index.html"
    page2.parent.mkdir(parents=True, exist_ok=True)
    page2.write_text((HERE / "confrontos.html").read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    print(f"R{data['last_round']} concluída, R{data['live_round']} em andamento · {len(data['players'])} jogadores · {OUT}")


if __name__ == "__main__":
    main()
