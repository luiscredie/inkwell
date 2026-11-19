#!/usr/bin/env python3
"""Generate conservative Liga->Inkwell reviewed ID map; no guessing of variants."""
import argparse,json
from collections import Counter
from pathlib import Path
if __package__:
    from .ligalorcana_release_candidate import captures,master_rows,norm,blob
else:
    from ligalorcana_release_candidate import captures,master_rows,norm,blob

def make_map(source,cards_path,out,existing=None):
    master=master_rows(json.loads(Path(cards_path).read_text(encoding='utf-8-sig')))
    old={}
    if existing and Path(existing).exists():
        prior=json.loads(Path(existing).read_text('utf-8-sig'))
        if prior.get('schema')!='inkwell-ligalorcana-id-map-v1':raise ValueError('unknown reviewed map')
        old=prior.get('mapa',{})
    rows,_,_=captures(source)
    mapping={};counts=Counter();pending=[]
    for key,(_,row) in sorted(rows.items()):
        k=f"{int(row['edition_id'])}:{int(row['idcard'])}:{row['num']}"
        if k in mapping:continue
        prev=old.get(k)
        if prev and prev.get('revisado') is True:
            cid=prev.get('card_id')
            if cid in master:
                mapping[k]=prev;counts['previously_reviewed']+=1;continue
        candidate=f"{row['code']}-{row['num']}"
        master_card=master.get(candidate)
        name=next((master_card[n] for n in ('name_en','name','fullName','full_name','nEN','title','name_pt')
                  if master_card.get(n)),None) if master_card else None
        if name and norm(name)==norm(row['name']):
            mapping[k]={'card_id':candidate,'metodo':'edicao_numero_nome_exatos','revisado':True}
            counts['exact']+=1
        else:
            mapping[k]={'card_id':None,'metodo':'pendente','revisado':False}
            counts['pending']+=1
            pending.append({'liga_key':k,'code':row['code'],'num':row['num'],
                            'nome':row['name'],'candidate':candidate if candidate in master else None,
                            'reason':'master name mismatch' if candidate in master else 'card ID missing/variant'})
    data={'schema':'inkwell-ligalorcana-id-map-v1',
          'chave':'liga_edicao_id:liga_card_id:num','mapa':mapping}
    out=Path(out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_bytes(blob(data))
    (out.parent/'pendencias-mapeamento.json').write_bytes(blob({'counts':dict(counts),'rows':pending}))
    return dict(counts)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True);p.add_argument('--cards',required=True)
    p.add_argument('--output',required=True);p.add_argument('--existing');a=p.parse_args()
    print(json.dumps(make_map(a.source,a.cards,a.output,a.existing)))
if __name__=='__main__':main()
