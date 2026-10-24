import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,stat,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readCodexDatabase,parseCodexDatabase,codexDatabaseName} from '../electron/codex-database';
import {Store} from '../electron/store';
import {parseJSONL} from '../electron/parsers';
const time=Date.parse('2026-07-16T07:16:05Z');
const item=(id:string,text:string,thread='main',offset=0)=>({thread_id:thread,item_id:id,created_at_ms:time+offset,rollout_ordinal:offset,item_json:JSON.stringify({type:'userMessage',id,content:[{type:'text',text}]})});
test('Codex paginated history keeps user messages and excludes subagents and app context',()=>{
 const rows=parseCodexDatabase([item('a','七月的历史需求'),item('b','subagent task','worker'),item('c','<external_codex_apps_open_page>{}</external_codex_apps_open_page>')],[{id:'main',title:'历史对话',source:'vscode'},{id:'worker',title:'worker',source:'{"subagent":{}}'}],'history.sqlite');
 assert.equal(rows.length,1);assert.equal(rows[0].text,'七月的历史需求');assert.equal(rows[0].timestamp,'2026-07-16T07:16:05.000Z');assert.equal(rows[0].conversationTitle,'历史对话');
});
test('Codex database and JSONL share identity while repeated identical user turns remain distinct',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-codex-identities-'));const db=await new Store(join(dir,'db')).open();
 try{
  const rows=parseJSONL([{type:'session_meta',payload:{id:'main'}},...['问题','问题'].map((text,i)=>({type:'response_item',timestamp:new Date(time+i*1000).toISOString(),payload:{role:'user',content:[{type:'input_text',text}]}}))].map(r=>JSON.stringify(r)).join('\n')+'\n','codex','file.jsonl');
  await db.upsert(rows);const incoming=parseCodexDatabase([item('a','问题'),item('b','问题','main',1000)],[{id:'main',title:'历史对话',source:'vscode'}],codexDatabaseName);
  assert.equal(await db.upsert(incoming),0);assert.equal(db.count(),2);assert.equal(await db.upsert(rows),0);assert.equal(db.count(),2);assert.deepEqual(new Set(db.prompts().map(p=>p.id)),new Set(rows.map(p=>p.id)));
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('Codex SQLite snapshot reads older history without modifying source files or creating source journals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-codex-database-'));
 try{
  const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
  execFileSync('/usr/bin/sqlite3',[join(dir,'state_5.sqlite'),"CREATE TABLE threads(id TEXT,title TEXT,source TEXT); INSERT INTO threads VALUES ('main','七月历史','vscode');"]);
  execFileSync('/usr/bin/sqlite3',[join(dir,codexDatabaseName),`PRAGMA journal_mode=WAL; CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,created_at_ms INTEGER,rollout_ordinal INTEGER,item_json TEXT,item_type TEXT); INSERT INTO thread_items VALUES ('main','a',${time},0,${q(item('a','找回老需求').item_json)},'userMessage');`]);
  const names=await readdir(dir),before=await stat(join(dir,codexDatabaseName));
  const rows=await readCodexDatabase(dir);assert.equal(rows.length,1);assert.equal(rows[0].text,'找回老需求');assert.deepEqual(await readdir(dir),names);assert.equal((await stat(join(dir,codexDatabaseName))).mtimeMs,before.mtimeMs);
  const abort=new AbortController();abort.abort();assert.deepEqual(await readCodexDatabase(dir,abort.signal),[]);
  await symlink(join(dir,codexDatabaseName),join(dir,'linked'));await rm(join(dir,codexDatabaseName));await symlink(join(dir,'linked'),join(dir,codexDatabaseName));await assert.rejects(()=>readCodexDatabase(dir),/普通文件/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
