import {preset,cleanURL,validateRule} from './core.mjs';
const $=id=>document.getElementById(id),fields=['selector','bodySelector','idAttribute','conversationParam'];
const action=fn=>async()=>{try{$('notice').textContent='';await fn()}catch(e){$('notice').textContent=e.message}};
async function refresh(){const {sites={},records={},outbox={}}=await chrome.storage.local.get(['sites','records','outbox']);$('sites').replaceChildren(new Option('选择站点',''),...Object.keys(sites).map(k=>new Option(k+(sites[k].enabled?' · 已开启':' · 已暂停'),k)));$('counts').textContent=`本地 ${Object.keys(records).length} 条 · 待同步 ${Object.keys(outbox).length} 条`;}
$('extensionId').textContent=chrome.runtime.id;
$('sites').onchange=action(async()=>{const origin=$('sites').value;if(!origin)return;const {sites={}}=await chrome.storage.local.get('sites');$('origin').value=origin;for(const key of fields)$(key).value=sites[origin][key]??''});
$('preset').onclick=action(async()=>{$('selector').value=preset($('origin').value).selector;$('notice').textContent='模板尚未验证，请到聊天页面预览。'});
$('save').onclick=action(async()=>{const origin=new URL(cleanURL($('origin').value)).origin,rule={enabled:false,...Object.fromEntries(fields.map(key=>[key,$(key).value.trim()]))};validateRule(rule);const response=await chrome.runtime.sendMessage({type:'save',origin,rule});if(response.error)throw new Error(response.error);await refresh();$('notice').textContent='规则已保存；回到聊天页面预览后开启。'});
$('export').onclick=action(async()=>{const data=await chrome.runtime.sendMessage({type:'export'});if(data.error)throw new Error(data.error);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='personal-memory-browser-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)});
$('clear').onclick=action(async()=>{if(!confirm('清空扩展中的采集副本与待同步队列？桌面数据库不会被删除。'))return;await chrome.runtime.sendMessage({type:'clear'});await refresh();$('notice').textContent='已清空扩展副本。已开启站点后续仍会采集。'});
refresh().catch(e=>$('notice').textContent=e.message);
