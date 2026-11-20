#!/usr/bin/env python3
"""Read-only audit (#293): printings whose `inkable` field and `tags` disagree.

The site and the Coach read `inkable`; the `tags` value "uninkable" is not used anywhere. This audit only lists the
disagreements so they can be checked against the official source before any change. It never writes a file.

    python3 tools/audit_inkable_tags.py                      # summary
    python3 tools/audit_inkable_tags.py --csv > audit.csv    # one row per printing
"""
import argparse, collections, csv, json, re, sys
from pathlib import Path

CARDS = Path(__file__).resolve().parent.parent / "site" / "data" / "cards.json"
UNINK = re.compile(r"(^|;)\s*uninkable\s*(;|$)", re.I)
INK = re.compile(r"(^|;)\s*inkable\s*(;|$)", re.I)


def disagreements(cards):
    """(card, kind) for every printing whose field and tag say opposite things."""
    out = []
    for c in cards:
        tags = str(c.get("tags") or "")
        field = bool(c.get("inkable"))
        if field and UNINK.search(tags):
            out.append((c, "inkable=1, tag uninkable"))
        elif not field and INK.search(tags):
            out.append((c, "inkable=0, tag inkable"))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cards", type=Path, default=CARDS)
    ap.add_argument("--csv", action="store_true", help="one row per printing, to stdout")
    a = ap.parse_args(argv)
    cards = json.loads(a.cards.read_text(encoding="utf-8"))["cards"]
    bad = disagreements(cards)
    if a.csv:
        w = csv.writer(sys.stdout)
        w.writerow(["card_id", "name_en", "inkable", "tags", "kind"])
        for c, kind in bad:
            w.writerow([c["card_id"], c.get("name_en", ""), int(bool(c.get("inkable"))), c.get("tags", ""), kind])
        return 0
    kinds = collections.Counter(k for _, k in bad)
    sets = collections.Counter(c["card_id"].split("-")[0] for c, _ in bad)
    print(f"{len(cards)} printings; {len(bad)} disagree ({len({c.get('name_en') for c, _ in bad})} cards)")
    for k, n in kinds.items():
        print(f"  {k}: {n}")
    print("  by set: " + ", ".join(f"{s} {n}" for s, n in sets.most_common()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
