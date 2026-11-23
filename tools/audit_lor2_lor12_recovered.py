#!/usr/bin/env python3
"""Read-only identity audit of recovered LOR2/LOR12 snapshots versus site catalog.
Never alters prices or treats lack of marketplace offers as zero.
"""
import collections, html, json, re, subprocess, unicodedata

SOURCE = "coletas/ligalorcana/coleta/coleta_2026-11-19T04-35-42-293Z.json"
REF = "feature/ligalorcana-review-pipeline"

def norm(s):
    s = html.unescape(html.unescape(str(s or ""))).replace("&", " and ")
    s = unicodedata.normalize("NFKD", s).casefold()
    return re.sub("[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)))

def run():
    raw = json.load(open("site/data/cards.json", encoding="utf-8"))
    cards = raw.get("cards", raw) if isinstance(raw, dict) else raw
    if isinstance(cards, dict):
        cards = [dict(v, id=k) for k, v in cards.items()]
    catalog = {str(c.get("id") or c.get("card_id")): c for c in cards}
    subprocess.run(["git", "fetch", "--depth=1", "origin", REF], check=True,
                   capture_output=True, text=True)
    snapshot = json.loads(subprocess.check_output(["git", "show", f"FETCH_HEAD:{SOURCE}"], text=True))
    by = collections.defaultdict(dict)
    for row in snapshot["records"]:
        if row.get("code") not in ("LOR2", "LOR12"):
            continue
        key = str(row.get("num"))
        if key in by[row["code"]]:
            raise RuntimeError(f"Duplicated {row['code']}-{key}")
        by[row["code"]][key] = row
    # One additional source record appears only in the user-provided 10:29 UTC backup.
    # Its identity is checked, but does not prove source queue completion.
    if "121" not in by["LOR12"]:
        by["LOR12"]["121"] = {"code": "LOR12", "edition_id": "18", "idcard": "2541",
          "idkey": "18_121", "num": "121",
          "name": "Jack‐Jack Parr - Incredible Potential",
          "url": "https://www.ligalorcana.com.br/?view=cards%2Fcard&card=Jack%E2%80%90Jack+Parr+-+Incredible+Potential+%28121%29&ed=LOR12&num=121"}
    for edition in ("LOR2", "LOR12"):
        mismatches = []
        numbers = by[edition]
        for num, rec in sorted(numbers.items()):
            cid = edition + "-" + num
            c = catalog.get(cid)
            if not c:
                mismatches.append((cid, "not_in_catalog", rec["name"]))
                continue
            cname = next((c.get(k) for k in ("name_en", "name", "fullName", "full_name", "nEN", "title") if c.get(k)), "")
            if norm(cname) != norm(rec["name"]):
                mismatches.append((cid, "name_mismatch", rec["name"], cname))
            if rec.get("idkey") != str(rec.get("edition_id")) + "_" + num:
                mismatches.append((cid, "source_idkey_error"))
        missing_main = [str(i) for i in range(1, 205) if str(i) not in numbers]
        print(json.dumps({"edition": edition, "source_rows":len(numbers),
            "catalog_matches":len(numbers)-len(mismatches), "mismatches": mismatches,
            "missing_1_to_204": missing_main,
            "queue_audit":"absent; CANNOT declare publication-ready"},ensure_ascii=False))
    print("READ_ONLY_AUDIT_FINISHED; NO_PUBLICATION")
if __name__=="__main__":
    run()
