// Pure Chrome API stubs: no web access or user data.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/worker.js','utf8');
const db={control:{paused:false,token:'run-1'}};const alarms=[];
const chrome={storage:{local:{async get(key){return {[key]:db[key]}},async set(items){Object.assign(db,items)}}},alarms:{async create(name,settings){alarms.push({name,settings})},async clear(){return true},onAlarm:{addListener(){}}},runtime:{onMessage:{addListener(){}},onStartup:{addListener(){}}}};
const ctx={importScripts(){},chrome,Date,URL,console,setTimeout};vm.createContext(ctx);vm.runInContext(src,ctx);
ctx.testJob={runToken:'run-1',running:true,phase:'card',editionIndex:0,editions:['LOR7'],cardIndex:40,queue:['u1'],rows:{old:{name:'saved'}},seen:{},pending:{broken:{edition:'LOR12'}},log:[],tabId:5};
(async()=>{
 await vm.runInContext('deferSuspectedCaptcha(testJob,"test suspicion")',ctx);
 assert.equal(db.job.phase,'captcha_wait');assert.equal(db.job.running,false);
 assert.equal(db.job.rows.old.name,'saved');assert.equal(db.job.pending.broken.edition,'LOR12');
 assert.equal(db.job.captchaChecks,1);assert.equal(alarms[0].name,'inkwell-captcha-recheck');
 assert.ok(alarms[0].settings.when>Date.now()+599000);
 console.log('Rechecagem 10 min preserva progresso, dados e pend�ncias.');
})().catch(e=>{console.error(e);process.exitCode=1});
