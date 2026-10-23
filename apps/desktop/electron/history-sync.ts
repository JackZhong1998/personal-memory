import {opendir,stat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {HistorySyncState,Prompt} from './types';
import {parseJSONL} from './parsers';
export async function syncCodexFiles(roots:string[],upsert:(p:Prompt[])=>Promise<number>,signal:AbortSignal,update:(state:HistorySyncState)=>void):Promise<HistorySyncState>{
 const state:HistorySyncState={running:true,total:0,processed:0,added:0,skipped:0,cancelled:false,roots:[...roots],missing:[],errors:[]};const files:string[]=[];
 const notify=()=>update(structuredClone(state));const error=(path:string,e:unknown)=>{if(state.errors.length<100)state.errors.push(path+': '+(e instanceof Error?e.message:String(e)))};
 const walk=async(path:string)=>{if(signal.aborted)return;try{const dir=await opendir(path);for await(const entry of dir){if(signal.aborted)break;const next=join(path,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())await walk(next);else if(entry.isFile()&&entry.name.endsWith('.jsonl')){files.push(next);state.total++;if(state.total%100===0)notify()}}}catch(e:any){if(e.code==='ENOENT')state.missing.push(path);else error(path,e)}};
 notify();try{for(const root of roots)await walk(root);notify();for(const file of files){if(signal.aborted)break;try{if((await stat(file)).size>100*1024*1024){state.skipped++;error(file,new Error('文件超过 100 MB，未读取'))}else{const prompts=parseJSONL(await readFile(file,'utf8'),'codex',file);state.added+=await upsert(prompts)}}catch(e){state.skipped++;error(file,e)}state.processed++;notify();await new Promise<void>(resolve=>setImmediate(resolve))}}finally{state.running=false;state.cancelled=signal.aborted;notify()}
 return structuredClone(state);
}
