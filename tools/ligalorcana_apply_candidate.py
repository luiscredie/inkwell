#!/usr/bin/env python3
"""Verify immutable LigaLorcana release; optionally stage in PR worktree, never merge/deploy."""
import argparse, hashlib, json, os
from pathlib import Path
EXPECTED=('snapshot.json','delta.json','qualidade.json','prices.candidate.json','price-history.candidate.json')
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def load(path):return json.loads(Path(path).read_text('utf-8-sig'))
def validate(package,site_root,map_path=None):
    package=Path(package);site_root=Path(site_root);data=site_root/'data'
    man=load(package/'manifest.json')
    if man.get('schema')!='inkwell-ligalorcana-release-candidate-v1':
        raise ValueError('unknown package schema')
    if not man.get('publishable') or man.get('blockers'):
        raise ValueError('candidate blocked: '+str(man.get('blockers')))
    for name in EXPECTED:
        if man['sha256'].get(name)!=sha(package/name):
            raise ValueError('candidate checksum mismatch: '+name)
    if man.get('id_map_sha256') and (not map_path or man['id_map_sha256']!=sha(map_path)):
        raise ValueError('reviewed ID map mismatch')
    if man.get('cards_sha256')!=sha(data/'cards.json'):raise ValueError('cards.json changed')
    if man.get('prices_base_sha256')!=sha(data/'prices.json'):raise ValueError('prices.json base changed')
    candidate=load(package/'prices.candidate.json')
    history=load(package/'price-history.candidate.json')
    if candidate.get('schema_version')!=2 or candidate.get('source')!='LigaLorcana.com.br':
        raise ValueError('invalid prices schema/source')
    if 'usd_brl' in candidate:raise ValueError('TCGplayer USD rate not allowed')
    if candidate.get('liga_date')!=man.get('date'):raise ValueError('date mismatch')
    entries=candidate.get('prices',{})
    if not entries:raise ValueError('empty release')
    if set(entries)!=set(candidate.get('liga_prices',{})):
        raise ValueError('conflicting Liga price arrays')
    allcards=load(data/'cards.json')
    allcards=allcards.get('cards',allcards) if isinstance(allcards,dict) else allcards
    if isinstance(allcards,dict):ids=set(allcards)
    else:ids={str(x.get('id') or x.get('card_id')) for x in allcards if isinstance(x,dict)}
    if not set(entries).issubset(ids):raise ValueError('orphan card ID')
    for cid,row in entries.items():
        for keys in (('nl','n','nh'),('fl','f','fh')):
            present=[k in row for k in keys]
            if any(present) and not all(present):raise ValueError('partial finish: '+cid)
            if all(present):
                vals=[row[k] for k in keys]
                if any(type(v) not in (int,float) or v<=0 or round(v,2)!=v for v in vals) or vals!=sorted(vals):
                    raise ValueError('invalid price: '+cid)
    if history.get('schema_version')!=1 or not any(x.get('date')==man['date'] for x in history.get('series',[])):
        raise ValueError('daily history point missing')
    previous=load(data/'price-history.json')
    if man['date'] in {x.get('date') for x in previous.get('series',[])}:
        raise ValueError('date already present in base history')
    return {'card_prices':len(entries),'day':man['date'],'status':'validated'}
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package',required=True);p.add_argument('--site-root',default='site')
    p.add_argument('--write',action='store_true');p.add_argument('--map');a=p.parse_args()
    result=validate(a.package,a.site_root,a.map)
    if a.write:
        if os.getenv('GITHUB_REF_NAME')=='main':raise ValueError('refusing to write on main')
        for source,target in [('prices.candidate.json','prices.json'),
                              ('price-history.candidate.json','price-history.json')]:
            dest=Path(a.site_root)/'data'/target
            dest.write_bytes((Path(a.package)/source).read_bytes())
        result['status']='staged_for_pr'
    print(json.dumps(result));return 0
if __name__=='__main__':raise SystemExit(main())
