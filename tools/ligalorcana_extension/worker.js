importScripts('github.js');
importScripts('daily.js');
/* MV3. Opera�ao exclusivamente na aba existente, via chrome.tabs.update + chrome.scripting. */
const ORIGIN='https://www.ligalorcana.com.br/';
const HOME=ORIGIN+'?view=home'; const EDITIONS=ORIGIN+'?view=cards/edicoes';
const DEFAULT={runToken:null,autoAll:false,running:false,phase:'idle',editions:[],editionIndex:0,cardIndex:0,queue:[],listingUrl:null,listingTotal:null,scanCount:0,editionAudit:{},rows:{},seen:{},pending:{},skipped:{},failures:{},retryPass:false,delay:4000,tabId:null,lastNav:0,lastError:null,log:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CAPTCHA_RETRY_ALARM='inkwell-captcha-recheck';
const CAPTCHA_WAIT_MS=10*60*1000;
const MAX_CAPTCHA_RECHECKS=2;
// The site must remain in the user's normal Chrome tab and session.
function correctedCardUrl(url,attempt=0){
  try{
    const u=new URL(url);
    if(u.hostname!=='www.ligalorcana.com.br')return url;
    const edition=u.searchParams.get('ed'),number=u.searchParams.get('num');
    if(edition==='LOR12'&&number==='121'){
      // Known bad double-encoded entity in legacy LOR12 checkpoint.
      // The working Liga link uses U+2010 (HYPHEN), not a literal HTML entity.
      u.searchParams.set('view','cards/card');
      u.searchParams.set('card','Jack-Jack Parr - Incredible Potential (121)');
      return u.href;
    }
    // LigaLorcana's DLPC1 listing may append its display number twice:
    // "Beast - Snowfield Troublemaker (1/PD1) (1-PD1)".
    // Keep ed=DLPC1 and num=1-PD1 in both candidate URLs and preserve the
    // original listing URL as the checkpoint key.
    if(edition==='DLPC1'&&number){
      const title=u.searchParams.get('card')||'';
      const suffix=title.match(/\s*\(([^()]*)\)\s*$/);
      const printKey=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(suffix && printKey(suffix[1])===printKey(number)){
        const withoutOuter=title.slice(0,suffix.index).trim();
        const inner=withoutOuter.match(/\s*\(([^()]*)\)\s*$/);
        // Only apply this rewrite to a confirmed DOUBLE suffix, never to
        // legitimate printing names or a sole parenthesized label.
        if(inner && printKey(inner[1])===printKey(number)){
          const base=withoutOuter.slice(0,inner.index).trim();
          u.searchParams.set('card',attempt>=1?base:withoutOuter);
          return u.href;
        }
      }
    }
    if(edition==='LOR2'&&number==='34'&&attempt>=1){
      // Verified by the user as an alternate navigation address (NOT as a
      // confirmed printing). The site may drop ed/num. Keep those identifiers
      // from the original listing when parsing, and require an exact match.
      const name=u.searchParams.get('card')||'';
      if(cardNameKey(name.replace(/\s*\(34\)\s*$/,''))==='sleepysflute'){
        return ORIGIN+'?view=cards%2Fcard&card=Sleepy%27s+Flute&tipo=1';
      }
    }
    return url;
  }catch{return url;}
}
function blockEvidence(page){
  const title=String(page?.title||'');
  const first=String(page?.txt||'').slice(0,900);
  // Never scan the entire listing: a card title/description may mention these words.
  const subject=title+'\n'+first;
  if(/(?:^|\s)(?:captcha|verify you are human|verifique que voc� � humano|access denied|acesso negado|error 403|erro 403|too many requests)(?:\s|$|[.:!?])/i.test(subject))return 'challenge_or_access_denied';
  if(/just a moment[..!]?/i.test(title)&&/cloudflare/i.test(subject))return 'cloudflare_challenge';
  return null;
}

class PauseSignal extends Error {constructor(){super('Pausa solicitada');this.name='PauseSignal'}}
async function guard(j){
  const {control}=await chrome.storage.local.get('control');
  if(!control||control.paused||control.token!==j.runToken)throw new PauseSignal();
}

async function load(){return { ...DEFAULT,...(await chrome.storage.local.get('job')).job };}
async function save(j){if(j.running)await guard(j);await chrome.storage.local.set({job:j});return j}
function note(j,msg){j.log=[...(j.log||[]),new Date().toISOString()+' '+msg].slice(-45)}
function safeHost(url){try{let u=new URL(url);return u.protocol==='https:'&&u.hostname==='www.ligalorcana.com.br'}catch{return false}}
function resolved(u){try{return new URL(u,ORIGIN).href}catch{return null}}
function queryValue(url,key){try{return new URL(url).searchParams.get(key)}catch{return null}}
function edOf(url){const direct=queryValue(url,'ed');if(direct)return direct;const card=queryValue(url,'card');return card?.match(/(?:^|\s)ed=([^\s]+)/)?.[1]||null}
const keyOf=(r)=>[r.idcard,r.edition_id,r.num].map(v=>String(v??'').trim()).join('|');
function pausableMessage(s){return !!blockEvidence({txt:s,title:''})}
async function inspect(tabId){
 const [{result}]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:()=>{
  const txt=(document.body?.innerText||'').slice(0,3500);
  const links=[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,label:(a.innerText||a.title||a.getAttribute('aria-label')||'').trim().slice(0,180)})).filter(a=>a.url.startsWith(location.origin));
  let raw=null,rawStatus='missing';
  try{let v=window.cards_editions; if(v!==undefined){raw=JSON.parse(JSON.stringify(v));rawStatus='global'}}catch(e){rawStatus='global error '+String(e)}
  const scripts=raw?[]:[...document.scripts].filter(s=>!s.src&&s.textContent.includes('cards_editions')).slice(0,3).map(s=>s.textContent.slice(0,250000));
  return {url:location.href,title:document.title,txt,links,raw,rawStatus,scripts,ready:document.readyState};
 }});return result;
}
/* Parse arrays or objects assigned in page script without eval or Function: bracket balancing + JSON.parse.
   Non-JSON JavaScript literal intentionally fails closed instead of executing untrusted source. */
function assignedJson(s){const m=/\bcards_editions\s*=\s*/g;let hit;while(hit=m.exec(s)){let i=m.lastIndex;while(/\s/.test(s[i]))i++;if(!'[{' .includes(s[i]))continue;let depth=0,inStr=false,esc=false,q='',end=-1;for(let k=i;k<s.length;k++){let c=s[k];if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===q)inStr=false;continue}if(c==='"'||c==="'"){inStr=true;q=c;continue}if(c==='{'||c==='[')depth++;if(c==='}'||c===']')if(--depth===0){end=k+1;break}}if(end>0){try{return JSON.parse(s.slice(i,end))}catch{}}}return null}
function entries(o){if(Array.isArray(o))return o;if(o&&typeof o==='object')return Object.values(o);return []}
function findRelevant(raw,code,num,name){let arr=entries(raw);for(const a of [...arr]){if(a&&typeof a==='object'&&!('price'in a))arr.push(...entries(a))}return arr.filter(x=>x&&typeof x==='object'&&x.price).sort((a,b)=>Number(String(a.code||a.ed||'').toUpperCase()===code)*-1+Number(String(b.code||b.ed||'').toUpperCase()===code));}
function nprice(v){if(v===null||v===undefined||v==='')return null;let s=String(v).trim().replace(/^R\$\s*/,'');if(/,/.test(s))s=s.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(\.\d{3})+(\.\d{2})$/.test(s))s=s.replace(/\./g,'');let x=Number(s);return Number.isFinite(x)&&x>=0?Math.round(x*100):null}
function extractPart(part){if(part===undefined)return {state:'missing',values:[null,null,null]};if(Array.isArray(part)&&part.length===0)return {state:'no_offers',values:[null,null,null]};if(part===null)return {state:'no_offers',values:[null,null,null]};const obj=Array.isArray(part)?part[0]:part;if(!obj||typeof obj!=='object')return {state:'invalid',values:[null,null,null]};let vs=['p','m','g'].map(k=>nprice(obj[k]));let state=vs.every(v=>v===null)?'no_offers':vs.some(v=>v===null)?'partial':'ok';if(vs.every(v=>v!==null)&&!(vs[0]<=vs[2]&&vs[1]>=vs[0]))state='invalid_order';return {state,values:vs}}
function parseCard(s,ed,source=s.url){let raw=s.raw||s.scripts.map(assignedJson).find(Boolean);if(!raw)return {error:'cards_editions nao acess�vel como vari�vel global ou JSON literal'};
 let code=queryValue(source,'ed')||ed;let num=queryValue(source,'num');let title=(queryValue(source,'card')||'').replace(/\s*\([^()]+\)\s*$/,'').trim();let choices=findRelevant(raw,code,num,title);
 const sameNum=(a,b)=>code.toUpperCase()==='DLPC1'
   ?String(a||'').toUpperCase().replace(/[^A-Z0-9]/g,'')===String(b||'').toUpperCase().replace(/[^A-Z0-9]/g,'')
   :String(a)===String(b);
 const match=choices.filter(c=>sameNum(c.num??c.number,num)&&String(c.code||c.ed||code).toUpperCase()===code.toUpperCase());
 // Generic name/type routes may present several editions. Never accept an
 // unrelated single entry when the user-provided fallback omits ed/num.
 const isNameFallback=(code==='LOR2'&&String(num)==='34'&&queryValue(s.url,'tipo')==='1'&&!queryValue(s.url,'ed')&&!queryValue(s.url,'num'));
 let found=match.length===1?match[0]:(isNameFallback||code.toUpperCase()==='DLPC1'?null:choices.length===1?choices[0]:null);
 if(!found)return {error:'identifica�ao amb�gua para impressao',debug:{choices:choices.length,matched:match.length,code,num,title,isNameFallback}};
 let idcard=found.idcard??found.id_card??found.card_id;let edition_id=found.id??found.edition_id??found.idedition;
 if(idcard===undefined||edition_id===undefined||num===null)return {error:'idcard, id da edi�ao ou n�mero ausente',debug:Object.keys(found)};
 let p=found.price||{};let normal=extractPart(p['0']),foil=extractPart(p['2']);let edition_name=String(found.name||found.nome||'').trim();let name=title;
 if(!name||normal.state==='invalid'||foil.state==='invalid')return {error:'pre�os ou nome inv�lidos',debug:{name,normal,foil}};
 return {row:{idcard:String(idcard),edition_id:String(edition_id),idkey:found.idkey??null,code:found.code??code,num:String(num),name,edition_name,url:source,captured_at:new Date().toISOString(),normal_status:normal.state,normal_min_centavos:normal.values[0],normal_med_centavos:normal.values[1],normal_max_centavos:normal.values[2],foil_status:foil.state,foil_min_centavos:foil.values[0],foil_med_centavos:foil.values[1],foil_max_centavos:foil.values[2]}};
}
// Individual-card failures are isolated. Never fabricate a price or mark failed URLs as captured.
const MAX_CARD_READ_TRIES=3;
function transientCardFailure(message){return /cards_editions|identifica�ao amb�gua|idcard, id da edi�ao|pre�os ou nome inv�lidos/i.test(message||'')}
// Known inaccessible printing, verified as a search page rather than a card detail.
const KNOWN_UNAVAILABLE=[{edition:'DLPC1',num:'1-PD1',name:'Beast - Snowfield Troublemaker'}];
function knownUnavailable(url){
 if(!safeHost(url))return null;
 const edition=(queryValue(url,'ed')||'').toUpperCase();
 const num=(queryValue(url,'num')||'').toUpperCase();
 return KNOWN_UNAVAILABLE.find(x=>x.edition===edition&&x.num===num)||null;
}
function quarantineKnown(j,url){
 const known=knownUnavailable(url);if(!known)return false;
 j.skipped=j.skipped||{};
 if(!j.skipped[url])note(j,'IGNORADA '+known.edition+' '+known.num+': p�gina individual indispon�vel na Liga');
 j.skipped[url]=j.skipped[url]||{edition:known.edition,num:known.num,url,reason:'P�gina de detalhe indispon�vel; a Liga retorna busca. Sem pre�o coletado.',recorded_at:new Date().toISOString()};
 delete j.pending?.[url];delete j.failures?.[url];
 const a=j.editionAudit?.[known.edition];
 if(a){a.skipped_urls=Object.values(j.skipped).filter(x=>x.edition===known.edition).length;a.failed_urls=Math.max(0,(a.queued_urls||0)-(a.captured_urls||0)-a.skipped_urls);a.verified=false;}
 return true;
}
function recordMissing(j,ed,url,error){
 const previous=j.pending||{};
 previous[url]={edition:ed,url,reason:String(error).slice(0,300),attempts:(j.failures||{})[url]||0,last_attempt_at:new Date().toISOString()};
 j.pending=previous;
 note(j,ed+' PENDENTE '+(j.cardIndex+1)+'/'+j.queue.length+': '+String(error).slice(0,120));
}
function sourceUrl(s,j){
 // Listing links carry printing IDs even when the site rewrites its address bar.
 const listed=j?.queue?.[j.cardIndex];
  if(listed && safeHost(listed) && queryValue(listed,'ed') && queryValue(listed,'num')){
    const fixed=correctedCardUrl(listed,j.failures?.[listed]||0);
    // LOR2-34's alternate landing intentionally lacks ed/num: preserve the
    // original printing identity instead of assigning a different card.
    return queryValue(fixed,'ed')&&queryValue(fixed,'num')?fixed:listed;
  }
 return s.url;
}
function cardNameKey(x){
 return String(x||'').normalize('NFKD').replace(/[--?--?-]/g,'-')
  .replace(/&(?:amp;)?(?:#0*8208;|#x2010;)/gi,'-')
  .toLowerCase().replace(/[^a-z0-9]+/g,'');
}
function sameCardPage(page,target){
 if(page.url===target)return true;
 if(queryValue(page.url,'view')!=='cards/card')return false;
 const expected=(queryValue(target,'card')||'').replace(/\s*\([^()]+\)\s*$/,'').trim();
 const actual=queryValue(page.url,'card')||'';
 // When LigaLorcana changes the URL (drops ed/num), require exact card name match.
 return !!expected && cardNameKey(expected)===cardNameKey(actual);
}
// Compare exact edition codes, not substrings: LOR1 must never match LOR10-LOR14.
function isEditionLink(l,ed){
 try{
  const u=new URL(l.url);
  return safeHost(u.href)&&u.searchParams.get('view')==='cards/search'&&
    (edOf(u.href)||'').toUpperCase()===String(ed).toUpperCase();
 }catch{return false}
}
// The LigaLorcana LOR1 listing has its own canonical edid=1 route.
const DIRECT_LISTING_URLS={LOR1:ORIGIN+'?view=cards/search&card=edid=1%20ed=LOR1'};
function editionListingUrl(ed,links){
 return DIRECT_LISTING_URLS[ed]||(links||[]).find(l=>isEditionLink(l,ed))?.url||null;
}
function editionCodes(links){
 const seen=new Set();const result=[];
 for(const item of links){
   if(!/view=cards\/(?:search|edicoes)/i.test(item.url))continue;
   const raw=decodeURIComponent(item.url+' '+item.label);
   let code=(raw.match(/(?:^|[\s&?])ed=([A-Z][A-Z0-9]{1,9})/i)||[])[1];
   if(!code)code=(raw.match(/\b(LOR\d{1,3}|D23|D100)\b/i)||[])[1];
   if(code){code=code.toUpperCase();if(!seen.has(code)){result.push(code);seen.add(code)}}
 }
 return result;
}
function cardLinks(s,ed){return s.links.filter(l=>{let u=l.url;return /view=cards\/card/i.test(u)&&((edOf(u)||'').toUpperCase()===ed)}).map(l=>l.url).filter((x,i,a)=>a.indexOf(x)===i)}

// Rola a pr�pria aba existente, inclusive cont�ineres de listagem com overflow.
// Nao gera requisi�oes de rede independentes, nao contorna controles do site.
async function scrollListing(tabId){
 const [{result}]=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>{
   const before={height:document.documentElement.scrollHeight,top:window.scrollY};
   const nodes=[...document.querySelectorAll('main,section,div,ul')].filter(el=>{
     const st=getComputedStyle(el);return /auto|scroll/i.test(st.overflowY)&&el.scrollHeight>el.clientHeight+80&&el.clientHeight>120;
   }).sort((a,b)=>b.scrollHeight-a.scrollHeight).slice(0,5);
   nodes.forEach(n=>{n.scrollTop=n.scrollHeight; n.dispatchEvent(new Event('scroll',{bubbles:true}));});
   window.scrollTo(0,document.documentElement.scrollHeight);
   window.dispatchEvent(new Event('scroll'));
   return {before,containers:nodes.length,height:document.documentElement.scrollHeight};
 }});return result;
}
function expectedFromText(text){
 const matches=[...String(text||'').matchAll(/(?:^|\s)([1-9]\d{0,4})\s*(?:cartas?|cards?|resultados?|itens?)\b/gi)].map(m=>Number(m[1]));
 return matches.length?Math.max(...matches):null;
}
async function scanListing(j,ed){
 let all=[],stable=0,lastSize=-1,lastHeight=-1,expected=null;
 // At� 110 intera�oes: 6.000 ms entre elas, 2 s para a interface carregar.
 for(let i=0;i<110;i++){
   await guard(j);
   const page=await inspect(j.tabId);
   if(blockEvidence(page))throw Error('SUSPECTED_CAPTCHA: listagem '+blockEvidence(page));
   if(!/view=cards\/search/i.test(page.url))throw Error('Listagem mudou de endere�o durante a rolagem');
   all=[...new Set([...all,...cardLinks(page,ed)])];
   expected=expectedFromText(page.txt)||expected;
   await guard(j);const state=await scrollListing(j.tabId);
   if(all.length===lastSize&&state.height===lastHeight)stable++;else stable=0;
   lastSize=all.length;lastHeight=state.height;
   if(i===0||i%5===0){j.scanCount=all.length;j.listingTotal=expected;note(j,ed+' rolagem '+i+': '+all.length+(expected?' / '+expected:''));await save(j)}
   if(expected&&all.length>=expected&&stable>=2)break;
   if(stable>=6)break;
   await sleep(Math.max(2000,j.delay));
 }
 if(!all.length)throw Error('Nenhum link de carta encontrado em '+ed);
 if(expected&&all.length<expected)throw Error(ed+': lista incompleta: '+all.length+' links para '+expected+' cartas informadas. Dados preservados; revisar rolagem.');
 // Nenhum total confi�vel na p�gina: NAO declarar conclusao sem checagem posterior.
 return {urls:all,expected};
}

async function navigate(j,url){if(!safeHost(url))throw Error('URL fora do dom�nio autorizado: '+url);await guard(j);let wait=Math.max(0,j.delay-(Date.now()-j.lastNav));if(wait)await sleep(wait);await guard(j);let t=await chrome.tabs.get(j.tabId);if(!t)throw Error('aba existente fechada');await chrome.tabs.update(j.tabId,{url});j.lastNav=Date.now();await save(j);await sleep(2600);for(let i=0;i<22;i++){let t=await chrome.tabs.get(j.tabId);if(t.status==='complete')break;await sleep(500)}await sleep(1000);}
async function stop(j,error){
 await chrome.storage.local.set({control:{token:j.runToken||null,paused:true}});
 await chrome.alarms.clear(CAPTCHA_RETRY_ALARM);
 j=await load();
 if(j.phase!=='paused'&&j.phase!=='captcha_wait')j.resumePhase=j.phase;
 j.running=false;j.phase='paused';j.lastError=error;
 note(j,'PARADO: '+error);await save(j);
}
async function deferSuspectedCaptcha(j,reason){
 // A genuine challenge must be completed manually; this timer only checks again.
 j.resumePhase=j.phase==='captcha_wait'?(j.resumePhase||'card'):j.phase;
 j.captchaChecks=(j.captchaChecks||0)+1;
 j.captchaReason=reason;
 j.captchaUntil=Date.now()+CAPTCHA_WAIT_MS;
 j.phase='captcha_wait';j.running=false;
 j.lastError='Poss�vel CAPTCHA: aguardando 10 min; verifica�ao '+j.captchaChecks+'/'+MAX_CAPTCHA_RECHECKS;
 note(j,j.lastError+' ('+reason+'); checkpoint preservado');
 await chrome.storage.local.set({job:j});
 await chrome.alarms.create(CAPTCHA_RETRY_ALARM,{when:j.captchaUntil});
}
async function resumeAfterCaptcha(){
 let j=await load();if(j.phase!=='captcha_wait')return;
 if(j.captchaUntil>Date.now()+1000){
   await chrome.alarms.create(CAPTCHA_RETRY_ALARM,{when:j.captchaUntil});return;
 }
 const control=(await chrome.storage.local.get('control')).control;
 if(!control||control.paused||control.token!==j.runToken){await stop(j,'Retomada de CAPTCHA cancelada manualmente');return;}
 let tab;
 try{tab=await chrome.tabs.get(j.tabId)}catch{await stop(j,'Aba de coleta fechada; reabra a LigaLorcana e retome');return;}
 if(!safeHost(tab.url||'')){await stop(j,'Aba fora da LigaLorcana; interven�ao necess�ria');return;}
 try{
   const before=await inspect(j.tabId);
   // Never refresh a visible CAPTCHA. Do not automate solving access challenges.
   if(blockEvidence(before)){
     if(j.captchaChecks>=MAX_CAPTCHA_RECHECKS){await stop(j,'CAPTCHA/bloqueio persistente ap�s duas verifica�oes; interven�ao manual necess�ria');return;}
     await deferSuspectedCaptcha(j,'desafio continua vis�vel');return;
   }
   await chrome.tabs.reload(j.tabId);
   await sleep(2500);
   const after=await inspect(j.tabId);
   if(blockEvidence(after)){
     if(j.captchaChecks>=MAX_CAPTCHA_RECHECKS){await stop(j,'Desafio real ap�s atualiza�ao; interven�ao manual necess�ria');return;}
     await deferSuspectedCaptcha(j,'desafio identificado ap�s refresh');return;
   }
   j.phase=j.resumePhase||'card';j.running=true;j.lastError=null;
   note(j,'P�gina acess�vel; retomada autom�tica no checkpoint '+j.phase);
   await save(j);pump();
 }catch(e){await stop(j,'Falha ao verificar p�gina ap�s 10 minutos: '+String(e));}
}

let active=false;
async function pump(){if(active)return;active=true;try{let j=await load();while(j.running){try{await guard(j);let t=await chrome.tabs.get(j.tabId);if(!safeHost(t.url||''))throw Error('A aba saiu da LigaLorcana');let s=await inspect(j.tabId);if(blockEvidence(s))throw Error('SUSPECTED_CAPTCHA: '+blockEvidence(s));
  // Auto-discovery must run before an empty queue is treated as completion.
  // In autoAll mode the initial queue is intentionally empty.
  const isDiscoveryPhase=['home','editions','discoverEditions'].includes(j.phase)&&j.autoAll&&j.editions.length===0;
  if(!isDiscoveryPhase&&j.phase!=='retryPending'&&!j.editions.length)throw Error('Fila de edi�oes vazia: descoberta nao conclu�da. Nenhuma coleta foi iniciada.');
  // End of a pending-recovery queue must be processed by the recovery
  // finalizer below, never by the normal edition-completion branch.
  const retryItem=j.phase==='retryPending'&&j.cardIndex<j.queue.length?j.queue[j.cardIndex]:null;
  const ed=j.phase==='retryPending'?(retryItem?(j.pending?.[retryItem]?.edition||edOf(retryItem)||'UNKNOWN'):null):j.editions[j.editionIndex];
  if(!isDiscoveryPhase&&!ed&&j.phase!=='retryPending'){
   if(!Object.keys(j.rows).length)throw Error('Conclusao bloqueada: nenhuma carta coletada.');
   if(Object.keys(j.pending||{}).length&&!j.retryPass){
    // Revisit only failed URLs once, not the whole edition. Record outcomes without faking data.
    j.retryPass=true;j.queue=Object.keys(j.pending).filter(u=>!j.skipped?.[u]);j.cardIndex=0;
    j.phase='retryPending';note(j,'Revisao de '+j.queue.length+' cartas pendentes ap�s todas as edi�oes');await save(j);continue;
   }
   j.running=false;j.phase=Object.keys(j.pending||{}).length?'needs_review':'complete';
   note(j,j.phase==='complete'?'Todas as edi�oes capturadas':'Coleta terminada com '+Object.keys(j.pending).length+' cartas pendentes');
   await save(j);await exportSnapshot(j);await maybeAutoUpload(j);break;
  }
  if(j.phase==='home'){await navigate(j,HOME);j.phase='editions';await save(j);continue}
  if(j.phase==='editions'){await navigate(j,EDITIONS);j.phase=j.autoAll&&j.editions.length===0?'discoverEditions':'chooseEdition';await save(j);continue}
  if(j.phase==='discoverEditions'){
   const found=editionCodes(s.links);
   if(found.length<20)throw Error('Descoberta incompleta: somente '+found.length+' edi�oes encontradas. Nenhuma coleta iniciada; confira a p�gina de Edi�oes.');
   j.editions=found.filter(x=>!j.editions.includes(x));
   j.editionIndex=0;
   j.phase='chooseEdition';note(j,'Fila autom�tica descoberta: '+j.editions.join(','));await save(j);continue;
  }
  if(j.phase==='chooseEdition'){
   const chosen=editionListingUrl(ed,s.links);
   if(!chosen)throw Error('Nao foi poss�vel identificar o link exato da edi�ao '+ed+' na p�gina de edi�oes; parada segura');
   await navigate(j,chosen);j.phase='listing';j.listingUrl=chosen;j.queue=[];j.cardIndex=0;await save(j);continue;
  }
  if(j.phase==='listing'){
   // A paused legacy run may already be on LOR10 due to the old LOR1 prefix bug.
   // Correct only that listing, never clear previously captured cards or audits.
   const actual=(edOf(s.url)||'').toUpperCase();
   if(actual!==String(ed).toUpperCase()){
    const recovery=ed==='LOR1'?DIRECT_LISTING_URLS.LOR1:null;
    if(!recovery)throw Error('Listagem divergente: esperado '+ed+', encontrado '+(actual||'desconhecido')+'; nao coletar cartas da edi�ao errada.');
    note(j,'LOR1: corrigindo listagem anterior '+(actual||'sem c�digo')+' para edid=1; registros preservados');
    await navigate(j,recovery);j.listingUrl=recovery;await save(j);continue;
   }
   const scan=await scanListing(j,ed);j.queue=scan.urls;j.listingTotal=scan.expected;j.scanCount=j.queue.length;note(j,ed+': rolagem terminada com '+j.queue.length+' URLs'+(scan.expected?' de '+scan.expected:' (total nao informado)'));j.phase='card';await save(j);continue;
  }
  if(j.phase==='card'||j.phase==='retryPending'){
   if(j.cardIndex>=j.queue.length){if(j.phase==='retryPending'){
     const remaining=Object.keys(j.pending||{}).length;
     const suspended=j.retryPrevious;
     j.retryPrevious=null;j.retryPass=true;
     if(suspended){
       // Restore the user's interrupted edition, without resuming it behind their back.
       for(const [key,value] of Object.entries(suspended))j[key]=value;
       j.phase='paused';j.running=false;
       await chrome.storage.local.set({control:{token:j.runToken,paused:true}});
       note(j,'Recupera�ao conclu�da; '+remaining+' pend�ncia(s). Lote anterior preservado e PAUSADO.');
     }else{
       j.running=false;j.phase=remaining?'needs_review':'complete';
       j.queue=[];j.cardIndex=0;
       note(j,'Recupera�ao conclu�da; '+remaining+' pend�ncia(s) restante(s).');
     }
     await save(j);await exportSnapshot(j);await maybeAutoUpload(j);break;
    }const failed=j.queue.filter(u=>j.pending?.[u]);const captured=j.queue.filter(u=>j.seen?.[u]).length;const skipped=j.queue.filter(u=>j.skipped?.[u]).length;j.editionAudit[ed]={captured_urls:captured,failed_urls:failed.length,skipped_urls:skipped,queued_urls:j.queue.length,expected:j.listingTotal,verified:failed.length===0&&skipped===0&&j.listingTotal!==null&&captured===j.listingTotal,recorded_at:new Date().toISOString()};note(j,ed+': '+captured+' capturadas, '+failed.length+' pendentes (fila '+j.queue.length+')');j.editionIndex++;j.cardIndex=0;j.queue=[];j.phase='home';await save(j);await maybeCheckpointUpload(j);continue}
   let url=j.queue[j.cardIndex];if(quarantineKnown(j,url)){j.cardIndex++;await save(j);continue}if(j.seen[url]){j.cardIndex++;await save(j);continue}
   // Change only the failing card's URL between retries, never the edition queue.
   const targetUrl=correctedCardUrl(url,j.failures?.[url]||0);
   if(!sameCardPage(s,targetUrl)){await navigate(j,targetUrl);continue}
   let out=parseCard(s,ed,sourceUrl(s,j));
   if(out.error){
    // CAPTCHA/403 are stopped above; a single malformed card never aborts the whole edition.
    const attempts=(j.failures?.[url]||0)+1;
    j.failures={...(j.failures||{}),[url]:attempts};
    if(attempts<MAX_CARD_READ_TRIES && transientCardFailure(out.error)){
      note(j,ed+' carta '+(j.cardIndex+1)+' tentativa '+attempts+'/'+MAX_CARD_READ_TRIES+': '+out.error);
      await save(j);await navigate(j,correctedCardUrl(url,attempts));continue;
    }
    recordMissing(j,ed,url,out.error+' '+JSON.stringify({
      ...(out.debug||{}),url:s.url,rawStatus:s.rawStatus,inlineScripts:s.scripts?.length||0,
      documentTitle:String(s.title||'').slice(0,80)
    }));
    delete j.failures[url];j.cardIndex++;await save(j);
    if(j.cardIndex<j.queue.length){if(j.listingUrl)await navigate(j,j.listingUrl);await navigate(j,correctedCardUrl(j.queue[j.cardIndex]));}
    continue;
   }
   if(j.pending?.[url])delete j.pending[url];
   if(j.failures?.[url])delete j.failures[url];
   let k=keyOf(out.row);if(!out.row.idcard||!out.row.edition_id||!out.row.num)throw Error('Chave composta incompleta');
   if(j.rows[k]&&j.rows[k].url!==out.row.url)throw Error('Conflito de identifica�ao '+k+' URLs distintas');
   j.rows[k]=out.row;j.seen[url]=k;j.seen[out.row.url]=k;
   if(j.phase==='retryPending'&&j.editionAudit?.[ed]){
     const audit=j.editionAudit[ed];audit.captured_urls=(audit.captured_urls||0)+1;
     audit.failed_urls=Math.max(0,(audit.failed_urls||0)-1);
     audit.verified=audit.failed_urls===0&&!audit.skipped_urls&&audit.expected!==null&&audit.captured_urls===audit.expected;
   }
   j.cardIndex++;j.lastError=null;note(j,ed+' '+j.cardIndex+'/'+j.queue.length+' '+out.row.name+(out.row.normal_status==='invalid_order'||out.row.foil_status==='invalid_order'?' [PRE�OS FORA DE ORDEM - REVISAR]':''));await save(j);
   // Navega�ao de volta � listagem por aba existente (sem novo perfil), para manter sequ�ncia expl�cita.
   if(j.cardIndex<j.queue.length){if(j.listingUrl)await navigate(j,j.listingUrl);await navigate(j,correctedCardUrl(j.queue[j.cardIndex]));}
   continue;
  }
  throw Error('Estado desconhecido '+j.phase);
 }catch(e){if(e instanceof PauseSignal)break;if(String(e).includes('SUSPECTED_CAPTCHA'))await deferSuspectedCaptcha(j,String(e));else await stop(j,String(e));break}}
 }finally{active=false}}
async function maybeCheckpointUpload(j){
 const {githubAutoUpload}=await chrome.storage.local.get('githubAutoUpload');
 if(!githubAutoUpload||!Object.keys(j.rows).length)return;
 try {const res=await ghUpload(j);note(j,'Checkpoint da edi�ao enviado ao GitHub: '+res.records+' registros');}
 catch(e){note(j,'Checkpoint GitHub indispon�vel, dados locais preservados: '+String(e).slice(0,160));}
 await save(j);
}
async function maybeAutoUpload(j){
 const {githubAutoUpload}=await chrome.storage.local.get('githubAutoUpload');
 if(!githubAutoUpload)return;
 try{const result=await ghUpload(j);note(j,'Backup enviado ao GitHub: '+result.file);}
 catch(err){note(j,'UPLOAD FALHOU (backup local mantido): '+String(err));}
 await chrome.storage.local.set({job:j});
}
async function exportSnapshot(j){
 const rows=Object.values(j.rows);if(!rows.length)return;
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const payload=JSON.stringify({schema:'inkwell-ligalorcana-local-v1',exported_at:new Date().toISOString(),total:rows.length,editionAudit:j.editionAudit,pending:Object.values(j.pending||{}),skipped:Object.values(j.skipped||{}),records:rows},null,2);
 await download(payload,'coleta_'+stamp+'.json','application/json');
 await download(csv(rows),'coleta_'+stamp+'.csv','text/csv');
}
function csvEscape(s){return '"'+String(s??'').replace(/"/g,'""')+'"'}
function csv(rows){const cols=['idcard','edition_id','idkey','code','num','name','edition_name','url','captured_at','normal_status','normal_min_centavos','normal_med_centavos','normal_max_centavos','foil_status','foil_min_centavos','foil_med_centavos','foil_max_centavos'];return '\uFEFF'+[cols.join(';'),...rows.map(r=>cols.map(c=>csvEscape(r[c])).join(';'))].join('\r\n')}
async function download(text,filename,type){const blob=new Blob([text],{type});const data=await blob.arrayBuffer();const bytes=new Uint8Array(data);let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.slice(i,i+8192));return chrome.downloads.download({url:'data:'+type+';base64,'+btoa(bin),filename:'Inkwell_LigaLorcana/'+filename,saveAs:false,conflictAction:'uniquify'})}
async function handleMessage(msg){
 if(msg.cmd==='dailyStatus')return dailyStatus();
 if(msg.cmd==='dailyConfigure')return configureDaily(msg.enabled);
 if(msg.cmd==='dailyTick')return dailyTick({dryRun:!!msg.dryRun});
 let j=await load();if(msg.cmd==='githubConnect')return await ghConnect(msg.clientId);
 if(msg.cmd==='githubDisconnect')return await ghDisconnect();
 if(msg.cmd==='githubUpload')return await ghUpload(j);
 if(msg.cmd==='githubAuto'){await chrome.storage.local.set({githubAutoUpload:!!msg.enabled});return {ok:true,enabled:!!msg.enabled};}
 if(msg.cmd==='githubStatus')return await ghStatus();
 if(msg.cmd==='status')return {captchaUntil:j.captchaUntil||null,captchaChecks:j.captchaChecks||0,autoAll:j.autoAll,editions:j.editions,editionIndex:j.editionIndex,phase:j.phase,running:j.running,edition:j.editions[j.editionIndex],index:j.cardIndex,queue:j.queue.length,listingTotal:j.listingTotal,scanCount:j.scanCount,editionAudit:j.editionAudit,skipped:Object.values(j.skipped||{}),stored:Object.keys(j.rows).length,pending:Object.keys(j.pending||{}).length,pendingCards:Object.values(j.pending||{}).slice(-8),retryPass:!!j.retryPass,lastError:j.lastError,log:j.log.slice(-10)};
 if(msg.cmd==='copyLog'){return {ok:true,diagnostic:{version:'0.8.14',date:new Date().toISOString(),phase:j.phase,index:j.cardIndex,queue:j.queue.length,stored:Object.keys(j.rows||{}).length,pendingCards:Object.values(j.pending||{}),skippedCards:Object.values(j.skipped||{}),editionAudit:j.editionAudit,lastError:j.lastError,log:j.log||[]}};}
 if(msg.cmd==='pause'){await stop(j,'Pausado manualmente');return {ok:true,phase:'paused',stored:Object.keys((await load()).rows).length}}
 if(msg.cmd==='import'){
  if(j.running)throw Error('Pause a coleta antes de restaurar');
  const payload=msg.payload;
  if(!payload||payload.schema!=='inkwell-ligalorcana-local-v1'||!Array.isArray(payload.records))throw Error('JSON de coleta inv�lido: schema ou records ausentes');
  if(payload.records.length>10000)throw Error('Arquivo excede o limite de 10.000 registros');
  let imported=0,existing=0;
  const rows={...j.rows},seen={...j.seen};
  for(const r of payload.records){
    if(!r||typeof r!=='object'||!['string','number'].includes(typeof r.idcard)||!['string','number'].includes(typeof r.edition_id)||!['string','number'].includes(typeof r.num)||typeof r.code!=='string'||typeof r.url!=='string'||typeof r.captured_at!=='string')throw Error('Registro inv�lido no arquivo: identifica�ao obrigat�ria ausente');
    if(!safeHost(r.url)||!Number.isFinite(Date.parse(r.captured_at))||String(queryValue(r.url,'num'))!==String(r.num)||String(queryValue(r.url,'ed')).toUpperCase()!==String(r.code).toUpperCase())throw Error('Registro inv�lido: URL, edi�ao, n�mero ou hor�rio divergente');
    for(const kind of ['normal','foil']){
      const st=r[kind+'_status'];if(!['ok','no_offers','partial','missing','invalid_order'].includes(st))throw Error('Estado de pre�o inv�lido: '+st);
      const vals=['min','med','max'].map(x=>r[kind+'_'+x+'_centavos']);
      if(vals.some(v=>v!==null&&(!Number.isInteger(v)||v<0)))throw Error('Pre�o inv�lido');
      if(st==='ok'&&(vals.some(v=>v===null)||vals[0]>vals[1]||vals[0]>vals[2]))throw Error('Ordem de pre�os inv�lida');
      if(st==='invalid_order'&&(vals.some(v=>v===null)||vals[0]<=vals[1]&&vals[0]<=vals[2]))throw Error('Status invalid_order inconsistente');
      if(st==='no_offers'&&vals.some(v=>v!==null))throw Error('Sem ofertas com pre�o preenchido');
    }
    const k=keyOf(r);if(!k||k.includes('undefined'))throw Error('Chave inv�lida');
    if(rows[k]){
      if(rows[k].url!==r.url)throw Error('Colisao de impressao '+k);
      existing++;
    }else{rows[k]=r;imported++}
    if(seen[r.url]&&seen[r.url]!==k)throw Error('Colisao de URL '+r.url);
    seen[r.url]=k;
  }
  j.rows=rows;j.seen=seen;
  if(payload.editionAudit&&typeof payload.editionAudit==='object')j.editionAudit={...j.editionAudit,...payload.editionAudit};
  if(Array.isArray(payload.pending)){
    const restored={...j.pending};
    for(const x of payload.pending){
      if(!x||!safeHost(x.url)||typeof x.edition!=='string')continue;
      restored[x.url]={edition:x.edition,url:x.url,reason:String(x.reason||'').slice(0,300),attempts:Number(x.attempts)||0,last_attempt_at:x.last_attempt_at||null};
    }
    j.pending=restored;
  }
  j.phase='idle';j.running=false;j.editions=[];j.editionIndex=0;j.queue=[];j.listingUrl=null;j.listingTotal=null;j.scanCount=0;j.cardIndex=0;j.lastError=null;
  note(j,'Backup restaurado: '+imported+' novas, '+existing+' j� existentes; datas originais preservadas');
  await save(j);return {ok:true,imported,existing,stored:Object.keys(rows).length};
 }
 if(msg.cmd==='diagnostic'){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const audit=Object.fromEntries(Object.entries(j.editionAudit||{}).map(([code,value])=>[code,{
    queued_urls:value.queued_urls??null,captured_urls:value.captured_urls??null,
    failed_urls:value.failed_urls??null,verified:!!value.verified
  }]));
  const diagnostics={version:'0.8.14',date:new Date().toISOString(),phase:j.phase,
    activeEdition:j.editions?.[j.editionIndex]||null,stored:Object.keys(j.rows||{}).length,
    pending:Object.values(j.pending||{}).map(x=>({edition:x.edition,num:queryValue(x.url,'num'),
      url:x.url,attempts:x.attempts,reason:x.reason,last_attempt_at:x.last_attempt_at})),
    editionAudit:audit,skipped:Object.values(j.skipped||{}),lastError:j.lastError,log:(j.log||[]).slice(-35)};
  await download(JSON.stringify(diagnostics,null,2),'diagnostico_'+stamp+'.json','application/json');
  return {ok:true,message:'Relat�rio JSON de erros exportado; nenhuma carta foi alterada.'};
 }
 if(msg.cmd==='retryPending'){
  if(active||j.running)throw Error('Pause a coleta antes de recuperar pendentes.');
  if(j.phase==='captcha_wait')throw Error('Existe uma verifica�ao de acesso pendente; resolva-a manualmente antes de recuperar cartas.');
  const pendingUrls=Object.keys(j.pending||{}).filter(safeHost);
  for(const u of Object.keys(j.pending||{})){if(knownUnavailable(u))quarantineKnown(j,u)}
  const retryUrls=pendingUrls.filter(u=>!j.skipped?.[u]);
  if(!retryUrls.length){if(!Object.keys(j.pending||{}).length){j.lastError=null;note(j,'Recupera�ao sem pend�ncias: erros anteriores permanecem apenas no hist�rico.');}await chrome.storage.local.set({job:j});return {ok:true,message:'Nenhuma carta restante para recuperar; registros preservados.',pending:0}};
  if(!pendingUrls.length)return {ok:true,message:'Nao existem cartas pendentes para recuperar.',pending:0};
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab||!safeHost(tab.url||''))throw Error('Selecione a aba da LigaLorcana antes de recuperar pendentes.');
  // Snapshot ONLY cursor/selection fields. Rows, audit and pending stay shared and
  // are updated by recovery, even when the user had paused in the middle of LOR6.
  const hadInterruptedRun=(j.phase==='paused'&&j.resumePhase!=='retryPending'&&Array.isArray(j.editions)&&j.editions.length>0&&
    Number.isInteger(j.editionIndex)&&j.editionIndex<j.editions.length);
  const previousKeys=['autoAll','editions','editionIndex','cardIndex','queue','listingUrl',
    'listingTotal','scanCount','retryPass','resumePhase','delay','tabId','lastNav'];
  const suspended=hadInterruptedRun?Object.fromEntries(previousKeys.map(k=>[k,j[k]])):null;
  j.retryPrevious=suspended;
  j.runToken=String(Date.now())+'-'+Math.random().toString(36).slice(2);
  j.tabId=tab.id;j.queue=retryUrls;j.cardIndex=0;j.listingUrl=null;j.listingTotal=null;
  j.retryPass=true;j.phase='retryPending';j.running=true;j.lastError=null;
  j.delay=Math.min(60000,Math.max(4000,Number(j.delay)||4000));
  j.failures={};
  await chrome.storage.local.set({control:{token:j.runToken,paused:false}});
  note(j,'Recupera�ao isolada iniciada: '+retryUrls.length+' pend�ncia(s); lote anterior preservado.');
  await save(j);pump();
  return {ok:true,message:'Recupera�ao iniciada para '+retryUrls.length+' pend�ncia(s); coleta anterior preservada.',pending:retryUrls.length};
 }
 if(msg.cmd==='clear'){if(j.running)throw Error('Pause primeiro');await save({...DEFAULT});return {ok:true}}
 if(msg.cmd==='start'){
  if(active)return {error:'Execu�ao anterior ainda encerrando. Abra novamente a extensao e tente em seguida.'};
  if(j.running)return {error:'Coleta j� ativa'};
  let [tab]=await chrome.tabs.query(msg.daily?{url:ORIGIN+'*'}:{active:true,currentWindow:true});
  if(!tab&&msg.daily)tab=await chrome.tabs.create({url:HOME,active:false});
  if(!tab||!safeHost(tab.url||''))throw Error('Selecione a aba da LigaLorcana antes de iniciar');
  const autoAll=!!msg.autoAll;const editions=[...new Set((msg.editions||[]).filter(s=>/^[A-Z][A-Z0-9]{1,9}$/.test(s)))];if(!editions.length&&!autoAll)throw Error('Informe edi�oes v�lidas');
  const delay=Math.min(60000,Math.max(4000,Number(msg.delay)||4000));
  const pausedPhase=j.resumePhase||j.phase;
  const unfinishedRetry=pausedPhase==='retryPending'&&j.cardIndex<(j.queue||[]).length&&
    (j.queue||[]).slice(j.cardIndex).some(u=>safeHost(u)&&!j.skipped?.[u]&&j.pending?.[u]);
  const unfinishedEdition=pausedPhase!=='retryPending'&&Array.isArray(j.editions)&&
    j.editionIndex<j.editions.length;
  // A finished retry queue (including a 1/1 skipped printing) is NOT a
  // resumable edition. Starting again must honor the user's new selection.
  const canResume=['paused','captcha_wait'].includes(j.phase)&&
    (unfinishedRetry||unfinishedEdition)&&autoAll===!!j.autoAll&&
    (autoAll||j.editions.join(',')===editions.join(','));
  if(canResume){
    await chrome.alarms.clear(CAPTCHA_RETRY_ALARM);
    j.tabId=tab.id;j.delay=delay;j.captchaChecks=0;
    j.phase=pausedPhase;j.running=true;j.lastError=null;
    note(j,'Retomada no estado '+j.phase+' sem zerar o checkpoint');
  }else{
    const oldRows=j.rows,oldAudit=j.editionAudit,oldSkipped=j.skipped;
    // A new batch MUST revisit every URL, including cards captured yesterday.
    // Keep old rows as a safety net; recapture replaces them after a successful parse.
    // Do not carry old pending/failure URLs into the new day's recovery queue.
    j={...DEFAULT,rows:oldRows,seen:{},pending:{},skipped:oldSkipped||{},
      editionAudit:oldAudit||{},editions:autoAll?[]:editions,autoAll,tabId:tab.id,delay,running:true,phase:'home'};
    note(j,'Novo lote de atualiza�ao '+(autoAll?'descoberta autom�tica':editions.join(','))+'; URLs liberadas para recaptura, preservados '+Object.keys(oldRows).length+' registros anteriores');
  }
  j.runToken=String(Date.now())+'-'+Math.random().toString(36).slice(2);await chrome.storage.local.set({control:{token:j.runToken,paused:false}});await save(j);pump();return {ok:true,phase:j.phase,stored:Object.keys(j.rows).length};
 }
 if(msg.cmd==='captureCurrent'){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab||!safeHost(tab.url||''))throw Error('Selecione a aba da LigaLorcana');const snap=await inspect(tab.id);if(!/view=cards\/card/i.test(snap.url))throw Error('Abra uma carta individual');const out=parseCard(snap,queryValue(snap.url,'ed')||'');if(out.error)return out;const k=keyOf(out.row);if(j.rows[k]&&j.rows[k].url!==out.row.url)throw Error('Colisao de identidade: '+k);j.rows[k]=out.row;j.seen[snap.url]=k;note(j,'Captura manual '+k);await save(j);return {ok:true,row:out.row};}
 if(msg.cmd==='export'){
  let rows=Object.values(j.rows);if(!rows.length)return {error:'Ainda nao existem registros efetivamente coletados'};
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');let json=JSON.stringify({schema:'inkwell-ligalorcana-local-v1',exported_at:new Date().toISOString(),total:rows.length,editionAudit:j.editionAudit,pending:Object.values(j.pending||{}),skipped:Object.values(j.skipped||{}),records:rows},null,2);
  await download(json,'coleta_'+stamp+'.json','application/json');await download(csv(rows),'coleta_'+stamp+'.csv','text/csv');return {ok:true,exported:rows.length};
 }
 return {error:'Comando desconhecido'};
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{handleMessage(msg).then(respond).catch(e=>respond({error:String(e)}));return true});
chrome.runtime.onStartup.addListener(async()=>{
 await armDaily();
 let j=await load();
 if(j.phase==='captcha_wait'&&j.captchaUntil){await chrome.alarms.create(CAPTCHA_RETRY_ALARM,{when:Math.max(Date.now()+1000,j.captchaUntil)});return;}
 if(j.running)await stop(j,'Chrome reiniciou. Clique Iniciar/retomar com as mesmas edi�oes');
});

chrome.alarms.onAlarm.addListener(a=>{
 if(a.name===DAILY_ALARM)dailyTick().catch(e=>console.warn('Coleta diaria',e));
 if(a.name===GH_DEVICE_ALARM)ghDevicePoll().catch(e=>ghFail(String(e)));
 if(a.name===CAPTCHA_RETRY_ALARM)resumeAfterCaptcha().catch(e=>console.warn('Falha de rechecagem',e));
});

if(chrome.runtime.onInstalled)chrome.runtime.onInstalled.addListener(()=>armDaily().catch(console.warn));
