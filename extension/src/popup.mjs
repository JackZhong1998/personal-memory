import {preset,cleanURL} from './core.mjs';
const $=id=>document.getElementById(id),send=async m=>{const r=await chrome.runtime.sendMessage(m);if(r?.error)throw new Error(r.error);return r};
let tab,origin,rule,ready=false;
const action=fn=>async()=>{try{$('notice').textContent='';await fn()}catch(e){$('notice').textContent=e.message}};
async function load(){[tab]=await chrome.tabs.query({active:true,currentWindow:true});origin=new URL(cleanURL(tab.url)).origin;const {sites={},outbox={},lastError=''}=await chrome.storage.local.get(['sites','outbox','lastError']);rule=sites[origin]??{...preset(tab.url),enabled:false,idAttribute:'data-message-id',bodySelector:'',conversationParam:''};$('site').textContent=origin;$('status').textContent=(rule.enabled?'本站已开启':'本站未开启')+' · '+Object.keys(outbox).length+' 条待同步';$('notice').textContent=lastError;}
$('preview').onclick=action(async()=>{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});const result=await chrome.tabs.sendMessage(tab.id,{type:'preview',rule});if(result.error)throw new Error(result.error);$('previewRows').replaceChildren();for(const m of result.messages){const p=document.createElement('p');p.textContent=m.text;$('previewRows').append(p)}ready=result.messages.length>0;$('enable').disabled=!ready;$('notice').textContent=`匹配 ${result.messages.length} 条。请核对均为已发送的用户提问；不匹配请调整规则。`;});
$('enable').onclick=action(async()=>{if(!ready)return;if(!await chrome.permissions.request({origins:[origin+'/*']}))throw new Error('未授予站点权限');await send({type:'save',origin,rule:{...rule,enabled:true}});await chrome.tabs.sendMessage(tab.id,{type:'rescan'});await load()});
$('pause').onclick=action(async()=>{await send({type:'save',origin,rule:{...rule,enabled:false}});await load()});
$('sync').onclick=action(async()=>{const r=await send({type:'sync'});await load();$('notice').textContent=r.sent?`已交给本机桌面端 ${r.sent} 条，等待入库。`:'连接正常 · 暂无待同步提问'});
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
load().catch(e=>{$('notice').textContent=e.message;$('preview').disabled=true;$('pause').disabled=true});
