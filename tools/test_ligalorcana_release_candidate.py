import json, tempfile, unittest
from pathlib import Path
from tools.ligalorcana_release_candidate import make_release

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.write('cards.json',{'cards':[
            {'id':'LOR13-226','name':'Mike Wazowski - Heroic Climber (Enchanted)'},
            {'id':'LOR13-97','name':'Mushu - Stealthy Dragon'}]})
        self.write('prices.json',{'schema_version':2,'liga_date':'2026-08-15',
                   'prices':{'LOR13-97':{'nl':1}},
                   'liga_prices':{'LOR13-226':{'nl':800,'n':810,'nh':820}}})
        self.write('history.json',{'schema_version':1,'series':[]})
        self.write('map.json',{'schema':'inkwell-ligalorcana-id-map-v1','mapa':{
            '19:2996:226':{'card_id':'LOR13-226','revisado':True},
            '19:3067:97':{'card_id':'LOR13-97','revisado':True}}})
        mike=self.row('2996','226','Mike Wazowski - Heroic Climber (Enchanted)',
                      'invalid_order',[89099,98250,97500],'ok',[1000,1100,1200])
        mushu=self.row('3067','97','Mushu - Stealthy Dragon','ok',[7816,10052,17990],
                       'no_offers',[None,None,None])
        self.write('coleta.json',{'schema':'inkwell-ligalorcana-local-v1',
                                  'total':2,'records':[mike,mushu]})
    def tearDown(self):self.temp.cleanup()
    def write(self,n,data):(self.root/n).write_text(json.dumps(data),encoding='utf-8')
    def row(self,idcard,num,name,ns,nvals,fs,fvals):
        x={'idcard':idcard,'edition_id':'19','code':'LOR13','num':num,'name':name,
           'idkey':'19_'+num,
           'url':'https://www.ligalorcana.com.br/?view=cards/card&ed=LOR13&num='+num,
           'captured_at':'2026-11-18T01:30:00Z','normal_status':ns,'foil_status':fs}
        for part,values in (('normal',nvals),('foil',fvals)):
            for field,v in zip(('min','med','max'),values):
                x[f'{part}_{field}_centavos']=v
        return x
    def args(self):
        return (self.root/'coleta.json',self.root/'cards.json',
                self.root/'prices.json',self.root/'history.json',
                self.root/'map.json',self.root/'out',0.1)
    def test_mike_does_not_block_or_overwrite(self):
        result=make_release(*self.args());base=Path(result[0]['directory'])
        prices=json.loads((base/'prices.candidate.json').read_text())['prices']
        self.assertEqual(prices['LOR13-226']['nl'],800)
        self.assertEqual(prices['LOR13-226']['fl'],10)
        self.assertEqual(prices['LOR13-97']['nl'],78.16)
        self.assertNotIn('usd_brl',json.loads((base/'prices.candidate.json').read_text()))
        self.assertTrue(any(x['kind']=='price_quality' and x['card_id']=='LOR13-226'
            for x in json.loads((base/'qualidade.json').read_text())['issues']))
        self.assertFalse(json.loads((base/'manifest.json').read_text())['publishable'])
    def test_immutable(self):
        make_release(*self.args())
        with self.assertRaises(FileExistsError):make_release(*self.args())
if __name__=='__main__':unittest.main()
