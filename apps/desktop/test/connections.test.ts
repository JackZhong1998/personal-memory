import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {browserConnection,localConnection} from '../electron/connections';
import {receive} from '../electron/browser-host';
import {Store} from '../electron/store';
import {parseJSONL} from '../electron/parsers';
import {syncCodexFiles} from '../electron/history-sync';
import {ANALYSIS_ENABLED} from '../electron/memory-prompt';
test('local connection distinguishes configured switches, missing data and active file watcher eligibility',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-links-'));try{const root=join(dir,'sessions');assert.equal((await localConnection('codex',[root],true,false)).state,'missing');await mkdir(root);assert.equal((await localConnection('codex',[root],false,false)).state,'off');assert.equal((await localConnection('codex',[root],true,true)).state,'paused');assert.equal((await localConnection('codex',[root],true,false)).state,'watching')}finally{await rm(dir,{recursive:true,force:true})}
});
test('browser heartbeat proves actual native response even when receiving is paused; does not import content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-links-'));try{
  await writeFile(join(dir,'settings.json'),JSON.stringify({watchBrowser:false,paused:true}));
  const before=await browserConnection(dir,['chrome']);assert.equal(before.responding,false);assert.deepEqual(before.configured,['chrome']);
  const packet={format:'personal-memory.browser.status.v1',version:'0.7.0',enabledSites:2,pending:4};
  assert.deepEqual(await receive(packet,dir),{ok:true,receiving:false});const state=await browserConnection(dir,['chrome']);assert.equal(state.responding,true);assert.equal(state.enabledSites,2);assert.equal(state.pending,4);assert.equal((await readdir(dir)).includes('browser-inbox'),false);
  assert.equal((await browserConnection(dir,['chrome'],Date.now()+100000)).responding,false);
  await assert.rejects(receive({...packet,pending:-1},dir));await assert.rejects(receive({...packet,text:'untrusted content'},dir));
  const persisted=JSON.parse(await readFile(join(dir,'browser-connection.json'),'utf8'));assert.deepEqual(persisted.status,packet);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('equal timestamps retain platform turn order rather than ID hash order, including after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-order-'));let db=await new Store(join(dir,'db')).open();try{
  const raw=[{type:'session_meta',payload:{id:'ordered'}},...['z','a','b'].map((id,i)=>({type:'response_item',timestamp:'2026-10-23T00:00:00Z',payload:{id,role:'user',content:[{type:'input_text',text:'question '+i}]}}))].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const prompts=parseJSONL(raw,'codex','ordered.jsonl');await db.upsert(prompts);assert.deepEqual(db.prompts().map(p=>p.text),['question 0','question 1','question 2']);db.close();db=await new Store(join(dir,'db')).open();assert.deepEqual(db.prompts().map(p=>p.text),['question 0','question 1','question 2']);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('immediate sync supports Claude Code history as an independent source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-claude-'));try{await writeFile(join(dir,'c.jsonl'),JSON.stringify({type:'user',uuid:'m',sessionId:'claude-session',message:{role:'user',content:'history'}})+'\n');const result=await syncCodexFiles([dir],async rows=>{assert.equal(rows[0].provider,'claude');assert.equal(rows[0].text,'history');return rows.length},new AbortController().signal,()=>{},'claude');assert.equal(result.added,1);assert.equal(result.provider,'claude')}finally{await rm(dir,{recursive:true,force:true})}
});
test('production memory analysis remains explicitly disabled',()=>assert.equal(ANALYSIS_ENABLED,false));
