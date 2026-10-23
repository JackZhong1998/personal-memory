import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseJSONL,parseExport,hash} from '../electron/parsers';
import {Store} from '../electron/store';
import {syncCodexFiles} from '../electron/history-sync';
const meta={type:'session_meta',payload:{id:'history'}};
const event=(text:string,time='2026-01-01T00:00:00Z')=>({type:'event_msg',timestamp:time,payload:{type:'user_message',message:text}});
const response=(text:string,time='2026-01-02T00:00:00Z',id?:string)=>({type:'response_item',timestamp:time,payload:{role:'user',id,content:[{type:'input_text',text}]}});
const jsonl=(...rows:unknown[])=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
const parse=(...rows:unknown[])=>parseJSONL(jsonl(meta,...rows),'codex','history.jsonl');
test('mixed Codex history retains older event-only turns and merges adjacent dual representations',()=>{
 const p=parse(event('old'),response('new'),event('new','2026-01-02T00:00:01Z'),response('new','2026-01-03T00:00:00Z'));
 assert.deepEqual(p.map(p=>p.text),['old','new','new']);assert.equal(new Set(p.map(p=>p.id)).size,3);assert.equal(p[1].sourceKeys?.length,2);
});
test('Codex fallback IDs retain ordinal after native IDs',()=>{const p=parse(response('a',undefined,'native'),response('b'));assert.equal(p[1].id,hash('codex:history:turn-1'))});
test('upgrading a legacy database to mixed history preserves old IDs and analysis references',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-history-'));let db=await new Store(join(dir,'db')).open();
 try{
  // Simulates the legacy parser: any response suppressed all event records.
  const old=parse(response('new')).map(({sourceKeys,legacyIds,...p})=>p);await db.upsert(old);await db.markAnalyzed(old);
  const incoming=parse(event('old'),response('new'));
  assert.equal(await db.upsert(incoming),1);assert.equal(db.count(),2);assert.equal(db.prompts().find(p=>p.text==='new')?.id,old[0].id);
  assert.equal(db.unanalyzed(db.prompts()).length,1);assert.equal(await db.upsert(incoming),0);
  db.close();db=await new Store(join(dir,'db')).open();assert.equal(await db.upsert(incoming),0);assert.equal(db.count(),2);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('event-only history followed by mixed format is idempotent and does not overwrite the older turn',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-history-'));const db=await new Store(join(dir,'db')).open();try{
  const old=parse(event('old'));await db.upsert(old);
  const next=parse(event('old'),response('new'));assert.equal(await db.upsert(next),1);assert.equal(await db.upsert(next),0);
  assert.equal(db.prompts().find(p=>p.id===old[0].id)?.text,'old');assert.equal(db.count(),2);
  const edited=parse(event('edited old'),response('new'));assert.equal(await db.upsert(edited),0);assert.equal(db.count(),2);assert.equal(db.prompts().find(p=>p.id===old[0].id)?.text,'edited old');
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('history scans nested sessions and archives, skips bad files and symlinks, and persists without duplicates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-history-'));let db=await new Store(join(dir,'db')).open();
 try{const sessions=join(dir,'sessions'),archives=join(dir,'archived_sessions');await mkdir(join(sessions,'2026','01'),{recursive:true});await mkdir(archives);
  await writeFile(join(sessions,'2026','01','a.jsonl'),jsonl(meta,event('old question')));
  await writeFile(join(archives,'b.jsonl'),jsonl({type:'session_meta',payload:{id:'archived'}},response('archived question'),{type:'response_item',payload:{role:'assistant',content:'answer'}},response('<environment_context>system</environment_context>')));
  await writeFile(join(sessions,'bad.jsonl'),'not-json\n{}\n');await symlink(archives,join(sessions,'linked'));
  let updates=0;const roots=[sessions,archives,join(dir,'absent')];const result=await syncCodexFiles(roots,p=>db.upsert(p),new AbortController().signal,()=>{updates++});
  assert.equal(result.total,3);assert.equal(result.processed,3);assert.equal(result.added,2);assert.equal(result.skipped,1);assert.equal(result.errors.length,1);assert.equal(result.missing.length,1);assert.equal(result.running,false);assert.ok(updates>=3);
  assert.ok(db.prompts().every(p=>p.timestamp.startsWith('2026-01-')));db.close();db=await new Store(join(dir,'db')).open();assert.equal((await syncCodexFiles(roots,p=>db.upsert(p),new AbortController().signal,()=>{})).added,0);assert.equal(db.count(),2);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('cancelled history discovery writes no prompts and can be retried',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-history-'));try{await writeFile(join(dir,'a.jsonl'),jsonl(meta,event('a')));const abort=new AbortController();abort.abort();let writes=0;
  const result=await syncCodexFiles([dir],async()=>{writes++;return 1},abort.signal,()=>{});assert.equal(result.cancelled,true);assert.equal(result.running,false);assert.equal(writes,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('explicit Doubao import hint supplies missing source but never relabels an existing source',()=>{
 const data={id:'doubao-history',messages:[{id:'m1',role:'user',content:'historical request',timestamp:'2025-01-01T00:00:00Z'},{role:'assistant',content:'answer'}]};
 const p=parseExport(JSON.stringify(data),'file.json','doubao');assert.equal(p.length,1);assert.equal(p[0].provider,'doubao');assert.equal(p[0].timestamp,'2025-01-01T00:00:00.000Z');assert.deepEqual(p,parseExport(JSON.stringify(data),'file.json','doubao'));
 assert.equal(parseExport(JSON.stringify({...data,provider:'grok'}),'file.json','doubao')[0].provider,'grok');assert.throws(()=>parseExport(JSON.stringify(data),'file.json'),/来源平台/);
});
