// Daily scheduling only orchestrates the existing collector; it never solves CAPTCHA.
const DAILY_ALARM='inkwell-daily-0003';
let dailyBusy=false;
function saoPauloDay(now=new Date()) {
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function nextDaily(now=new Date()) {
 // Sao Paulo uses UTC-03:00. Calendar arithmetic avoids the Windows host timezone.
 let due=new Date(saoPauloDay(now)+'T00:03:00-03:00');
 if(due<=now)due=new Date(due.getTime()+86400000);
 return due.getTime();
}
async function armDaily() {
 const {daily}=await chrome.storage.local.get('daily');
 if(daily?.enabled)await chrome.alarms.create(DAILY_ALARM,{when:nextDaily()});
 else await chrome.alarms.clear(DAILY_ALARM);
}
async function dailyStatus() {
 const {daily}=await chrome.storage.local.get('daily');
 return {ok:true,...daily,extensionId:chrome.runtime.id,nextAt:daily?.enabled?nextDaily():null};
}
async function configureDaily(enabled) {
 const {daily={}}=await chrome.storage.local.get('daily');
 await chrome.storage.local.set({daily:{...daily,enabled:!!enabled}});
 await armDaily();return dailyStatus();
}
async function dailyTick({dryRun=false}={}) {
 if(dailyBusy)return {ok:true,action:'busy'};
 dailyBusy=true;
 try {
  const {daily={}}=await chrome.storage.local.get('daily');
  const now=new Date(),day=saoPauloDay(now),j=await load();
  const due=new Date(day+'T00:03:00-03:00');
  let action=!daily.enabled?'disabled':now<due?'before_time':daily.startedDay===day?'already_started':
   j.running?'running':j.phase==='captcha_wait'?'captcha_wait':
   !['idle','complete'].includes(j.phase)?'checkpoint_requires_review':'start';
  if(dryRun)return {ok:true,dryRun:true,day,action,delay:4000,autoAll:true};
  await armDaily();
  if(action!=='start') {
   await chrome.storage.local.set({daily:{...daily,lastCheck:now.toISOString(),lastAction:action}});
   return {ok:true,action};
  }
  // Export the previous snapshot before recapture can replace records.
  if(Object.keys(j.rows||{}).length)await exportSnapshot(j);
  await chrome.storage.local.set({daily:{...daily,startedDay:day,lastCheck:now.toISOString(),lastAction:'starting'}});
  try {
   const result=await handleMessage({cmd:'start',autoAll:true,editions:[],delay:4000,daily:true});
   if(result.error)throw Error(result.error);
   await chrome.storage.local.set({daily:{...daily,startedDay:day,lastCheck:now.toISOString(),lastAction:'started'}});
   return {ok:true,action:'started',day};
  }catch(e) {
   await chrome.storage.local.set({daily:{...daily,lastCheck:now.toISOString(),lastAction:'error',error:String(e)}});
   throw e;
  }
 } finally {dailyBusy=false;}
}
