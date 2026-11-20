const fs=require('fs'), vm=require('vm'), assert=require('assert');
const src=fs.readFileSync(__dirname+'/worker.js','utf8');
const handlers={}; let job, control={}; let navigations=[];
const liga='https://www.ligalorcana.com.br/?view=cards/card&card=Beast%20-%20Snowfield%20Troublemaker%20(1%2FPD1)%20(1-PD1)&ed=DLPC1&num=1-PD1';
const chrome={storage:{local:{async get(k){if(k==='job')return {job};if(k==='control')return {control};return {};},async set(v){if(v.job)job=v.job;if(v.control)control=v.control;}}},runtime:{onMessage:{addListener(fn){handlers.msg=fn}},onStartup:{addListener(){}}},alarms:{onAlarm:{addListener(){}},async clear(){}} ,tabs:{async query(){return [{id:10,url:liga}]},async get(){return {id:10,url:liga}}},scripting:{async executeScript(){return [{result:{url:liga,title:'Busca',txt:'',links:[],raw:null,scripts:[]}}]}}};
const ctx={importScripts(){},chrome,URL,Date,console,setTimeout,Blob,Uint8Array,btoa};vm.createContext(ctx);vm.runInContext(src,ctx);
function send(msg){return new Promise((resolve,reject)=>{handlers.msg(msg,null,resolve);setTimeout(()=>reject(Error('timeout')),2000)})}
(async()=>{
job={autoAll:false,running:false,phase:'paused',resumePhase:'retryPending',editions:['DLPC1'],editionIndex:1,cardIndex:1,queue:[liga],rows:{'x':{idcard:'a'}},seen:{},pending:{},skipped:{[liga]:{edition:'DLPC1',num:'1-PD1'}},editionAudit:{DLPC1:{verified:false}},log:[],delay:4000};
let r=await send({cmd:'start',autoAll:false,editions:['LOR1'],delay:4000});assert.equal(r.ok,true);assert.equal(job.phase,'home');assert.deepEqual(Array.from(job.editions),['LOR1']);assert.equal(Object.keys(job.rows).length,1);assert.equal(job.lastError,null);
await send({cmd:'pause'});assert.equal(job.phase,'paused');
console.log('PASS: completed retryPending (1/1, 0 pending) starts selected edition without dropping saved cards');
})().catch(e=>{console.error(e);process.exitCode=1});
