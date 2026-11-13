"""Gera site/dlc-londres/index.html com os standings oficiais do Play Hub (DLC London: Main Event 1).

Uso:  python tools/dlc-londres/build.py              (regera a página com os dados embutidos)
      python tools/dlc-londres/build.py --json X.json  (só os dados: usado pela Action a cada 5 min)
Busca o evento, os standings de cada rodada concluída e as partidas (para as tintas do deck),
casa os jogadores pelo username do Play Hub e grava os dados dentro da página (página estática).
"""
from collections import Counter
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


CUT, SWISS, PRIOR = 18, 8, 10


def analyze(done, matches, standings, last, deck_of, mu, names):
    """Análise do desempenho dos brasileiros, só com rodadas concluídas da fase 1.

    - força da tabela: aproveitamento final (pontos / pontos possíveis) dos adversários enfrentados,
      com o percentil entre todos os jogadores do evento;
    - vitórias esperadas pelo matchup: para cada partida, a taxa de vitória da dupla de tintas do
      jogador contra a do adversário no evento inteiro, puxada para 50% com peso de PRIOR partidas;
    - placares em games, campanha por deck adversário, partidas de vida ou morte para o corte.
    """
    final = {x["player"]["id"]: x for x in standings[last].values()}

    def rec(x):
        w, l, d = (int(v) for v in x["match_record"].split("-"))
        return w, l, d

    def apr(pid):
        x = final.get(pid)
        if not x:
            return None
        w, l, d = rec(x)
        n = w + l + d
        return (3 * w + d) / (3 * n) if n else None

    def prob(k, ok):
        if k == "none" or ok == "none" or k == ok:
            return 0.5
        w, l, d = mu.get(f"{k}|{ok}", [0, 0, 0])
        return (w + d / 2 + PRIOR * 0.5) / (w + l + d + PRIOR)

    opps, mine = {}, {}
    for r in sorted(done, key=lambda r: r["round_number"]):
        rn = r["round_number"]
        for m in matches(r):
            rel = m["player_match_relationships"]
            ids = [(pm.get("player") or {}).get("id") for pm in rel]
            if not m.get("match_is_bye") and len(rel) == 2 and None not in ids:
                opps.setdefault(ids[0], []).append(ids[1])
                opps.setdefault(ids[1], []).append(ids[0])
            for i, pm in enumerate(rel):
                u = pm["user_event_status"]["best_identifier"]
                if u in names:
                    mine.setdefault(u, []).append((rn, m, ids[i], ids[1 - i] if len(ids) == 2 else None,
                                                  rel[1 - i] if len(rel) == 2 else None))
    sos = {}
    for pid, os_ in opps.items():
        v = [a for a in (apr(o) for o in os_) if a is not None]
        if v:
            sos[pid] = sum(v) / len(v)
    allsos = sorted(sos.values())

    out = {}
    for u, lst in mine.items():
        rows, games = [], dict(w20=0, w21=0, l12=0, l02=0, d=0)
        for rn, m, me, op, opm in sorted(lst, key=lambda t: t[0]):
            prev = standings.get(rn - 1, {}).get(u)
            before = prev["match_points"] if prev else 0
            left = SWISS - rn + 1
            must = before + 3 * (left - 1) < CUT <= before + 3 * left
            bye = bool(m.get("match_is_bye")) or op is None
            if bye:
                rows.append(dict(r=rn, bye=True, res="W", p=1.0, before=before, must=must))
                continue
            draw = m.get("match_is_intentional_draw") or m.get("match_is_unintentional_draw") or m.get("winning_player") is None
            res = "D" if draw else "W" if m.get("winning_player") == me else "L"
            gw, gl = m.get("games_won_by_winner"), m.get("games_won_by_loser") or 0
            if res == "W":
                games["w20" if gl == 0 else "w21"] += 1
            elif res == "L":
                games["l02" if gl == 0 else "l12"] += 1
            else:
                games["d"] += 1
            k, ok = deck_of.get(me, "none"), deck_of.get(op, "none")
            fx = final.get(op)
            rows.append(dict(r=rn, res=res, g=None if gw is None else ([gw, gl] if res == "W" else [gl, gw]),
                             opp=opm["user_event_status"]["best_identifier"], deck=ok,
                             opp_final=fx["match_record"] if fx else None, opp_apr=apr(op),
                             p=round(prob(k, ok), 3), before=before, must=must))
        me_pid = standings[last][u]["player"]["id"] if u in standings[last] else None
        s = sos.get(me_pid)
        out[u] = dict(
            sos=None if s is None else round(s, 4),
            sos_pct=None if s is None else round(sum(1 for v in allsos if v < s) / len(allsos), 3),
            exp=round(sum(x["p"] for x in rows), 2),
            act=sum(1 if x["res"] == "W" else 0.5 if x["res"] == "D" else 0 for x in rows),
            games=games, rows=rows)
    return out


def collect():
    ev = get(f"events/{EVENT}/")
    rounds = [r for ph in ev["tournament_phases"][:1] for r in ph["rounds"]]
    later = [r for ph in ev["tournament_phases"][1:] for r in ph["rounds"] if r["status"] in ("COMPLETE", "IN_PROGRESS")]
    done = [r for r in rounds if r["status"] == "COMPLETE"]
    live_r = next((r for r in rounds if r["status"] == "IN_PROGRESS"), None)
    # O Play Hub às vezes mantém a rodada "IN_PROGRESS" depois que todas as partidas terminaram.
    # Se todas estão COMPLETE e os standings dela já saíram, a rodada conta como concluída.
    if live_r:
        ms = pages(f"tournament-rounds/{live_r['id']}/matches/paginated/")
        if ms and all(m.get("status") == "COMPLETE" for m in ms):
            st = pages(f"tournament-rounds/{live_r['id']}/standings/paginated/")
            if st and all(x["round_number"] == live_r["round_number"] for x in st):
                done.append(live_r)
                live_r = None
    names = {u for _, _, u in PLAYERS}
    standings, inks, live, hist = {}, {u: set() for u in names}, {}, {u: {} for u in names}
    for r in done:
        rows = pages(f"tournament-rounds/{r['id']}/standings/paginated/")
        assert all(x["round_number"] == r["round_number"] for x in rows)
        standings[r["round_number"]] = {x["user_event_status"]["best_identifier"]: x for x in rows}
    last = max(standings)
    # Batalha de decks: todos os jogadores do evento, agrupados pelas tintas registradas
    deck_of, dropped, d2 = {}, set(), set()
    agg, mu = {}, {}
    cache = {}
    def matches(r):
        if r["id"] not in cache:
            cache[r["id"]] = pages(f"tournament-rounds/{r['id']}/matches/paginated/")
        return cache[r["id"]]
    for x in standings[last].values():
        if x["user_event_status"].get("registration_status") == "DROPPED":
            dropped.add(x["player"]["id"])
    for r in [x for x in rounds if x["status"] in ("COMPLETE", "IN_PROGRESS")] + later:
        phase2 = r in later
        for m in matches(r):
            rel = m["player_match_relationships"]
            keys = []
            for pm in rel:
                pid = (pm.get("player") or {}).get("id")
                k = "+".join(sorted(inks_of(pm["user_event_status"]))) or "none"
                if pid is not None:
                    deck_of.setdefault(pid, k)
                    if phase2:
                        d2.add(pid)
                keys.append((pid, k))
            if phase2 or r["status"] != "COMPLETE" or m.get("status") != "COMPLETE" or m.get("match_is_bye") or len(keys) != 2:
                continue
            draw = m.get("match_is_intentional_draw") or m.get("match_is_unintentional_draw") or m.get("winning_player") is None
            for (pid, k), (oid, ok) in (keys, keys[::-1]):
                res = 2 if draw else 0 if m.get("winning_player") == pid else 1
                agg.setdefault(k, [0, 0, 0])[res] += 1
                if k != "none" and ok != "none" and k != ok:
                    mu.setdefault(f"{k}|{ok}", [0, 0, 0])[res] += 1
    decks = {}
    for pid, k in deck_of.items():
        d = decks.setdefault(k, dict(players=0, active=0, d2=0, w=0, l=0, d=0))
        d["players"] += 1
        d["active"] += pid not in dropped
        d["d2"] += pid in d2
    for k, (w, l, dr) in agg.items():
        decks.setdefault(k, dict(players=0, active=0, d2=0, w=0, l=0, d=0)).update(w=w, l=l, d=dr)
    for r in [x for x in rounds if x["status"] in ("COMPLETE", "IN_PROGRESS")]:
        for m in matches(r):
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
    ana = analyze(done, matches, standings, last, deck_of, mu, names)
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
            d2=x["player"]["id"] in d2,
            ana=ana.get(user),
        ))
    if missing:
        sys.exit(f"não localizados: {missing}")
    return dict(fetched_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), last_round=last,
                live_round=live_r["round_number"] if live_r else None, event_status=ev.get("display_status"),
                total=ev.get("starting_player_count") or len(standings[last]), players=players,
                decks=decks, mu=mu, day2_started=bool(later),
                pts_hist=dict(Counter(x["match_points"] for x in standings[last].values()
                                      if x["user_event_status"].get("registration_status") != "DROPPED")))


def main():
    data = collect()
    if len(sys.argv) > 2 and sys.argv[1] == "--json":
        Path(sys.argv[2]).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"R{data['last_round']} concluída · {'R' + str(data['live_round']) + ' em andamento' if data['live_round'] else 'nenhuma rodada em andamento'} · {sys.argv[2]}")
        return
    html = (HERE / "template.html").read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    page2 = OUT.parent / "confrontos" / "index.html"
    page2.parent.mkdir(parents=True, exist_ok=True)
    page2.write_text((HERE / "confrontos.html").read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    page4 = OUT.parent / "analise" / "index.html"
    page4.parent.mkdir(parents=True, exist_ok=True)
    page4.write_text((HERE / "analise.html").read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    page3 = OUT.parent / "decks" / "index.html"
    page3.parent.mkdir(parents=True, exist_ok=True)
    page3.write_text((HERE / "decks.html").read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False)), encoding="utf-8")
    print(f"R{data['last_round']} concluída, {'R' + str(data['live_round']) + ' em andamento' if data['live_round'] else 'nenhuma rodada em andamento'} · {len(data['players'])} jogadores · {OUT}")


if __name__ == "__main__":
    main()
