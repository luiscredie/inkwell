#!/usr/bin/env python3
"""Build immutable review candidate from LigaLorcana captures; NEVER publish to site/data."""
import argparse, hashlib, html, json, re, unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

BR = ZoneInfo('America/Sao_Paulo')
FINISHES = {'normal': ('nl', 'n', 'nh'), 'foil': ('fl', 'f', 'fh')}
BAD = {'missing', 'partial', 'invalid_order', 'no_offers'}
def read(path): return json.loads(Path(path).read_text('utf-8-sig'))
def blob(obj): return (json.dumps(obj,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8')
def digest(data): return hashlib.sha256(data).hexdigest()
def norm(value):
    value=html.unescape(html.unescape(str(value or '')))
    value=re.sub(r'\s*\((?:enchanted|alternate art|foil|promo)\)\s*    value=''.join(x for x in unicodedata.normalize('NFKD',value).casefold() if not unicodedata.combining(x))
    return re.sub(r'[^a-z0-9]','',value)
def master_rows(master):
    cards=master.get('cards',master) if isinstance(master,dict) else master
    if isinstance(cards,dict):cards=[dict(v,id=k) for k,v in cards.items() if isinstance(v,dict)]
    if not isinstance(cards,list):raise ValueError('cards.json: unknown schema')
    rows={}
    for row in cards:
        if not isinstance(row,dict):continue
        key=row.get('id') or row.get('card_id')
        if key:rows[str(key)]=row
    if not rows:raise ValueError('cards.json: zero IDs')
    return rows
def reviewed_map(path):
    if not path or not Path(path).exists():return {}
    raw=read(path)
    if raw.get('schema')!='inkwell-ligalorcana-id-map-v1':raise ValueError('unrecognized ID map schema')
    return raw['mapa']
def resolve(row,cards,mapping):
    key=f"{int(row['edition_id'])}:{int(row['idcard'])}:{row['num']}"
    entry=mapping.get(key)
    if entry:
        cid=entry.get('card_id')
        return (cid,'reviewed') if entry.get('revisado') is True and cid in cards else (None,'unreviewed_mapping')
    cid=f"{row['code']}-{row['num']}"
    target=cards.get(cid)
    if target is None:return None,'no_mapping'
    master_name=next((target[k] for k in ('name_en','name','fullName','full_name','nEN','title','name_pt') if target.get(k)),None)
    if master_name and norm(master_name)==norm(row['name']):return cid,'exact_edition_number_name'
    return None,'requires_review'
def parse_finish(row,finish):
    status=row.get(f'{finish}_status')
    vals=[row.get(f'{finish}_{field}_centavos') for field in ('min','med','max')]
    if status!='ok':return {},status if status in BAD else 'unknown_status'
    if any(type(v) is not int or v<=0 for v in vals) or not vals[0]<=vals[1]<=vals[2]:
        return {},'invalid_order'
    return {k:float(Decimal(v)/100) for k,v in zip(FINISHES[finish],vals)},'ok'
def captures(source):
    paths=sorted(Path(source).glob('coleta_*.json')) if Path(source).is_dir() else [Path(source)]
    if not paths:raise ValueError('no capture JSON files')
    chosen={};originals=[];duplicates=0
    for path in paths:
        raw=path.read_bytes();data=json.loads(raw.decode('utf-8-sig'))
        if data.get('schema')!='inkwell-ligalorcana-local-v1' or data.get('total')!=len(data.get('records',[])):
            raise ValueError(f'capture schema/count invalid: {path}')
        originals.append({'file':str(path),'sha256':digest(raw),'rows':len(data['records'])})
        for row in data['records']:
            dt=datetime.fromisoformat(row['captured_at'].replace('Z','+00:00'))
            if dt.utcoffset() is None:raise ValueError('capture timestamp has no offset')
            key=(dt.astimezone(BR).date().isoformat(),str(row['edition_id']),str(row['idcard']),str(row['num']))
            if key in chosen:duplicates+=1
            if key not in chosen or chosen[key][0]<dt:chosen[key]=(dt,row)
    return chosen,originals,duplicates
def preserve_prices(prices):
    result={}
    for cid,row in prices.items():
        if not isinstance(row,dict):continue
        sanitized={k:v for k,v in row.items() if k in ('n','nl','nh','f','fl','fh')
                   and isinstance(v,(int,float)) and not isinstance(v,bool) and v>0}
        if sanitized:result[cid]=sanitized
    return result
def make_release(source,cards_path,prices_path,history_path,map_path,outdir,min_coverage=0.98,daily_workflow=None):
    master_bytes=Path(cards_path).read_bytes();cards=master_rows(json.loads(master_bytes.decode('utf-8-sig')))
    base_bytes=Path(prices_path).read_bytes();base=json.loads(base_bytes)
    history=read(history_path);mapping=reviewed_map(map_path)
    selected,sources,duplicates=captures(source)
    all_samples=list(selected.values())
    final_day=max(dt.astimezone(BR).date().isoformat() for dt,_ in all_samples)
    by_day={final_day:all_samples};outputs=[]
    for day,samples in sorted(by_day.items()):
        batch_id=digest(blob(sources))[:12]
        dest=Path(outdir)/day/batch_id
        if dest.exists():
            manifest_path=dest/'manifest.json'
            if not manifest_path.exists() or read(manifest_path).get('sources')!=sources:
                raise FileExistsError(f'conflicting immutable package: {dest}')
            outputs.append({'directory':str(dest),'status':'already_processed'})
            continue
        previous=preserve_prices(base.get('liga_prices',{}))
        # Preserve only provenance-verified legacy Liga data, never fall back to TCGplayer.
        final={k:dict(v) for k,v in previous.items() if k in cards}
        ages={k:{f:base.get('liga_date') for f,keys in FINISHES.items() if all(t in v for t in keys)}
              for k,v in final.items()}
        daily={};details={};issues=[];counts=Counter();edition_counts=defaultdict(Counter)
        selected_ids=set();selected_identities={};newest=None
        for dt,row in sorted(samples,key=lambda x:x[0]):
            newest=max(newest,dt) if newest else dt
            code=str(row['code']);edition_counts[code]['collected']+=1
            cid,method=resolve(row,cards,mapping)
            if not cid:
                counts['unmapped']+=1;edition_counts[code]['unmapped']+=1
                issues.append({'kind':'unmapped','code':code,'num':str(row['num']),
                               'idcard':str(row['idcard']),'why':method})
                continue
            source_identity=(str(row['edition_id']),str(row['idcard']),str(row['num']))
            if cid in selected_ids and selected_identities[cid]!=source_identity:
                counts['duplicate_card_id']+=1
                issues.append({'kind':'collision','card_id':cid,'idcard':str(row['idcard'])})
                continue
            if cid not in selected_ids:selected_ids.add(cid);counts['mapped']+=1
            selected_identities[cid]=source_identity
            candidate=final.setdefault(cid,{});today=daily.setdefault(cid,{})
            status={}
            for f in FINISHES:
                vals,st=parse_finish(row,f);status[f]=st
                if st=='ok':
                    candidate.update(vals)
                    if dt.astimezone(BR).date().isoformat()==day:today.update(vals)
                    ages.setdefault(cid,{})[f]=dt.astimezone(BR).isoformat()
                    counts[f+'_ok']+=1;edition_counts[code][f+'_ok']+=1
                else:
                    counts[f+'_'+st]+=1
                    if st in ('invalid_order','partial','unknown_status'):
                        issues.append({'kind':'price_quality','card_id':cid,'finish':f,'status':st,
                                       'raw_centavos':[row.get(f+'_'+x+'_centavos') for x in ('min','med','max')]})
            details[cid]={'status':status,'mapped_by':method,'captured_at':dt.isoformat(),
                          'source':row['url'],'liga_card_id':row['idcard'],
                          'liga_edition_id':row['edition_id']}
        daily={cid:price for cid,price in daily.items() if price}
        generated=newest.astimezone(timezone.utc).isoformat() if newest else None
        final_prices={'schema_version':2,'generated_at':generated,'source':'LigaLorcana.com.br',
                      'currency':'BRL','liga_date':day,'prices':final,'liga_prices':final,
                      'ligalorcana_last_valid_at':ages}
        series=list(history.get('series',[]))
        if any(s.get('date')==day for s in series):issues.append({'kind':'date_already_in_history','date':day})
        else:series.append({'date':day,'prices':daily})
        series.sort(key=lambda r:r['date']);last_days={s['date'] for s in series[-35:]}
        seen_week=set();kept=[]
        for item in reversed(series):
            date=item['date'];week=date[:4]+'-'+datetime.fromisoformat(date).strftime('%W')
            if date in last_days or week not in seen_week:
                kept.append(item);seen_week.add(week)
        kept.reverse()
        new_history={'schema_version':1,'generated_at':generated,'source':'LigaLorcana.com.br',
                     'currency':'BRL','series':kept}
        coverage=len(selected_ids)/max(len(cards),1)
        blockers=[]
        if coverage<min_coverage:blockers.append(f'coverage {coverage:.1%} below {min_coverage:.0%}')
        if counts['duplicate_card_id']:blockers.append('ambiguous card ID collisions')
        if any(i['kind']=='date_already_in_history' for i in issues):blockers.append('history day already exists')
        if not daily:blockers.append('no valid prices')
        if not daily_workflow or not Path(daily_workflow).exists():
            blockers.append('cannot verify retired TCGplayer schedule')
        elif re.search(r'(?m)^  schedule:',Path(daily_workflow).read_text(encoding='utf-8')):
            blockers.append('daily-prices.yml still schedules TCGplayer overwrite')
        snapshot={'schema':'inkwell-ligalorcana-snapshot-v1','date':day,'cards':details,'updated':daily,
                  'preserved_from_liga':sorted(set(final)-set(daily)),'counts':dict(counts)}
        delta={cid:{'before':previous.get(cid,{}),'after':final[cid]} for cid in sorted(final)
               if previous.get(cid,{})!=final[cid]}
        quality={'date':day,'counts':dict(counts),'editions':{k:dict(v) for k,v in edition_counts.items()},
                 'coverage':round(coverage,6),'duplicates_in_raw':duplicates,'issues':issues,'blockers':blockers}
        payloads={'snapshot.json':blob(snapshot),'delta.json':blob(delta),'qualidade.json':blob(quality),
                  'prices.candidate.json':blob(final_prices),
                  'price-history.candidate.json':blob(new_history)}
        manifest={'schema':'inkwell-ligalorcana-release-candidate-v1','date':day,'publishable':not blockers,
                  'cards_sha256':digest(master_bytes),'prices_base_sha256':digest(base_bytes),
                  'id_map_sha256':digest(Path(map_path).read_bytes()) if map_path and Path(map_path).exists() else None,
                  'sources':sources,'sha256':{k:digest(v) for k,v in payloads.items()},
                  'blockers':blockers,'usage':'Review/CI only; do not copy to site/data until approved'}
        payloads['manifest.json']=blob(manifest)
        dest.mkdir(parents=True)
        for name,data in payloads.items():(dest/name).write_bytes(data)
        outputs.append({'directory':str(dest),'mapped':counts['mapped'],'updated':len(daily),
                        'coverage':coverage,'blockers':blockers})
    return outputs
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True);p.add_argument('--cards',required=True)
    p.add_argument('--prices',required=True);p.add_argument('--history',required=True)
    p.add_argument('--map',default=None);p.add_argument('--output',required=True)
    p.add_argument('--min-coverage',type=float,default=0.98)
    p.add_argument('--daily-workflow',default='.github/workflows/daily-prices.yml')
    args=p.parse_args()
    print(json.dumps(make_release(args.source,args.cards,args.prices,args.history,
                                  args.map,args.output,args.min_coverage,args.daily_workflow),ensure_ascii=False))
if __name__=='__main__':main()
,'',value,flags=re.I)
    value=value.replace('&',' and ')
    value=''.join(x for x in unicodedata.normalize('NFKD',value).casefold() if not unicodedata.combining(x))
    return re.sub(r'[^a-z0-9]','',value)
def master_rows(master):
    cards=master.get('cards',master) if isinstance(master,dict) else master
    if isinstance(cards,dict):cards=[dict(v,id=k) for k,v in cards.items() if isinstance(v,dict)]
    if not isinstance(cards,list):raise ValueError('cards.json: unknown schema')
    rows={}
    for row in cards:
        if not isinstance(row,dict):continue
        key=row.get('id') or row.get('card_id')
        if key:rows[str(key)]=row
    if not rows:raise ValueError('cards.json: zero IDs')
    return rows
def reviewed_map(path):
    if not path or not Path(path).exists():return {}
    raw=read(path)
    if raw.get('schema')!='inkwell-ligalorcana-id-map-v1':raise ValueError('unrecognized ID map schema')
    return raw['mapa']
def resolve(row,cards,mapping):
    key=f"{int(row['edition_id'])}:{int(row['idcard'])}:{row['num']}"
    entry=mapping.get(key)
    if entry:
        cid=entry.get('card_id')
        return (cid,'reviewed') if entry.get('revisado') is True and cid in cards else (None,'unreviewed_mapping')
    cid=f"{row['code']}-{row['num']}"
    target=cards.get(cid)
    if target is None:return None,'no_mapping'
    master_name=next((target[k] for k in ('name','fullName','full_name','nEN','title') if target.get(k)),None)
    if master_name and norm(master_name)==norm(row['name']):return cid,'exact_edition_number_name'
    return None,'requires_review'
def parse_finish(row,finish):
    status=row.get(f'{finish}_status')
    vals=[row.get(f'{finish}_{field}_centavos') for field in ('min','med','max')]
    if status!='ok':return {},status if status in BAD else 'unknown_status'
    if any(type(v) is not int or v<=0 for v in vals) or not vals[0]<=vals[1]<=vals[2]:
        return {},'invalid_order'
    return {k:float(Decimal(v)/100) for k,v in zip(FINISHES[finish],vals)},'ok'
def captures(source):
    paths=sorted(Path(source).glob('coleta_*.json')) if Path(source).is_dir() else [Path(source)]
    if not paths:raise ValueError('no capture JSON files')
    chosen={};originals=[];duplicates=0
    for path in paths:
        raw=path.read_bytes();data=json.loads(raw.decode('utf-8-sig'))
        if data.get('schema')!='inkwell-ligalorcana-local-v1' or data.get('total')!=len(data.get('records',[])):
            raise ValueError(f'capture schema/count invalid: {path}')
        originals.append({'file':str(path),'sha256':digest(raw),'rows':len(data['records'])})
        for row in data['records']:
            dt=datetime.fromisoformat(row['captured_at'].replace('Z','+00:00'))
            if dt.utcoffset() is None:raise ValueError('capture timestamp has no offset')
            key=(dt.astimezone(BR).date().isoformat(),str(row['edition_id']),str(row['idcard']),str(row['num']))
            if key in chosen:duplicates+=1
            if key not in chosen or chosen[key][0]<dt:chosen[key]=(dt,row)
    return chosen,originals,duplicates
def preserve_prices(prices):
    result={}
    for cid,row in prices.items():
        if not isinstance(row,dict):continue
        sanitized={k:v for k,v in row.items() if k in ('n','nl','nh','f','fl','fh')
                   and isinstance(v,(int,float)) and not isinstance(v,bool) and v>0}
        if sanitized:result[cid]=sanitized
    return result
def make_release(source,cards_path,prices_path,history_path,map_path,outdir,min_coverage=0.98,daily_workflow=None):
    master_bytes=Path(cards_path).read_bytes();cards=master_rows(json.loads(master_bytes.decode('utf-8-sig')))
    base_bytes=Path(prices_path).read_bytes();base=json.loads(base_bytes)
    history=read(history_path);mapping=reviewed_map(map_path)
    selected,sources,duplicates=captures(source)
    all_samples=list(selected.values())
    final_day=max(dt.astimezone(BR).date().isoformat() for dt,_ in all_samples)
    by_day={final_day:all_samples};outputs=[]
    for day,samples in sorted(by_day.items()):
        batch_id=digest(blob(sources))[:12]
        dest=Path(outdir)/day/batch_id
        if dest.exists():
            manifest_path=dest/'manifest.json'
            if not manifest_path.exists() or read(manifest_path).get('sources')!=sources:
                raise FileExistsError(f'conflicting immutable package: {dest}')
            outputs.append({'directory':str(dest),'status':'already_processed'})
            continue
        previous=preserve_prices(base.get('liga_prices',{}))
        # Preserve only provenance-verified legacy Liga data, never fall back to TCGplayer.
        final={k:dict(v) for k,v in previous.items() if k in cards}
        ages={k:{f:base.get('liga_date') for f,keys in FINISHES.items() if all(t in v for t in keys)}
              for k,v in final.items()}
        daily={};details={};issues=[];counts=Counter();edition_counts=defaultdict(Counter)
        selected_ids=set();selected_identities={};newest=None
        for dt,row in sorted(samples,key=lambda x:x[0]):
            newest=max(newest,dt) if newest else dt
            code=str(row['code']);edition_counts[code]['collected']+=1
            cid,method=resolve(row,cards,mapping)
            if not cid:
                counts['unmapped']+=1;edition_counts[code]['unmapped']+=1
                issues.append({'kind':'unmapped','code':code,'num':str(row['num']),
                               'idcard':str(row['idcard']),'why':method})
                continue
            source_identity=(str(row['edition_id']),str(row['idcard']),str(row['num']))
            if cid in selected_ids and selected_identities[cid]!=source_identity:
                counts['duplicate_card_id']+=1
                issues.append({'kind':'collision','card_id':cid,'idcard':str(row['idcard'])})
                continue
            if cid not in selected_ids:selected_ids.add(cid);counts['mapped']+=1
            selected_identities[cid]=source_identity
            candidate=final.setdefault(cid,{});today=daily.setdefault(cid,{})
            status={}
            for f in FINISHES:
                vals,st=parse_finish(row,f);status[f]=st
                if st=='ok':
                    candidate.update(vals)
                    if dt.astimezone(BR).date().isoformat()==day:today.update(vals)
                    ages.setdefault(cid,{})[f]=dt.astimezone(BR).isoformat()
                    counts[f+'_ok']+=1;edition_counts[code][f+'_ok']+=1
                else:
                    counts[f+'_'+st]+=1
                    if st in ('invalid_order','partial','unknown_status'):
                        issues.append({'kind':'price_quality','card_id':cid,'finish':f,'status':st,
                                       'raw_centavos':[row.get(f+'_'+x+'_centavos') for x in ('min','med','max')]})
            details[cid]={'status':status,'mapped_by':method,'captured_at':dt.isoformat(),
                          'source':row['url'],'liga_card_id':row['idcard'],
                          'liga_edition_id':row['edition_id']}
        daily={cid:price for cid,price in daily.items() if price}
        generated=newest.astimezone(timezone.utc).isoformat() if newest else None
        final_prices={'schema_version':2,'generated_at':generated,'source':'LigaLorcana.com.br',
                      'currency':'BRL','liga_date':day,'prices':final,'liga_prices':final,
                      'ligalorcana_last_valid_at':ages}
        series=list(history.get('series',[]))
        if any(s.get('date')==day for s in series):issues.append({'kind':'date_already_in_history','date':day})
        else:series.append({'date':day,'prices':daily})
        series.sort(key=lambda r:r['date']);last_days={s['date'] for s in series[-35:]}
        seen_week=set();kept=[]
        for item in reversed(series):
            date=item['date'];week=date[:4]+'-'+datetime.fromisoformat(date).strftime('%W')
            if date in last_days or week not in seen_week:
                kept.append(item);seen_week.add(week)
        kept.reverse()
        new_history={'schema_version':1,'generated_at':generated,'source':'LigaLorcana.com.br',
                     'currency':'BRL','series':kept}
        coverage=len(selected_ids)/max(len(cards),1)
        blockers=[]
        if coverage<min_coverage:blockers.append(f'coverage {coverage:.1%} below {min_coverage:.0%}')
        if counts['duplicate_card_id']:blockers.append('ambiguous card ID collisions')
        if any(i['kind']=='date_already_in_history' for i in issues):blockers.append('history day already exists')
        if not daily:blockers.append('no valid prices')
        if not daily_workflow or not Path(daily_workflow).exists():
            blockers.append('cannot verify retired TCGplayer schedule')
        elif re.search(r'(?m)^  schedule:',Path(daily_workflow).read_text(encoding='utf-8')):
            blockers.append('daily-prices.yml still schedules TCGplayer overwrite')
        snapshot={'schema':'inkwell-ligalorcana-snapshot-v1','date':day,'cards':details,'updated':daily,
                  'preserved_from_liga':sorted(set(final)-set(daily)),'counts':dict(counts)}
        delta={cid:{'before':previous.get(cid,{}),'after':final[cid]} for cid in sorted(final)
               if previous.get(cid,{})!=final[cid]}
        quality={'date':day,'counts':dict(counts),'editions':{k:dict(v) for k,v in edition_counts.items()},
                 'coverage':round(coverage,6),'duplicates_in_raw':duplicates,'issues':issues,'blockers':blockers}
        payloads={'snapshot.json':blob(snapshot),'delta.json':blob(delta),'qualidade.json':blob(quality),
                  'prices.candidate.json':blob(final_prices),
                  'price-history.candidate.json':blob(new_history)}
        manifest={'schema':'inkwell-ligalorcana-release-candidate-v1','date':day,'publishable':not blockers,
                  'cards_sha256':digest(master_bytes),'prices_base_sha256':digest(base_bytes),
                  'id_map_sha256':digest(Path(map_path).read_bytes()) if map_path and Path(map_path).exists() else None,
                  'sources':sources,'sha256':{k:digest(v) for k,v in payloads.items()},
                  'blockers':blockers,'usage':'Review/CI only; do not copy to site/data until approved'}
        payloads['manifest.json']=blob(manifest)
        dest.mkdir(parents=True)
        for name,data in payloads.items():(dest/name).write_bytes(data)
        outputs.append({'directory':str(dest),'mapped':counts['mapped'],'updated':len(daily),
                        'coverage':coverage,'blockers':blockers})
    return outputs
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True);p.add_argument('--cards',required=True)
    p.add_argument('--prices',required=True);p.add_argument('--history',required=True)
    p.add_argument('--map',default=None);p.add_argument('--output',required=True)
    p.add_argument('--min-coverage',type=float,default=0.98)
    p.add_argument('--daily-workflow',default='.github/workflows/daily-prices.yml')
    args=p.parse_args()
    print(json.dumps(make_release(args.source,args.cards,args.prices,args.history,
                                  args.map,args.output,args.min_coverage,args.daily_workflow),ensure_ascii=False))
if __name__=='__main__':main()
