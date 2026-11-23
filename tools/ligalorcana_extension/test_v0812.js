const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/worker.js','utf8');
const handlers={}; let job=null,control=null;
const base='https://www.ligalorcana.com.br/?view=cards/card&card=Abu%20(103)&ed=LOR1&num=103';
const chrome={storage:{local:{async get(k){if(k==='job')return {job};if(k==='control')return {control};return {};},async set(v){if(v.job)job=v.job;if(v.control)control=v.control;}}},runtime:{onMessage:{addListener(fn){handlers.msg=fn}},onStartup:{addListener(){}}},alarms:{onAlarm:{addListener(){}},async clear(){}},tabs:{async query(){return [{id:10,url:base}]},async get(){return {id:10,url:base}}},scripting:{async executeScript(){return [{result:{url:base,title:'',txt:'',links:[],raw:null,scripts:[]}}]}}};
const ctx={importScripts(){},chrome,URL,Date,console,setTimeout,Blob,Uint8Array,btoa};vm.createContext(ctx);vm.runInContext(source,ctx);
async function send(cmd,extra){return new Promise((resolve,reject)=>{handlers.msg({cmd,...extra},null,resolve);setTimeout(()=>reject(new Error('timeout')),3000)})}
(async()=>{
 const old={idcard:'103',edition_id:'1',num:'103',code:'LOR1',url:base,name:'Abu',normal_status:'ok',foil_status:'no_offers',captured_at:'2026-11-19T20:00:00Z'};
 job={autoAll:false,running:false,phase:'complete',resumePhase:null,editions:['LOR1'],editionIndex:1,cardIndex:0,queue:[],rows:{'1_103':old},seen:{[base]:'1_103'},pending:{[base]:{edition:'LOR1',url:base}},skipped:{},editionAudit:{LOR1:{queued_urls:1,captured_urls:1}},log:[],delay:4000};
 const r=await send('start',{autoAll:false,editions:['LOR1'],delay:4000});
 assert.equal(r.ok,true);assert.equal(job.phase,'home');assert.equal(Object.keys(job.rows).length,1);
 assert.equal(Object.keys(job.seen).length,0,'MUST revisit previously captured URL');
 assert.equal(Object.keys(job.pending).length,0,'old pending must not contaminate a fresh daily run');
 assert.equal(job.editionAudit.LOR1.queued_urls,1,'historical audit preserved');
 await send('pause');console.log('PASS v0.8.12: daily run refreshes visited URLs, preserves records and audit, drops stale pending.');
})().catch(e=>{console.error(e);process.exitCode=1});
