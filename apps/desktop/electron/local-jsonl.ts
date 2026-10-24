import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {parseJSONL} from './parsers';
import type {Prompt} from './types';

// Keep only records needed by the parser. Assistant images/tool output can make
// a local transcript very large; the whole transcript must not be buffered.
export async function readLocalJSONL(file:string,provider:'codex'|'claude',signal?:AbortSignal):Promise<Prompt[]>{
 const input=createReadStream(file,{encoding:'utf8'}),lines=createInterface({input,crlfDelay:Infinity});
 let lineNumber=0,lastTerminated=false,pending:Error|undefined;const retained:string[]=[];
 input.on('data',chunk=>{lastTerminated=String(chunk).endsWith('\n')});
 const abort=()=>input.destroy();signal?.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)return [];
  for await(const line of lines){
   if(signal?.aborted)return [];
   lineNumber++;if(pending)throw pending;if(!line.trim())continue;
   let row:any;try{row=JSON.parse(line)}catch{pending=new Error(`第 ${lineNumber} 行 JSON 无效：${file}`);continue}
   const keep=provider==='codex'?row?.type==='session_meta'||row?.type==='response_item'&&row.payload?.role==='user'||row?.type==='event_msg'&&row.payload?.type==='user_message':row?.type==='user';
   if(keep)retained.push(line);
  }
  if(pending&&lastTerminated)throw pending;
  return signal?.aborted?[]:parseJSONL(retained.join('\n')+'\n',provider,file);
 }finally{signal?.removeEventListener('abort',abort);lines.close();input.destroy()}
}
