/* GitHub OAuth Device Flow. No client secret, no tokens in extension files.
   chrome.storage.session contains the token and temporary device authorization.
   Polling is handled by chrome.alarms so it survives MV3 worker suspension.
   OAuth Apps require Enable Device Flow in GitHub developer settings.
*/
const GH_REPO='luiscredie/inkwell';
const GH_API='https://api.github.com';
const GH_BRANCH='feature/ligalorcana-review-pipeline';
const GH_DEVICE_ALARM='inkwell_github_device_poll';
const encoder=new TextEncoder();
function ghBase64(content){let bytes=encoder.encode(content),s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.slice(i,i+8192));return btoa(s)}
function ghClientValid(value){return /^([A-Za-z0-9_]{8,90})$/.test(value)}
async function ghDevicePost(path,fields){
 let r;
 try{r=await fetch('https://github.com/login/'+path,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)});}
 catch(e){throw Error('Conexao com GitHub falhou (rede/CORS): '+String(e))}
 if(!r.ok)throw Error('GitHub Device Flow HTTP '+r.status+' (verifique se Device Flow est� ativado)');
 let x=await r.json();return x;
}
async function ghConnect(clientId){
 if(!ghClientValid(clientId))throw Error('Informe o Client ID correto do seu OAuth App GitHub');
 await chrome.alarms.clear(GH_DEVICE_ALARM);
 await chrome.storage.session.remove(['githubDevice','githubToken','githubAuthError']);
 // OAuth Apps use repo scope; GitHub Apps use separately configured permissions.
 const res=await ghDevicePost('device/code',{client_id:clientId,scope:'repo'});
 if(res.error)throw Error('GitHub: '+(res.error_description||res.error));
 if(!res.device_code||!res.user_code||!res.verification_uri||!res.expires_in)throw Error('GitHub nao retornou c�digo de verifica�ao');
 const interval=Math.max(30,Number(res.interval)||5); // MV3 Chrome alarms minimum reliable ~30s
 const d={clientId,deviceCode:res.device_code,userCode:res.user_code,
   verificationUri:res.verification_uri,expiresAt:Date.now()+Number(res.expires_in)*1000,
   interval,phase:'waiting',startedAt:Date.now()};
 await chrome.storage.session.set({githubDevice:d});
 await chrome.storage.local.set({githubClientId:clientId});
 await chrome.alarms.create(GH_DEVICE_ALARM,{delayInMinutes:interval/60});
 return {ok:true,phase:'waiting',user_code:d.userCode,verification_uri:d.verificationUri,
    message:'Abra a p�gina indicada, digite o c�digo e autorize. A conexao ser� verificada automaticamente.'};
}
async function ghDevicePoll(){
 const {githubDevice:d}=await chrome.storage.session.get('githubDevice');
 if(!d)return;
 if(Date.now()>=d.expiresAt){await ghFail('C�digo expirou. Clique Conectar novamente.');return;}
 let res;
 try{res=await ghDevicePost('oauth/access_token',{client_id:d.clientId,device_code:d.deviceCode,grant_type:'urn:ietf:params:oauth:grant-type:device_code'});}
 catch(e){await ghFail(String(e));return;}
 if(res.access_token){
  try{
   const user=await ghCall('/user',res.access_token);
   // Check read permission to intended branch, no implicit creation of another ref.
   await ghCall('/repos/'+GH_REPO+'/git/ref/heads/'+GH_BRANCH,res.access_token);
   await chrome.storage.session.set({githubToken:res.access_token,githubUser:user.login||null});
   await chrome.storage.session.remove(['githubDevice','githubAuthError']);
   await chrome.alarms.clear(GH_DEVICE_ALARM);
  }catch(e){await ghFail('Token recebido, mas sem acesso ao reposit�rio/branch de revisao: '+String(e))}
  return;
 }
 if(res.error==='authorization_pending'||res.error==='slow_down'){
  d.phase='waiting';if(res.error==='slow_down')d.interval+=Math.max(5,Number(res.interval)||5);
  await chrome.storage.session.set({githubDevice:d});
  await chrome.alarms.create(GH_DEVICE_ALARM,{delayInMinutes:Math.max(30,d.interval)/60});
  return;
 }
 await ghFail(res.error_description||res.error||'GitHub nao autorizou o dispositivo');
}
async function ghFail(message){
 await chrome.storage.session.remove(['githubDevice','githubToken']);
 await chrome.storage.session.set({githubAuthError:String(message)});
 await chrome.alarms.clear(GH_DEVICE_ALARM);
}
async function ghDisconnect(){
 await chrome.alarms.clear(GH_DEVICE_ALARM);
 await chrome.storage.session.remove(['githubDevice','githubToken','githubUser','githubAuthError']);
 return {ok:true,connected:false};
}
async function ghStatus(){
 const s=await chrome.storage.session.get(['githubToken','githubDevice','githubUser','githubAuthError']);
 const l=await chrome.storage.local.get(['githubAutoUpload','githubClientId']);
 return {connected:!!s.githubToken,user:s.githubUser||null,autoUpload:!!l.githubAutoUpload,
   clientId:l.githubClientId||'',branch:GH_BRANCH,
   phase:s.githubToken?'connected':s.githubDevice?'waiting':s.githubAuthError?'error':'disconnected',
   user_code:s.githubDevice?.userCode||null,verification_uri:s.githubDevice?.verificationUri||null,
   expires_at:s.githubDevice?.expiresAt||null,error:s.githubAuthError||null};
}
async function ghCall(path,token,opts={}){
 const response=await fetch(GH_API+path,{...opts,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(opts.headers||{})}});
 if(!response.ok){let body=await response.text();throw Error('GitHub HTTP '+response.status+': '+body.slice(0,400))}
 return response.status===204?{}:response.json();
}
async function ghUpload(j){
 const {githubToken}=await chrome.storage.session.get('githubToken');if(!githubToken)throw Error('GitHub nao conectado. Conclua Device Flow ou exporte backup local.');
 const rows=Object.values(j.rows);if(!rows.length)throw Error('Coleta vazia');
 const now=new Date().toISOString();
 await ghCall('/repos/'+GH_REPO+'/git/ref/heads/'+GH_BRANCH,githubToken);
 const timestamp=now.replace(/[:.]/g,'-');
 const payload={schema:'inkwell-ligalorcana-local-v1',exported_at:now,total:rows.length,editionAudit:j.editionAudit,pending:Object.values(j.pending||{}),records:rows};
 const file='coletas/ligalorcana/coleta/coleta_'+timestamp+'.json';
 await ghCall('/repos/'+GH_REPO+'/contents/'+file,githubToken,{method:'PUT',body:JSON.stringify({message:'data: backup LigaLorcana para revisao (nao publicar)',branch:GH_BRANCH,content:ghBase64(JSON.stringify(payload,null,2)+'\n')})});
 return {ok:true,branch:GH_BRANCH,file,url:'https://github.com/'+GH_REPO+'/blob/'+encodeURIComponent(GH_BRANCH)+'/'+file,records:rows.length};
}
