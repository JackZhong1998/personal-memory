import {copyFile,lstat,chmod,mkdtemp,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {watch} from 'chokidar';
import {directoryProject} from './source-project';
import {hash} from './parsers';
import {codexUserText} from './codex-text';
import type {Prompt} from './types';
const execute=promisify(execFile);
export const codexDatabaseName='thread_history_1.sqlite';
const files=[codexDatabaseName,codexDatabaseName+'-wal','state_5.sqlite','state_5.sqlite-wal'];
async function info(file:string){try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw new Error('Codex 数据库必须是普通文件');return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`}catch(e:any){if(e.code==='ENOENT')return undefined;throw e}}
async function query(file:string,sql:string,signal?:AbortSignal){
 const {stdout}=await execute('/usr/bin/sqlite3',['-batch','-init','/dev/null','-json',file,sql],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000,signal});
 return stdout.trim()?JSON.parse(stdout):[];
}
export function parseCodexDatabase(items:any[],threads:any[],source:string):Prompt[]{
 const metadata=new Map(threads.map(t=>[t.id,t])),rows:Prompt[]=[];
 for(const item of items){
  const thread=metadata.get(item.thread_id);
  if(!thread||typeof thread.source!=='string'||thread.source.includes('subagent'))continue;
  const raw=JSON.parse(item.item_json);if(raw.type!=='userMessage'||typeof item.item_id!=='string')continue;
  const text=codexUserText((Array.isArray(raw.content)?raw.content:[]).filter((c:any)=>['text','input_text'].includes(c?.type)&&typeof c.text==='string').map((c:any)=>c.text).join('\n'));
  if(!text)continue;const time=new Date(item.created_at_ms);if(!Number.isFinite(time.getTime()))throw new Error('Codex 数据库消息时间无效');
  rows.push({id:hash(`codex:${item.thread_id}:database:${item.item_id}`),provider:'codex',project:typeof thread.project_id==='string'&&typeof thread.project_name==='string'?{id:thread.project_id,name:thread.project_name,path:thread.cwd}:directoryProject(thread.cwd),conversationId:item.thread_id,conversationTitle:typeof thread.title==='string'&&codexUserText(thread.title)?thread.title:text.split('\n')[0].slice(0,70),text,timestamp:time.toISOString(),timeSource:'platform',source,sequence:item.rollout_ordinal,sourceKeys:[hash(`codex:${item.thread_id}:database:${item.item_id}`),hash(`codex:${item.thread_id}:response:${item.item_id}`)]});
 }
 return rows;
}
export async function readCodexDatabase(home:string,signal?:AbortSignal):Promise<Prompt[]>{
 if(!await info(join(home,codexDatabaseName)))return [];
 const temporary=await mkdtemp(join(tmpdir(),'personal-memory-codex-db-'));await chmod(temporary,0o700);
 try{
  // Snapshot into our temporary directory. SQLite never opens the source files,
  // so it cannot create journals, SHM files or locks inside CODEX_HOME.
  let stable=false;
  for(let attempt=0;attempt<3&&!stable;attempt++){
   if(signal?.aborted)return [];
   const before=await Promise.all(files.map(f=>info(join(home,f))));
   if(!before[0]||!before[2])throw new Error('Codex 历史库或会话索引不存在');
   for(let i=0;i<files.length;i++){
    const target=join(temporary,files[i]);await rm(target,{force:true});
    if(before[i]){try{await copyFile(join(home,files[i]),target,constants.COPYFILE_FICLONE);await chmod(target,0o600)}catch(e:any){if(e.code!=='ENOENT')throw e}}
   }
   const after=await Promise.all(files.map(f=>info(join(home,f))));stable=JSON.stringify(before)===JSON.stringify(after);
  }
  if(!stable)throw new Error('Codex 正在更新历史数据库，请稍后重试同步');
  const stateFile=join(temporary,'state_5.sqlite');
  const columns=await query(stateFile,'PRAGMA table_info(threads);',signal);
  const tables=await query(stateFile,"SELECT name FROM sqlite_master WHERE type='table';",signal);
  const has=(name:string)=>tables.some((t:any)=>t.name===name);
  const native=columns.some((c:any)=>c.name==='project_id')&&has('projects');
  const threads=await query(stateFile,`SELECT t.id,t.title,t.source,${columns.some((c:any)=>c.name==='cwd')?'t.cwd':'NULL AS cwd'}${native?',p.id AS project_id,p.name AS project_name':''} FROM threads t ${native?`LEFT JOIN projects p ON p.id=t.project_id ${has('project_roots')?"OR (t.project_id IS NULL AND p.id=(SELECT r.project_id FROM project_roots r WHERE r.path=t.cwd ORDER BY r.project_id LIMIT 1))":''}`:''};`,signal);
  const items=await query(join(temporary,codexDatabaseName),"SELECT thread_id,item_id,created_at_ms,rollout_ordinal,item_json FROM thread_items WHERE item_type='userMessage' ORDER BY thread_id,rollout_ordinal;",signal);
  return parseCodexDatabase(items,threads,join(home,codexDatabaseName));
 }finally{await rm(temporary,{recursive:true,force:true})}
}
export function watchCodexDatabase(home:string,changed:()=>void,error:(e:unknown)=>void){
 let timer:ReturnType<typeof setTimeout>|undefined;
 const watcher=watch(files.map(f=>join(home,f)),{ignoreInitial:true,followSymlinks:false,usePolling:true,interval:2000});
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(changed,2000)};
 watcher.on('add',schedule).on('change',schedule).on('error',error);
 return {close:async()=>{clearTimeout(timer);await watcher.close()}};
}
