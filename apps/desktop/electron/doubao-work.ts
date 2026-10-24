import {opendir,readFile,lstat} from 'node:fs/promises';
import {join,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {watch} from 'chokidar';
import {readDoubaoProjects} from './doubao-projects';
import type {Prompt,HistorySyncState,SourceProject} from './types';

// DoubaoWork 2.33.5: only the main agent's local, user-authored turns.
// Never open the app's cookie store, credentials, or write to its workspace.
const id=(s:string)=>createHash('sha256').update(s).digest('hex');
const heading=/^## \[(\d{4}-\d{2}-\d{2}T[^\]\r\n]+)\] 需求\r?$/gm;
const isUserText=(text:string)=>!!text.trim()&&!/^<(?:system-reminder|system|developer|environment_context|subagent-result|task-notification)(?:\s|>)/i.test(text.trim());
export function watchDoubaoWork(roots:string[],changed:()=>void|Promise<void>,error:(e:unknown)=>void){
 let timer:ReturnType<typeof setTimeout>|undefined;
 const directories=roots.map(root=>resolve(root));
 const caches=roots.filter(root=>root.replaceAll('\\','/').endsWith('/.doubaowork/agent_mode/workspace/.sessions')).map(root=>resolve(root,'../../../..','IndexedDB','chrome_doubaowork-chat_0.indexeddb.leveldb'));
 const watcher=watch([...roots,...caches],{ignoreInitial:true,followSymlinks:false,usePolling:true,interval:1000,awaitWriteFinish:{stabilityThreshold:300,pollInterval:100},ignored:(path,info)=>{
  const root=directories.find(root=>path===root||path.startsWith(root+sep));if(!root)return false;
  const parts=relative(root,path).split(sep).filter(Boolean);
  if(parts.length>=2&&parts[1]!=='agents'||parts.length>=3&&!parts[2].startsWith('m_')||parts.length>=4&&parts[3]!=='system')return true;
  return !!info?.isFile()&&parts.at(-1)!=='assignment.md';
 }});
 const ready=new Promise<void>(resolve=>watcher.once('ready',resolve));
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{void Promise.resolve(changed()).catch(error)},300)};
 watcher.on('add',schedule).on('change',schedule).on('error',error);
 return {ready,close:async()=>{clearTimeout(timer);await watcher.close()}};
}
export function parseDoubaoAssignment(raw:string,session:string,agent:string,source:string):Prompt[]{
 const header=raw.split(/^## \[/m)[0];
 if(/^- Role: (?!main\s*$)/m.test(header)||/^- Assigned by: (?!user\s*$)/m.test(header))return [];
 const matches=[...raw.matchAll(heading)],rows:Prompt[]=[],occurrences=new Map<string,number>();
 for(let i=0;i<matches.length;i++){
  const m=matches[i],text=raw.slice(m.index!+m[0].length,matches[i+1]?.index??raw.length).trim();
  if(!isUserText(text))continue;
  const time=Date.parse(m[1]);if(!Number.isFinite(time))throw new Error('豆包工作需求时间无效');
  // Keep the full nanosecond timestamp in the identity, not the rounded JS date.
  const occurrence=occurrences.get(m[1])??0;occurrences.set(m[1],occurrence+1);
  rows.push({id:id(`doubao-work:${session}:${agent}:assignment:${m[1]}:${occurrence}`),provider:'doubao-work',conversationId:session,conversationTitle:'',text,timestamp:new Date(time).toISOString(),timeSource:'platform',source,sequence:rows.length});
 }
 return rows;
}
async function readBounded(file:string){
 try{const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('拒绝读取非普通文件');if(info.size>100*1024*1024)throw new Error('文件超过 100 MB');return await readFile(file,'utf8')}
 catch(e:any){if(e.code==='ENOENT')return undefined;throw e}
}
export async function syncDoubaoWork(roots:string[],upsert:(p:Prompt[])=>Promise<number>,signal:AbortSignal,update:(s:HistorySyncState)=>void):Promise<HistorySyncState>{
 const state:HistorySyncState={provider:'doubao-work',running:true,total:0,processed:0,added:0,skipped:0,cancelled:false,roots:[...roots],missing:[],errors:[]};
 const notify=()=>update(structuredClone(state));
 const fail=(path:string,e:unknown)=>{if(state.errors.length<100)state.errors.push(`${path}: ${e instanceof Error?e.message:String(e)}`)};
 const jobs:{session:string;agent:string;dir:string;projects?:Map<string,SourceProject>}[]=[];
 notify();try{
  for(const root of roots){
   if(signal.aborted)break;
   try{
    const info=await lstat(root);if(info.isSymbolicLink())throw new Error('数据目录不能是符号链接');
    let projects:Map<string,SourceProject>|undefined;try{projects=await readDoubaoProjects(root)}catch(e){fail(root+' (项目分类)',e)}
    const sessions=await opendir(root);
    for await(const session of sessions){
     if(signal.aborted)break;if(!session.isDirectory())continue;
     const agentsDir=join(root,session.name,'agents');
     try{
      if(!(await lstat(agentsDir)).isDirectory()||(await lstat(agentsDir)).isSymbolicLink())continue;
      const agents=await opendir(agentsDir);
      for await(const agent of agents){
       if(signal.aborted)break;
       if(!agent.isDirectory()||!agent.name.startsWith('m_'))continue;
       const dir=join(agentsDir,agent.name,'system');
       try{const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())continue;jobs.push({session:session.name,agent:agent.name,dir,projects});state.total++}catch(e:any){if(e.code!=='ENOENT')fail(dir,e)}
      }
     }catch(e:any){if(e.code!=='ENOENT')fail(agentsDir,e)}
    }
   }catch(e:any){if(e.code==='ENOENT')state.missing.push(root);else fail(root,e)}
  }
  notify();
  for(const job of jobs){
   if(signal.aborted)break;
   try{
    const source=join(job.dir,'assignment.md');
    const raw=await readBounded(source);
    if(raw===undefined)throw new Error('未找到用户需求 assignment.md，未将执行日志冒充用户消息');
    const rows=parseDoubaoAssignment(raw,job.session,job.agent,source);
    const title=rows[0]?.text.split('\n')[0].slice(0,70)||`豆包工作 · ${job.session}`;
    for(const p of rows){p.conversationTitle=title;if(job.projects)p.project=job.projects.get(job.session)??null;}
    if(!signal.aborted)state.added+=await upsert(rows);
   }catch(e){state.skipped++;fail(job.dir,e)}
   state.processed++;notify();await new Promise<void>(r=>setImmediate(r));
  }
 }finally{state.running=false;state.cancelled=signal.aborted;notify()}
 return structuredClone(state);
}
