// Regression for popup -> worker commands. No network or real Chrome state.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let src=fs.readFileSync(__dirname+'/worker.js','utf8');
// Do not launch a browser pump here; test dispatch and persisted recovery cursor.
src=src.replaceAll('pump();return {ok:true,phase:', 'void 0;return {ok:true,phase:');
src=src.replace('await save(j);pump();\n  return {ok:true,message:', 'await save(j);void 0;\n  return {ok:true,message:');
const commands=[];const db={job:{runToken:'old-token',running:false,phase:'paused',resumePhase:'card',editions:['LOR6','LOR5'],editionIndex:0,cardIndex:88,queue:['https://www.ligalorcana.com.br/?view=cards/card&card=Gazelle&ed=LOR6&num=88'],listingUrl:'https://www.ligalorcana.com.br/?view=cards/search&card=ed%3DLOR6',listingTotal:204,rows:{'88|17|88':{name:'Gazelle'}},seen:{},editionAudit:{LOR12:{queued_urls:267,captured_urls:266,failed_urls:1}},pending:{'https://www.ligalorcana.com.br/?view=cards/card&card=Jack%26amp%3B8208%3BJack%20Parr%20-%20Incredible%20Potential%20(121)&ed=LOR12&num=121':{edition:'LOR12',reason:'legacy URL'}},log:[]},control:{token:'old-token',paused:true}};
let messageHandler;
const chrome={
 storage:{local:{async get(k){return {[k]:db[k]}},async set(v){Object.assign(db,v)}}},
 alarms:{async create(){},async clear(){return true},onAlarm:{addListener(){}}},
 runtime:{onMessage:{addListener(fn){messageHandler=fn}},onStartup:{addListener(){}}},
 tabs:{async query(){return [{id:42,url:'https://www.ligalorcana.com.br/?view=cards/card&card=Gazelle&ed=LOR6&num=88'}]}},
 downloads:{async download({filename}){commands.push(filename);return 1}}
};
// download helper needs Blob+btoa, which Node provides.
const ctx={importScripts(){},chrome,Date,URL,console,setTimeout,Blob,Uint8Array,btoa};vm.createContext(ctx);vm.runInContext(src,ctx);
function send(cmd){return new Promise((resolve,reject)=>{const keep=messageHandler({cmd},null,result=>resolve(result));if(!keep)reject(new Error('Handler not async'));});}
(async()=>{
 const before=JSON.stringify(db.job);
 const d=await send('diagnostic');assert.equal(d.ok,true);assert.equal(db.job.rows['88|17|88'].name,'Gazelle');assert.ok(commands.some(x=>x.includes('diagnostico_')));
 const r=await send('retryPending');assert.equal(r.ok,true);assert.equal(r.pending,1);assert.equal(db.job.phase,'retryPending');assert.equal(db.job.running,true);
 assert.equal(db.job.retryPrevious.editions.join(','),'LOR6,LOR5');assert.equal(db.job.retryPrevious.cardIndex,88);
 assert.equal(Object.keys(db.job.rows).length,1);assert.equal(db.job.queue.length,1);
 assert.equal(db.job.queue[0].includes('Jack'),true);
 const again=await send('retryPending');assert.ok(again.error.includes('Pause'));
 console.log('PASS: retryPending command recognised, does not reset paused LOR6 cursor, blocks concurrent run; diagnostic exports JSON.');
})().catch(e=>{console.error(e);process.exitCode=1});
