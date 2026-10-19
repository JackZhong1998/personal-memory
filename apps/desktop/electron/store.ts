import initSqlJs, { type Database } from 'sql.js';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Prompt, Memory, Trace } from './types';
import { hash } from './parsers';
import { ANALYSIS_VERSION } from './memory-prompt';
import { sameScope } from './analyzer';
export class Store {
 private db!:Database;
 constructor(private file:string){}
 async open(){const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});
  await mkdir(dirname(this.file),{recursive:true,mode:0o700});
  let bytes:Uint8Array|undefined;try{bytes=await readFile(this.file)}catch(e:any){if(e.code!=='ENOENT')throw e}
  this.db=new SQL.Database(bytes);
  this.db.run('CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, provider TEXT NOT NULL, conversationId TEXT NOT NULL, conversationTitle TEXT NOT NULL, text TEXT NOT NULL, timestamp TEXT NOT NULL, source TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS analyzed (id TEXT PRIMARY KEY, hash TEXT NOT NULL);');
  if(!this.all('PRAGMA table_info(prompts)').some(r=>r.name==='meta'))this.db.run("ALTER TABLE prompts ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'");
  await this.flush();return this;
 }
 private persist:Promise<void>=Promise.resolve();
 private flush(){const bytes=this.db.export();this.persist=this.persist.catch(()=>{}).then(async()=>{const tmp=this.file+'.tmp';await writeFile(tmp,bytes,{mode:0o600});await chmod(tmp,0o600);await rename(tmp,this.file)});return this.persist}
 private all(sql:string,args:(string|number)[]=[]):any[]{const s=this.db.prepare(sql);try{s.bind(args);const rows=[];while(s.step())rows.push(s.getAsObject());return rows}finally{s.free()}}
 async upsert(prompts:Prompt[]){let added=0;this.db.run('BEGIN');try{for(const p of prompts){if(!this.all('SELECT id FROM prompts WHERE id=?',[p.id]).length)added++;
  this.db.run(`INSERT INTO prompts (id,provider,conversationId,conversationTitle,text,timestamp,source,meta) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, conversationTitle=excluded.conversationTitle, timestamp=CASE WHEN json_extract(prompts.meta,'$.timeSource')='captured' AND json_extract(excluded.meta,'$.timeSource')='captured' AND prompts.text=excluded.text THEN prompts.timestamp ELSE excluded.timestamp END, source=excluded.source, meta=excluded.meta WHERE json_extract(prompts.meta,'$.capturedAt') IS NULL OR json_extract(excluded.meta,'$.capturedAt') IS NULL OR json_extract(excluded.meta,'$.capturedAt') >= json_extract(prompts.meta,'$.capturedAt')`,[p.id,p.provider,p.conversationId,p.conversationTitle,p.text,p.timestamp,p.source,JSON.stringify({timeSource:p.timeSource,capturedAt:p.capturedAt})]);}this.db.run('COMMIT')}catch(e){this.db.run('ROLLBACK');throw e}await this.flush();return added}
 traces():Trace[]{return this.all("SELECT provider || ':' || conversationId AS id, provider, conversationTitle AS title, count(*) AS count, max(timestamp) AS updatedAt FROM prompts GROUP BY provider, conversationId ORDER BY updatedAt DESC")}
 prompts(traceId?:string):Prompt[]{return this.all('SELECT * FROM prompts'+(traceId?" WHERE provider || ':' || conversationId = ?":'')+' ORDER BY timestamp, id',traceId?[traceId]:[]).map(({meta,...p})=>({...p,...JSON.parse(meta||'{}')})) as Prompt[]}
 memories():Memory[]{return this.all('SELECT json FROM memories').map(r=>JSON.parse(r.json)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
 async addMemories(memories:Memory[]){for(const m of memories)this.db.run('INSERT OR REPLACE INTO memories VALUES (?,?)',[m.id,JSON.stringify(m)]);await this.flush()}
 unanalyzed(prompts:Prompt[]){return prompts.filter(p=>this.all('SELECT hash FROM analyzed WHERE id=?',[p.id])[0]?.hash!==hash(ANALYSIS_VERSION+':'+p.text))}
 async markAnalyzed(prompts:Prompt[]){for(const p of prompts)this.db.run('INSERT OR REPLACE INTO analyzed VALUES (?,?)',[p.id,hash(ANALYSIS_VERSION+':'+p.text)]);await this.flush()}
 async review(id:string,status:'accepted'|'rejected'){
  const memories=this.memories();const m=memories.find(m=>m.id===id);if(!m)throw new Error('记忆不存在');
  if(m.status==='superseded')throw new Error('这条记忆已被替代，请查看当前记忆。');
  if(m.status===status)return;
  const changes:Memory[]=[];
  if(status==='accepted'&&m.relatedMemoryId){const old=memories.find(old=>old.id===m.relatedMemoryId);
   if(!old||old.status!=='accepted'||old.category!==m.category||!sameScope(old.scope,m.scope))throw new Error('关联记忆已变化，请重新分析后再确认替换。');
   changes.push({...old,status:'superseded',supersededBy:m.id});
  }
  changes.push({...m,status});this.db.run('BEGIN');try{for(const row of changes)this.db.run('INSERT OR REPLACE INTO memories VALUES (?,?)',[row.id,JSON.stringify(row)]);this.db.run('COMMIT')}catch(e){this.db.run('ROLLBACK');throw e}await this.flush();
 }
 async erase(){this.db.run('DELETE FROM prompts; DELETE FROM memories; DELETE FROM analyzed; VACUUM;');await this.flush()}
 count(){return Number(this.all('SELECT count(*) AS n FROM prompts')[0].n)}
 close(){this.db.close()}
}
