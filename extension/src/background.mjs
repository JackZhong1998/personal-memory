import {cleanURL,validateRule,packets} from './core.mjs';
let serial=Promise.resolve();
const lock=fn=>{const run=serial.then(fn);serial=run.catch(()=>{});return run};
async function register(){const {sites={}}=await chrome.storage.local.get('sites');const old=await chrome.scripting.getRegisteredContentScripts();if(old.length)await chrome.scripting.unregisterContentScripts({ids:old.map(s=>s.id)});
 for(const [origin,site] of Object.entries(sites)){if(!site.enabled||!await chrome.permissions.contains({origins:[origin+'/*']}))continue;
  await chrome.scripting.registerContentScripts([{id:'site-'+new URL(origin).hostname.replace(/[^a-z0-9]/gi,'_'),matches:[origin+'/*'],js:['content.js'],runAt:'document_idle',allFrames:false}]);
 }
}
chrome.runtime.onInstalled.addListener(()=>{void register().catch(()=>{});void chrome.alarms.create('retry',{periodInMinutes:1})});chrome.runtime.onStartup.addListener(()=>{void register().catch(()=>{});void chrome.alarms.create('retry',{periodInMinutes:1})});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='retry')void lock(async()=>{try{const {outbox={}}=await chrome.storage.local.get('outbox');if(Object.keys(outbox).length)await sync()}catch(e){await chrome.storage.local.set({lastError:e.message})}})});
async function sync(){let {outbox={}}=await chrome.storage.local.get('outbox');let sent=0;
 for(const packet of packets(outbox)){
  let response;try{response=await chrome.runtime.sendNativeMessage('app.tracelet.browser',packet)}catch{throw new Error('桌面应用未连接；请在 Personal Memory 设置中配对扩展 ID。数据已留在本地。')}
  if(!response?.ok)throw new Error(response?.error||'桌面接收失败');
  for(const message of packet.messages){delete outbox[packet.conversationId+':'+message.id];sent++}
  await chrome.storage.local.set({outbox});
 }
 await chrome.storage.local.set({lastError:'',lastSync:new Date().toISOString()});return {ok:true,sent};
}
async function handle(message,sender){
 const extensionPage=!sender.tab&&sender.id===chrome.runtime.id;
 if(message.type==='config'){
  if(!sender.tab||sender.frameId!==0)return null;
  const origin=new URL(cleanURL(sender.url)).origin;if(!await chrome.permissions.contains({origins:[origin+'/*']}))return null;const {sites={}}=await chrome.storage.local.get('sites');return sites[origin]??null;
 }
 if(message.type==='capture-error'){
  if(!sender.tab||sender.frameId!==0)return null;const origin=new URL(cleanURL(sender.url)).origin;const {sites={}}=await chrome.storage.local.get('sites');if(sites[origin]?.enabled)await chrome.storage.local.set({lastError:typeof message.error==='string'?message.error.slice(0,200):'采集失败'});return {ok:true};
 }
 if(message.type==='capture'){
  if(!sender.tab||sender.frameId!==0)throw new Error('来源无效');
  const origin=new URL(cleanURL(sender.url)).origin,{sites={}}=await chrome.storage.local.get('sites');if(!sites[origin]?.enabled||new URL(message.packet.url).origin!==origin||!await chrome.permissions.contains({origins:[origin+'/*']}))throw new Error('站点未授权');
  const p=message.packet;if(p.format!=='tracelet.browser.capture.v1'||!/^[a-f0-9]{64}$/.test(p.conversationId)||!Array.isArray(p.messages)||p.messages.length>2000)throw new Error('采集格式无效');
  const {records={},outbox={}}=await chrome.storage.local.get(['records','outbox']);let added=0;
  for(const m of p.messages){if(m.role!=='user'||typeof m.text!=='string'||m.text.length>64000||typeof m.id!=='string'||m.id.length>200)throw new Error('消息格式无效');
   const key=p.conversationId+':'+m.id;if(records[key]?.text===m.text)continue;
   const record={url:cleanURL(p.url),conversationId:p.conversationId,title:p.title.slice(0,200),capturedAt:new Date().toISOString(),id:m.id,text:m.text};records[key]=record;outbox[key]=record;added++;
  }
  if(new TextEncoder().encode(JSON.stringify({records,outbox})).length>4*1024*1024)throw new Error('本地副本已达容量限制，请导出后清空');
  await chrome.storage.local.set({records,outbox});if(added)try{await sync()}catch(e){await chrome.storage.local.set({lastError:e.message})}return {ok:true,added};
 }
 if(!extensionPage)throw new Error('仅允许扩展页面操作');
 if(message.type==='save'){
  const origin=new URL(cleanURL(message.origin)).origin;validateRule(message.rule);
  if(message.rule.enabled&&!await chrome.permissions.contains({origins:[origin+'/*']}))throw new Error('请先授权本站');
  const {sites={}}=await chrome.storage.local.get('sites');sites[origin]=message.rule;await chrome.storage.local.set({sites});await register();return {ok:true};
 }
 if(message.type==='sync')return sync();
 if(message.type==='export'){const {records={}}=await chrome.storage.local.get('records');return {format:'tracelet.browser-export.v1',captures:packets(records)}}
 if(message.type==='clear'){await chrome.storage.local.set({records:{},outbox:{},lastError:''});return {ok:true}}
 throw new Error('未知操作');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{lock(()=>handle(message,sender)).then(reply).catch(async e=>{if(message.type==='capture'||message.type==='sync')await chrome.storage.local.set({lastError:e.message});reply({error:e.message})});return true});
