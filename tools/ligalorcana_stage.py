#!/usr/bin/env python3
"""Isolated LigaLorcana review staging. Never writes to site/data."""
import argparse, csv, html, io, json, re
from collections import Counter
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse,parse_qs

FIELDS=("min","med","max")
STATUSES={"ok","no_offers","missing","partial","invalid_order"}
def verify(r):
    for k in ("idcard","edition_id","num","name","code","url","captured_at"):
        if not str(r.get(k) or "").strip(): raise ValueError("missing "+k)
    u=urlparse(r["url"]);q=parse_qs(u.query)
    if (u.scheme,u.hostname,q.get("view"))!=("https","www.ligalorcana.com.br",["cards/card"]):
        raise ValueError("invalid source URL")
    if q.get("ed",[""])[0].upper()!=str(r["code"]).upper() or q.get("num")!=[str(r["num"])]:
        raise ValueError("source URL mismatches identity")
    if r.get("idkey") not in (None,str(r["edition_id"])+"_"+str(r["num"])):
        raise ValueError("idkey mismatches edition and number")
    dt=datetime.fromisoformat(r["captured_at"].replace("Z","+00:00"))
    if dt.utcoffset() is None: raise ValueError("capture timezone absent")
    issues=[]
    for finish in ("normal","foil"):
        status=r.get(finish+"_status")
        if status not in STATUSES: raise ValueError("unknown finish status")
        vals=[r.get(finish+"_"+f+"_centavos") for f in FIELDS]
        if any(v is not None and (type(v)!=int or v<0) for v in vals):
            raise ValueError("invalid cents")
        valid=len([v for v in vals if v is not None])==3
        ordered=valid and vals[0]<=vals[1]<=vals[2]
        if status=="ok" and not ordered: raise ValueError("incorrect ok status")
        if status=="invalid_order" and (not valid or ordered): raise ValueError("incorrect invalid_order status")
        if status in ("missing","no_offers") and any(v is not None for v in vals):
            raise ValueError("unexpected price for empty status")
        if status in ("missing","partial","invalid_order"):issues.append(finish+":"+status)
    return dict(r,name=html.unescape(html.unescape(r["name"]))),issues,dt.date().isoformat()

def stage(path,root):
    data=json.loads(path.read_text(encoding="utf-8-sig"))
    if data.get("schema")!="inkwell-ligalorcana-local-v1" or not isinstance(data.get("records"),list):
        raise ValueError("invalid capture schema")
    if data.get("total")!=len(data["records"]) or not data["records"] or len(data["records"])>10000:
        raise ValueError("invalid record count")
    seen=set();byday={};issues=[];count=Counter()
    for n,r in enumerate(data["records"],1):
        try:
            clean,problems,day=verify(r)
            key=(day,str(clean["idcard"]),str(clean["edition_id"]),str(clean["num"]))
            if key in seen: raise ValueError("duplicate composite key/day")
            seen.add(key);byday.setdefault(day,[]).append(clean);count["accepted"]+=1
            for p in problems:issues.append({"row":n,"issue":p,"id":list(key)})
        except (ValueError,TypeError,KeyError) as e:
            count["rejected"]+=1
            issues.append({"row":n,"issue":"rejected","reason":str(e)})
    if not byday:raise ValueError("no valid rows")
    staged=[]
    for day,rows in sorted(byday.items()):
        base=root/"tratados"/day/path.stem
        handoff=root/"data"/day/(path.stem+".json")
        report=root/"tratados"/"relatorios"/(path.stem+".json")
        if any(p.exists() for p in (base/"cartas.json",handoff,report)):
            raise FileExistsError("immutable snapshot already exists")
        base.mkdir(parents=True,exist_ok=True);handoff.parent.mkdir(parents=True,exist_ok=True)
        payload={"schema":"inkwell-ligalorcana-handoff-v1","publicavel":False,"requires_review":bool(issues),"source":str(path),"capture_day":day,"total":len(rows),"records":rows}
        (base/"cartas.json").write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        handoff.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        cols=["idcard","edition_id","idkey","code","num","name","edition_name","url","captured_at","normal_status","foil_status"]+[f"{finish}_{f}_centavos" for finish in ("normal","foil") for f in FIELDS]
        with (base/"cartas.csv").open("w",encoding="utf-8",newline="") as f:
            w=csv.DictWriter(f,fieldnames=cols,delimiter=";",extrasaction="ignore");w.writeheader();w.writerows(rows)
        staged.append(day)
    report=root/"tratados"/"relatorios"/(path.stem+".json")
    report.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(json.dumps({"source":str(path),"counts":dict(count),"issues":issues,"days":staged,"published":False},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return count

def main():
    a=argparse.ArgumentParser();a.add_argument("--source",type=Path,required=True);a.add_argument("--root",type=Path,required=True);x=a.parse_args()
    paths=sorted(x.source.glob("coleta_*.json")) if x.source.is_dir() else [x.source]
    for path in paths:
        if (x.root/"tratados"/"relatorios"/(path.stem+".json")).exists():continue
        result=stage(path,x.root)
        print(path,dict(result))
if __name__=="__main__":main()
