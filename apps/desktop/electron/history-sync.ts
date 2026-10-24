import {opendir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import type {HistorySyncState,Prompt} from './types';
import {readCodexDatabase,codexDatabaseName} from './codex-database';
import {lstat} from 'node:fs/promises';
import {readLocalJSONL} from './local-jsonl';
export async function syncCodexFiles(roots:string[],upsert:(p:Prompt[])=>Promise<number>,signal:AbortSignal,update:(state:HistorySyncState)=>void,provider:'codex'|'claude'='codex'):Promise<HistorySyncState>{
 const state:HistorySyncState={provider,running:true,total:0,processed:0,added:0,skipped:0,cancelled:false,roots:[...roots],missing:[],errors:[]};const files:string[]=[];
 const notify=()=>update(structuredClone(state));const error=(path:string,e:unknown)=>{if(state.errors.length<100)state.errors.push(path+': '+(e instanceof Error?e.message:String(e)))};
 const walk=async(path:string)=>{if(signal.aborted)return;try{const dir=await opendir(path);for await(const entry of dir){if(signal.aborted)break;const next=join(path,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())await walk(next);else if(entry.isFile()&&entry.name.endsWith('.jsonl')){files.push(next);state.total++;if(state.total%100===0)notify()}}}catch(e:any){if(e.code==='ENOENT')state.missing.push(path);else error(path,e)}};
 notify();try{for(const root of roots)await walk(root);notify();for(const file of files){if(signal.aborted)break;try{const prompts=await readLocalJSONL(file,provider,signal);if(!signal.aborted)state.added+=await upsert(prompts)}catch(e){state.skipped++;error(file,e)}state.processed++;notify();await new Promise<void>(resolve=>setImmediate(resolve))}}finally{state.running=false;state.cancelled=signal.aborted;notify()}
 return structuredClone(state);
}

export async function syncCodexHistory(roots:string[],upsert:(p:Prompt[])=>Promise<number>,signal:AbortSignal,update:(state:HistorySyncState)=>void):Promise<HistorySyncState>{
 const state=await syncCodexFiles(roots,upsert,signal,s=>update(s));
 if(signal.aborted)return state;
 const home=dirname(roots[0]),database=join(home,codexDatabaseName);
 try{await lstat(database)}catch(e:any){if(e.code==='ENOENT')return state;throw e}
 state.running=true;state.total++;state.roots.push(database);update(structuredClone(state));
 try{const rows=await readCodexDatabase(home,signal);if(!signal.aborted)state.added+=await upsert(rows)}catch(e){if(!signal.aborted){state.skipped++;state.errors.push(database+': '+(e instanceof Error?e.message:String(e)))}}
 finally{state.processed++;state.running=false;state.cancelled=signal.aborted;update(structuredClone(state))}
 return state;
}
