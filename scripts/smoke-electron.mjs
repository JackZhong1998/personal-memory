import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import electron from 'electron';
const root=await mkdtemp(join(tmpdir(),'tracelet-smoke-'));await mkdir(join(root,'codex/sessions'),{recursive:true});
await writeFile(join(root,'codex/sessions/smoke.jsonl'),[
 {type:'session_meta',payload:{id:'smoke-conversation'}},
 {type:'response_item',timestamp:'2026-01-01T00:00:00Z',payload:{role:'user',content:[{type:'input_text',text:'请用中文回答。'}]}},
 {type:'response_item',timestamp:'2026-01-01T00:01:00Z',payload:{role:'user',content:[{type:'input_text',text:'我在开发 Mac 应用。'}]}}
].map(r=>JSON.stringify(r)).join('\n')+'\n');
const args=['.','--smoke'];if(process.platform==='linux')args.push('--no-sandbox');
if(process.platform==='linux'&&!process.env.DISPLAY)args.push('--ozone-platform=headless','--disable-gpu');
let output='';const child=spawn(electron,args,{env:{...process.env,TRACELET_SMOKE_DATA:join(root,'data'),CODEX_HOME:join(root,'codex')},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',b=>{output+=b;process.stdout.write(b)});child.stderr.on('data',b=>process.stderr.write(b));
const timeout=setTimeout(()=>child.kill('SIGKILL'),45000);
const code=await new Promise(r=>{child.on('exit',r);child.on('error',()=>r(1))});clearTimeout(timeout);await rm(root,{recursive:true,force:true});
if(code!==0||!output.includes('TRACELET_SMOKE_OK'))process.exitCode=1;
