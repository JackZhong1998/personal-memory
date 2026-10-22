import {z} from 'zod';
import {createHash} from 'node:crypto';
import {validProvider} from './platform';
import type {Prompt,Provider} from './types';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const schema=z.object({format:z.literal('personal-memory.conversations.v1'),provider:z.string().refine(validProvider,'未知平台，请使用 custom:平台标识'),conversations:z.array(z.object({id:z.string().trim().min(1).max(200),title:z.string().max(200).optional(),messages:z.array(z.object({id:z.string().min(1).max(200),role:z.enum(['user','assistant','system','tool']),text:z.string().max(64000),timestamp:z.string().datetime({offset:true}).optional()}).strict()).max(10000)}).strict()).max(1000)}).strict();
export function parsePortableExport(input:unknown,source:string):Prompt[]{
 const data=schema.parse(input),capturedAt=new Date().toISOString(),seen=new Set<string>();const result:Prompt[]=[];
 for(const c of data.conversations)for(const m of c.messages){
  if(m.role!=='user'||!m.text.trim())continue;
  const conversationId='import:'+c.id,id=hash(`${data.provider}:${conversationId}:${m.id}`);
  if(seen.has(id))throw new Error('导出中有重复的会话 / 消息 ID，请先修正');seen.add(id);
  result.push({id,provider:data.provider as Provider,conversationId,conversationTitle:c.title||c.id,text:m.text.trim(),timestamp:m.timestamp??capturedAt,capturedAt,timeSource:m.timestamp?'platform':'captured',source});
 }
 if(!result.length)throw new Error('文件中没有用户提问');return result;
}
