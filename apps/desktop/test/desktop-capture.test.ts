import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopReview} from '../electron/desktop-capture';
import {Store} from '../electron/store';
import {parseExport} from '../electron/parsers';
import {webProvider} from '../electron/platform';
import {sourceStats,fromPlatform} from '../src/provenance';
const raw={app:{pid:42,bundleId:'example.doubao',name:'豆包'},title:'聊天',truncated:false,nodes:[{id:'0',text:'我的需求是做一个 Mac 应用。'},{id:'1',text:'好的，我来帮你设计。'},{id:'2',text:'请使用白色背景。'}]};
test('Desktop text stays transient until an exact reviewed subset is confirmed; rejects stale and forged selection',()=>{
 let now=Date.now();const review=new DesktopReview(()=>now),p=review.stage(raw);p.nodes[0].text='renderer mutation';
 const rows=review.confirm(p.token,['0','2'],'doubao','产品设计');assert.equal(rows.length,2);assert.equal(rows[0].text,raw.nodes[0].text);assert.equal(rows[0].source,'desktop://example.doubao');assert.equal(rows[0].timeSource,'captured');assert.ok(rows.every(r=>r.text!==raw.nodes[1].text));
 assert.throws(()=>review.confirm(p.token,['forged'],'doubao','产品设计'));assert.throws(()=>review.confirm(p.token,['0','0'],'doubao','产品设计'));assert.throws(()=>review.confirm(p.token,['0'],'invalid','产品设计'));assert.throws(()=>review.confirm(p.token,['0'],'doubao',''));
 const newer=review.stage(raw);assert.throws(()=>review.confirm(p.token,['0'],'doubao','产品设计'));now+=600001;assert.throws(()=>review.confirm(newer.token,['0'],'doubao','产品设计'));review.clear();assert.throws(()=>review.confirm(newer.token,['0'],'doubao','产品设计'));
});
test('Desktop re-reading deduplicates; equal text in separate conversations, apps and platforms stays distinct',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-desktop-'));const store=await new Store(join(dir,'data.sqlite')).open();try{
 const review=new DesktopReview();const take=(provider='doubao',conversation='one',input=raw)=>{const p=review.stage(input);return review.confirm(p.token,['0','2'],provider,conversation)};
 assert.equal(await store.upsert(take()),2);assert.equal(await store.upsert(take()),0);assert.equal(await store.upsert(take('doubao','two')),2);assert.equal(await store.upsert(take('claude')),2);assert.equal(await store.upsert(take('doubao','one',{...raw,app:{...raw.app,bundleId:'other.app'}})),2);
 assert.equal(store.count(),8);assert.equal(sourceStats(store.traces()).find(s=>s.provider==='doubao')?.prompts,6);assert.equal(fromPlatform({evidence:[store.prompts().find(p=>p.provider==='doubao')!]} as any,'doubao'),true);
 }finally{store.close();await rm(dir,{recursive:true,force:true})}
});
test('Portable imports carry explicit platform, preserve user role, stable edits and timestamps',()=>{
 const data={format:'personal-memory.conversations.v1',provider:'cursor',conversations:[{id:'1',title:'需求',messages:[{id:'u1',role:'user',text:'只采集我的提问。',timestamp:'2026-01-01T00:00:00Z'},{id:'a1',role:'assistant',text:'这是助手回答'}]}]};
 const first=parseExport(JSON.stringify(data),'first.json');assert.equal(first.length,1);assert.equal(first[0].provider,'cursor');assert.equal(first[0].timeSource,'platform');
 data.conversations[0].messages[0].text='更新后的提问。';const second=parseExport(JSON.stringify(data),'second.json');assert.equal(second[0].id,first[0].id);assert.equal(second[0].text,'更新后的提问。');
 assert.throws(()=>parseExport(JSON.stringify({...data,provider:'pretend-platform'}),'x'));assert.throws(()=>parseExport(JSON.stringify({...data,conversations:[...data.conversations,...data.conversations]}),'x'));
 const noTime=parseExport(JSON.stringify({...data,provider:'custom:my-agent',conversations:[{id:'2',messages:[{id:'1',role:'user',text:'需求'}]}]}),'x');assert.equal(noTime[0].timeSource,'captured');assert.equal(noTime[0].provider,'custom:my-agent');
});
test('Web sources identify domestic platforms by domain, reject lookalike hosts, and do not infer model as platform',async()=>{
 const {presets,preset}=await import(new URL('../../../extension/src/core.mjs',import.meta.url).href);
 for(const [url,provider] of [['https://www.doubao.com/chat/1','doubao'],['https://chat.deepseek.com/a/chat/1','deepseek'],['https://www.kimi.com/chat/1','kimi'],['https://kimi.moonshot.cn/chat/1','kimi'],['https://chat.qwen.ai/c/1','qwen'],['https://yuanbao.tencent.com/chat/1','yuanbao']] as const){assert.equal(webProvider(new URL(url)),provider);assert.ok(preset(url).selector)}
 for(const template of presets)assert.ok(!webProvider(new URL('https://'+template.host)).startsWith('custom:'));
 assert.equal(webProvider(new URL('https://doubao.com.evil.example/c/1')),'custom:doubao.com.evil.example');
});

test('Shared messages-shaped exports require a declared source rather than silently becoming Grok',()=>{
 const raw={id:'shared',messages:[{id:'u',role:'user',content:'请保留正确的平台。'}]};
 assert.throws(()=>parseExport(JSON.stringify(raw),'doubao.json'),/来源平台/);
 assert.equal(parseExport(JSON.stringify({...raw,provider:'doubao'}),'export.json')[0].provider,'doubao');
});
