// Chrome Native Messaging: stdout is reserved for length-prefixed JSON only.
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {browserPrompts,frame} from './browser-capture';
export {frame} from './browser-capture';
export const MAX_FRAME=1024*1024;
export async function receive(packet:unknown,dir:string){
 browserPrompts(packet);
 const settings=JSON.parse(await readFile(join(dir,'settings.json'),'utf8'));
 if(settings.paused||!settings.watchBrowser)return {ok:false,error:'桌面同步已暂停'};
 const inbox=join(dir,'browser-inbox');await mkdir(inbox,{recursive:true,mode:0o700});
 const id=randomUUID(),target=join(inbox,id+'.json');await writeFile(target+'.tmp',JSON.stringify(packet),{mode:0o600});await rename(target+'.tmp',target);
 return {ok:true,queued:true};
}
export function runHost(dir:string){let buffer=Buffer.alloc(0),pending=Promise.resolve();
 process.stdin.on('data',(chunk:Buffer)=>{buffer=Buffer.concat([buffer,chunk]);
  while(buffer.length>=4){const length=buffer.readUInt32LE(0);if(!length||length>MAX_FRAME){process.exitCode=1;process.stdin.destroy();return}if(buffer.length<length+4)return;
   const body=buffer.subarray(4,4+length);buffer=buffer.subarray(4+length);
   pending=pending.then(async()=>{let result;try{result=await receive(JSON.parse(body.toString('utf8')),dir)}catch{result={ok:false,error:'无法保存采集内容，请检查桌面连接与数据格式'}}process.stdout.write(frame(result))});
  }
 });
}
if(process.argv.includes('--data-dir')){const dir=process.argv[process.argv.indexOf('--data-dir')+1];if(dir)runHost(dir);else process.exitCode=1}
