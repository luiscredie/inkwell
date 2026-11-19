import json,tempfile,unittest
from pathlib import Path
from tools.ligalorcana_generate_map import make_map
class MapTests(unittest.TestCase):
    def test_exact_and_ambiguous(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)
            cards={'cards':[{'id':'LOR13-97','name':'Mushu - Stealthy Dragon'},
                            {'id':'Q1-223--piglet','name':'Piglet - Pooh Pirate Captain'}]}
            rows=[]
            for code,num,name,cid,eid in [
                ('LOR13','97','Mushu - Stealthy Dragon','3067','19'),
                ('Q1','223','Piglet - Pooh Pirate Captain','459','10')]:
                rows.append({'code':code,'num':num,'name':name,'idcard':cid,
                             'edition_id':eid,'captured_at':'2026-11-18T01:30:00Z'})
            (d/'master.json').write_text(json.dumps(cards))
            (d/'coleta.json').write_text(json.dumps({
                'schema':'inkwell-ligalorcana-local-v1','total':2,'records':rows}))
            result=make_map(d/'coleta.json',d/'master.json',d/'map.json')
            self.assertEqual(result['exact'],1);self.assertEqual(result['pending'],1)
            mapping=json.loads((d/'map.json').read_text())['mapa']
            self.assertTrue(mapping['19:3067:97']['revisado'])
            self.assertFalse(mapping['10:459:223']['revisado'])
if __name__=='__main__':unittest.main()
