const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString('pt-BR');
let lastRun=null;
function setNotice(msg){$('notice').textContent=msg||''}
function render(s){
 if(!s||s.error){setNotice(s?.error||'Sem resposta da extensao');return}
 const phase=String(s.phase||'idle');
 const labels={idle:'Em espera',home:'Preparando',editions:'Preparando',discoverEditions:'Descobrindo',chooseEdition:'Escolhendo',listing:'Lendo listagem',card:'Coletando',retryPending:'Recuperando',captcha_wait:'Pausa 10 min',paused:'Pausada',complete:'Conclu�da',needs_review:'Com pend�ncias'};
 const pill=$('phase');pill.textContent=labels[phase]||phase;
 pill.className='pill '+(phase==='complete'?'good':phase==='paused'||phase==='captcha_wait'||phase==='needs_review'?'warn':s.running?'good':'');
 const value=Number(s.index)||0,max=Number(s.queue)||0;
 $('progress-label').textContent=max?fmt(Math.min(value,max))+' / '+fmt(max):fmt(s.scanCount||0)+' cartas na fila';
 $('progress-fill').style.width=max?Math.min(100,Math.max(0,value/max*100))+'%':'0%';
 $('edition-label').textContent=s.edition?'Edi�ao '+s.edition:'Nenhuma edi�ao ativa';
 $('stored-label').textContent=fmt(s.stored)+' cartas salvas';
 $('pending-label').textContent=fmt(s.pending)+' pend�ncia(s)';
 const cap=s.captchaUntil&&phase==='captcha_wait';
 $('captcha-note').classList.toggle('hide',!cap);
 if(cap)$('captcha-note').textContent='Nova verifica�ao: '+new Date(s.captchaUntil).toLocaleTimeString('pt-BR')+'. Se houver CAPTCHA verdadeiro, resolva manualmente.';
 $('status').textContent=JSON.stringify({phase:s.phase,edition:s.edition,index:s.index,queue:s.queue,stored:s.stored,pendingCards:s.pendingCards,lastError:s.lastError,editionAudit:s.editionAudit,log:s.log},null,2);
 if(!lastRun){if(s.editions?.length&&!s.autoAll)$('editions').value=s.editions.join(',');$('all').checked=!!s.autoAll;lastRun=true}
}
async function send(cmd,extra={}){
 setNotice('Executando.');try{
  const r=await chrome.runtime.sendMessage({cmd,...extra});
  if(r?.error){setNotice('Erro: '+r.error);return}
  setNotice(r?.message||((r?.ok===true||r?.file)?'Comando executado.':'Resposta recebida.'));
  const s=await chrome.runtime.sendMessage({cmd:'status'});render(s);
 }catch(e){setNotice('Falha: '+String(e))}
}
$('start').onclick=()=>send('start',{autoAll:$('all').checked,editions:$('editions').value.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean),delay:Number($('delay').value)});
$('pause').onclick=()=>send('pause');$('retry').onclick=()=>send('retryPending');$('capture').onclick=()=>send('captureCurrent');$('export').onclick=()=>send('export');$('diagnostic').onclick=()=>send('diagnostic');
$('copylog').onclick=async()=>{try{const r=await chrome.runtime.sendMessage({cmd:'copyLog'});if(!r?.ok)throw Error(r?.error||'Sem resposta');await navigator.clipboard.writeText(JSON.stringify(r.diagnostic,null,2));setNotice('Log completo copiado para a �rea de transfer�ncia.')}catch(e){setNotice('Nao foi poss�vel copiar o log: '+String(e))}};
$('clear').onclick=()=>{if(confirm('ATEN�AO: apagar todos os checkpoints e cartas locais? Fa�a backup antes.'))send('clear')};
$('import').onclick=async()=>{const f=$('importfile').files?.[0];if(!f){setNotice('Selecione o arquivo JSON de backup');return}try{await send('import',{payload:JSON.parse(await f.text())})}catch(e){setNotice('Backup inv�lido: '+String(e))}};
async function refreshGitHub(){try{const s=await chrome.runtime.sendMessage({cmd:'githubStatus'});$('ghauto').checked=!!s?.autoUpload;if(s?.clientId&&document.activeElement!==$('ghclient'))$('ghclient').value=s.clientId;const wait=s?.phase==='waiting';$('ghopen').classList.toggle('hide',!wait);$('ghcopy').classList.toggle('hide',!wait);$('ghopen').dataset.url=s?.verification_uri||'';$('ghcopy').dataset.code=s?.user_code||'';$('github-auth').textContent=s?.connected?'Conectado como '+(s.user||'GitHub')+' � '+s.branch:wait?'Aguardando autoriza�ao. C�digo: '+s.user_code+' � '+s.verification_uri:s?.error?'Falha: '+s.error:'GitHub: desconectado'}catch(e){$('github-auth').textContent=String(e)}}
$('ghconnect').onclick=async()=>{await send('githubConnect',{clientId:$('ghclient').value.trim()});refreshGitHub()};$('ghdisconnect').onclick=async()=>{await send('githubDisconnect');refreshGitHub()};
$('ghopen').onclick=()=>{const u=$('ghopen').dataset.url;if(u&&new URL(u).origin==='https://github.com')chrome.tabs.create({url:u})};$('ghcopy').onclick=()=>navigator.clipboard.writeText($('ghcopy').dataset.code||'');
$('ghupload').onclick=()=>send('githubUpload');$('ghauto').onchange=()=>send('githubAuto',{enabled:$('ghauto').checked});
chrome.runtime.sendMessage({cmd:'status'}).then(render).catch(e=>setNotice(String(e)));refreshGitHub();setInterval(()=>chrome.runtime.sendMessage({cmd:'status'}).then(render).catch(()=>{}),2500);setInterval(refreshGitHub,4000);
