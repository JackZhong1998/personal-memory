import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import initSqlJs from 'sql.js';
import {browserPrompts} from '../electron/browser-capture';
import {frame,receive} from '../electron/browser-host';
import {parseExport} from '../electron/parsers';
import {Store} from '../electron/store';
import {wirePrompt} from '../electron/analyzer';
const packet=(overrides:Record<string,unknown>={})=>({format:'tracelet.browser.capture.v1',url:'https://grok.com/c/123?private=secret#draft',conversationId:'a'.repeat(64),title:'需求整理',capturedAt:'2026-10-19T00:00:00Z',messages:[{id:'msg-1',role:'user',text:'请保留来源。'}],...overrides});
test('Browser origin determines provider, strips query secrets, and distinguishes collection time',()=>{
 const [p]=browserPrompts(packet());assert.equal(p.provider,'grok');assert.equal(p.source,'https://grok.com/c/123');assert.equal(p.timeSource,'captured');assert.equal(p.conversationId,'web:'+'a'.repeat(64));assert.equal(wirePrompt(p).timeSource,'captured');
 for(const [host,provider] of [['claude.ai','claude'],['manus.im','manus'],['app.manus.ai','manus'],['www.genspark.ai','genspark'],['my-ai.example','custom:my-ai.example'],['evilgrok.com','custom:evilgrok.com']])assert.equal(browserPrompts(packet({url:`https://${host}/c/1` }))[0].provider,provider);
});
test('Browser parser rejects invalid role, source, identifier and unbounded bodies',()=>{
 for(const input of [packet({url:'http://grok.com/c/1'}),packet({url:'https://user:pass@grok.com/c/1'}),packet({url:'file:///tmp/x'}),packet({url:'https://grok.com:333/c/1'}),packet({messages:[{id:'x',role:'assistant',text:'wrong'}]}),packet({messages:[{id:'x',role:'user',text:'x'.repeat(64001)}]}),packet({conversationId:'random'}),packet({capturedAt:'not-date'})])assert.throws(()=>browserPrompts(input));
});
test('SQLite migrates v0.2 data and deduplicates browser retries, preserving first collection time',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tracelet-browser-db-'));let store:Store|undefined;
 try{const file=join(root,'old.sqlite');const SQL=await initSqlJs();const db=new SQL.Database();db.run('CREATE TABLE prompts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, conversationId TEXT NOT NULL, conversationTitle TEXT NOT NULL, text TEXT NOT NULL, timestamp TEXT NOT NULL, source TEXT NOT NULL)');db.run("INSERT INTO prompts VALUES ('old','codex','old-trace','old','保留旧数据','2026-01-01T00:00:00Z','local')");await writeFile(file,db.export());db.close();
  store=await new Store(file).open();assert.equal(store.count(),1);assert.equal(await store.upsert(browserPrompts(packet())),1);
  const exportFile=JSON.stringify({format:'tracelet.browser-export.v1',captures:[packet({capturedAt:'2026-10-19T01:00:00Z'})]});assert.equal(await store.upsert(parseExport(exportFile,'export.json')),0);assert.equal(store.count(),2);assert.equal(store.prompts().find(p=>p.provider==='grok')!.timestamp,'2026-10-19T00:00:00Z');
  await store.markAnalyzed(browserPrompts(packet()));assert.equal(store.unanalyzed(browserPrompts(packet())).length,0);
  const edited=browserPrompts(packet({messages:[{id:'msg-1',role:'user',text:'请保留来源和证据。'}]}));assert.equal(await store.upsert(edited),0);assert.equal(store.unanalyzed(edited).length,1);assert.equal(store.count(),2);assert.equal(store.prompts().find(p=>p.provider==='grok')!.timeSource,'captured');
  const newest=browserPrompts(packet({capturedAt:'2026-10-19T02:00:00Z',messages:[{id:'msg-1',role:'user',text:'离线编辑后的最新需求。'}]}));await store.upsert(newest);await store.upsert(browserPrompts(packet()));
  assert.equal(store.prompts().find(p=>p.provider==='grok')!.text,'离线编辑后的最新需求。','older inbox packets must not overwrite newer edits');
  assert.equal(store.prompts().find(p=>p.provider==='grok')!.capturedAt,'2026-10-19T02:00:00.000Z');

 }finally{store?.close();await rm(root,{recursive:true,force:true})}
});
test('Native host durably queues only when desktop browser sync is enabled',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tracelet-native-'));
 try{await writeFile(join(root,'settings.json'),JSON.stringify({watchBrowser:false}));assert.equal((await receive(packet(),root)).ok,false);
  await writeFile(join(root,'settings.json'),JSON.stringify({watchBrowser:true,paused:true}));assert.equal((await receive(packet(),root)).ok,false);
  await writeFile(join(root,'settings.json'),JSON.stringify({watchBrowser:true}));assert.equal((await receive(packet(),root)).ok,true);
  const inbox=join(root,'browser-inbox'),files=await readdir(inbox);assert.equal(files.length,1);assert.ok(files[0].endsWith('.json'));assert.equal((await stat(join(inbox,files[0]))).mode&0o777,0o600);assert.equal(browserPrompts(JSON.parse(await readFile(join(inbox,files[0]),'utf8')))[0].provider,'grok');
 }finally{await rm(root,{recursive:true,force:true})}
});
test('Native messaging subprocess handles fragmented frames and multiple messages without stdout contamination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tracelet-frames-'));
 try{await writeFile(join(root,'settings.json'),JSON.stringify({watchBrowser:true}));
  const child=spawn(process.execPath,['--import','tsx',resolve('apps/desktop/electron/browser-host.ts'),'--data-dir',root],{stdio:['pipe','pipe','pipe']});const chunks:Buffer[]=[];let stderr='';child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>stderr+=b);
  const first=frame(packet());child.stdin.write(first.subarray(0,2));child.stdin.write(first.subarray(2,35));child.stdin.end(Buffer.concat([first.subarray(35),frame({invalid:true})]));
  const code=await new Promise(r=>child.on('close',r));assert.equal(code,0,stderr);let bytes=Buffer.concat(chunks);const replies=[];while(bytes.length){const len=bytes.readUInt32LE();replies.push(JSON.parse(bytes.subarray(4,4+len).toString()));bytes=bytes.subarray(4+len)}assert.equal(replies.length,2);assert.equal(replies[0].ok,true);assert.equal(replies[1].ok,false);assert.equal((await readdir(join(root,'browser-inbox'))).length,1);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('Extension background preserves offline queue, enforces permissions, deduplicates, and exports custom origins',async()=>{
 const {build}=await import('esbuild');const {runInNewContext}=await import('node:vm');
 const result=await build({entryPoints:['extension/src/background.mjs'],bundle:true,write:false,format:'iife',platform:'browser'});
 const extensionId='a'.repeat(32),origin='https://custom-ai.example';let listener:any,online=false,granted=true;const storage:any={sites:{[origin]:{enabled:true,selector:'.user-message'}}};
 const chrome={storage:{local:{get:async(keys:string|string[])=>{const list=typeof keys==='string'?[keys]:keys;return structuredClone(Object.fromEntries(list.filter(k=>k in storage).map(k=>[k,storage[k]])))},set:async(value:any)=>Object.assign(storage,structuredClone(value))}},permissions:{contains:async()=>granted},scripting:{getRegisteredContentScripts:async()=>[],unregisterContentScripts:async()=>{},registerContentScripts:async()=>{}},alarms:{create:async()=>{},onAlarm:{addListener:()=>{}}},runtime:{id:extensionId,onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}},onMessage:{addListener:(fn:any)=>listener=fn},sendNativeMessage:async()=>{if(!online)throw new Error('offline');return {ok:true}}}};
 runInNewContext(result.outputFiles[0].text,{chrome,URL,TextEncoder,console});
 const sender={tab:{id:1},id:extensionId,frameId:0,url:origin+'/chat/1'};
 const send=(message:any,from:any=sender):Promise<any>=>new Promise(resolve=>listener(message,from,resolve));
 const p=packet({url:origin+'/chat/1'});
 let response=await send({type:'capture',packet:p});assert.equal(response.ok,true);assert.equal(Object.keys(storage.outbox).length,1);assert.ok(storage.lastError.includes('未连接'));
 response=await send({type:'capture',packet:p});assert.equal(response.added,0);assert.equal(Object.keys(storage.records).length,1);
 const exported=await send({type:'export'},{id:extensionId});assert.equal(browserPrompts(exported.captures[0])[0].provider,'custom:custom-ai.example');assert.equal(exported.captures[0].messages[0].timestamp,undefined);
 assert.ok((await send({type:'export'},sender)).error);assert.ok((await send({type:'capture',packet:p},{...sender,frameId:1})).error);
 granted=false;assert.ok((await send({type:'capture',packet:p})).error);granted=true;
 online=true;response=await send({type:'sync'},{id:extensionId});assert.equal(response.sent,1);assert.equal(Object.keys(storage.outbox).length,0);assert.equal(Object.keys(storage.records).length,1);
 await send({type:'save',origin,rule:{enabled:false,selector:'.user-message'}},{id:extensionId});assert.ok((await send({type:'capture',packet:p})).error);
});
