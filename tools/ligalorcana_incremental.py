#!/usr/bin/env python3
"""Build a conservative per-edition incremental Liga price proposal; never publish."""
import argparse,json,hashlib
from collections import Counter
from datetime import datetime,date
from pathlib import Path
from zoneinfo import ZoneInfo
if __package__:
    from .ligalorcana_release_candidate import captures,master_rows,resolve,parse_finish,reviewed_map,FINISHES,blob
else:
    from ligalorcana_release_candidate import captures,master_rows,resolve,parse_finish,reviewed_map,FINISHES,blob
SP=ZoneInfo('America/Sao_Paulo')
def run(source,cards_path,prices_path,map_path,out):
    cards=master_rows(json.loads(Path(cards_path).read_text('utf-8-sig')))
    base=json.loads(Path(prices_path).read_text('utf-8-sig'))
    mapping=reviewed_map(map_path)
    chosen,files,duplicates=captures(source)
    complete=set()
    for src in files:
        raw=json.loads(Path(src['file']).read_text('utf-8-sig'))
        for code,audit in raw.get('editionAudit',{}).items():
            expected=audit.get('queued_urls',audit.get('listing_total',audit.get('listingTotal')))
            captured=audit.get('captured_urls',audit.get('capturedUrls'))
            if isinstance(expected,int) and expected>0 and isinstance(captured,int) and captured>=expected and audit.get('failed_urls',0)==0:
                complete.add(code)
    prices={k:dict(v) for k,v in base.get('prices',{}).items() if isinstance(v,dict)}
    liga={k:dict(v) for k,v in base.get('liga_prices',{}).items() if isinstance(v,dict)}
    age={k:dict(v) for k,v in base.get('ligalorcana_last_valid_at',{}).items() if isinstance(v,dict)}
    counts=Counter();issues=[];changes={};statuses={};fallback=[]
    now=max(dt.astimezone(SP).date() for dt,_ in chosen.values())
    for _,(dt,row) in sorted(chosen.items(),key=lambda pair:pair[1][0]):
        code=str(row['code'])
        if code not in complete:
            counts['pending_edition']+=1
            continue
        cid,reason=resolve(row,cards,mapping)
        if not cid:
            counts['unmapped']+=1
            issues.append({'type':'unmapped','code':code,'number':row['num'],'reason':reason})
            continue
        counts['mapped']+=1
        for finish,keys in FINISHES.items():
            values,status=parse_finish(row,finish)
            statuses.setdefault(cid,{})[finish]=status
            if status!='ok':
                counts['rejected_'+finish]+=1
                if status=='invalid_order':issues.append({'type':'invalid_order','card_id':cid,'finish':finish})
                continue
            before={k:prices.get(cid,{}).get(k) for k in keys}
            liga.setdefault(cid,{}).update(values)
            prices.setdefault(cid,{}).update(values)
            age.setdefault(cid,{})[finish]=dt.astimezone(SP).isoformat()
            changes.setdefault(cid,{})[finish]={'before':before,'after':values}
            counts['accepted_'+finish]+=1
    # Fallback is evaluated independently for existing Liga prices not refreshed.
    for cid,finishes in age.items():
        for finish,last in finishes.items():
            if finish not in FINISHES:continue
            try:days=(now-datetime.fromisoformat(last.replace('Z','+00:00')).date()).days
            except (ValueError,AttributeError):continue
            if days>=5 and finish not in changes.get(cid,{}):
                fallback.append({'card_id':cid,'finish':finish,'age_days':days,
                                 'action':'eligible_for_tcg_fallback_if_tcg_price_valid'})
    result=dict(base)
    result.update({'prices':prices,'liga_prices':liga,'ligalorcana_last_valid_at':age,
                   'liga_date':now.isoformat()})
    quality={'completed_editions':sorted(complete),'counts':dict(counts),
             'preserved_unvisited_cards':len(set(base.get('prices',{}))-set(changes)),
             'fallback_candidates':fallback,'issues':issues,'duplicate_records':duplicates,
             'requires_review':True}
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    payload={'prices.candidate.json':result,'delta.json':changes,'qualidade.json':quality}
    for name,obj in payload.items():(out/name).write_bytes(blob(obj))
    manifest={'schema':'inkwell-ligalorcana-incremental-v1','date':now.isoformat(),
              'publishable':False,'requires_first_merge_approval':True,
              'source_hashes':files,'file_sha256':{name:hashlib.sha256(blob(obj)).hexdigest()
                                                   for name,obj in payload.items()}}
    (out/'manifest.json').write_bytes(blob(manifest))
    return quality
if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ('source','cards','prices','map','output'):p.add_argument('--'+name,required=True)
    a=p.parse_args()
    print(json.dumps(run(a.source,a.cards,a.prices,a.map,a.output),ensure_ascii=False))
