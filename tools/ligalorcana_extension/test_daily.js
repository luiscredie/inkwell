const fs=require('fs'),vm=require('vm'),assert=require('assert');
let data={},job={},starts=0,backups=0,alarms=[],clock='2026-11-21T03:03:00Z';
class Clock extends Date {constructor(...a){super(...(a.length?a:[clock]));} static now(){return new Date(clock).getTime();}}
const chrome={runtime:{id:'a'.repeat(32)},storage:{local:{async get(k){return {[k]:data[k]};},async set(v){Object.assign(data,v);}}},alarms:{async create(name,config){alarms.push({name,...config});},async clear(){}}};
const ctx={chrome,Date:Clock,Intl,console,load:async()=>job,exportSnapshot:async()=>{backups++},handleMessage:async msg=>{starts++;assert.equal(msg.delay,4000);assert.equal(msg.autoAll,true);return {ok:true};}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/daily.js','utf8'),ctx);
async function run(code){return vm.runInContext(code,ctx);}
(async()=>{
 job={phase:'complete',rows:{old:{captured_at:'2026-11-20'}}};data.daily={enabled:true};
 assert.equal(await run("saoPauloDay(new Date('2026-11-21T02:59:00Z'))"),'2026-11-20');
 assert.equal(await run("nextDaily(new Date('2026-11-21T03:02:00Z'))"),Date.parse('2026-11-21T03:03:00Z'));
 assert.equal(await run("nextDaily(new Date('2026-11-21T03:03:00Z'))"),Date.parse('2026-11-22T03:03:00Z'));
 const before=JSON.stringify(data);assert.equal((await run('dailyTick({dryRun:true})')).action,'start');
 assert.equal(starts,0);assert.equal(backups,0);assert.equal(JSON.stringify(data),before);assert.equal(alarms.length,0);
 await Promise.all([run('dailyTick()'),run('dailyTick()')]);assert.equal(starts,1);assert.equal(backups,1);
 assert.equal((await run('dailyTick()')).action,'already_started');assert.equal(starts,1);
 clock='2026-11-22T03:03:00Z';
 for(const phase of ['paused','captcha_wait','needs_review','card']){
  job={phase,rows:{}};assert.notEqual((await run('dailyTick()')).action,'started');
 }
 job={phase:'card',running:true,rows:{}};assert.equal((await run('dailyTick()')).action,'running');
 await run('configureDaily(false)');assert.equal((await run('dailyTick()')).action,'disabled');
 await run('configureDaily(true)');job={phase:'complete',rows:{old:{}}};
 ctx.exportSnapshot=async()=>{throw Error('disk full');};await assert.rejects(run('dailyTick()'),/disk full/);assert.equal(starts,1);
 ctx.exportSnapshot=async()=>{};ctx.handleMessage=async()=>({error:'failed'});
 await assert.rejects(run('dailyTick()'),/failed/);assert.notEqual(data.daily.startedDay,'2026-11-22');
 console.log('PASS daily: Sao Paulo midnight, dry-run has no effects, duplicate triggers, checkpoint/CAPTCHA guards, backup failure, retry after start failure.');
})().catch(e=>{console.error(e);process.exitCode=1});
