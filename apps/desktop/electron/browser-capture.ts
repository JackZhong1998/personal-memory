import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Prompt} from './types';
import {webProvider} from './platform';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const captureSchema=z.object({format:z.literal('tracelet.browser.capture.v1'),url:z.string().max(4096),conversationId:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().max(200),capturedAt:z.string().datetime({offset:true}),messages:z.array(z.object({id:z.string().min(1).max(200),role:z.literal('user'),text:z.string().trim().min(1).max(64000),timestamp:z.string().datetime({offset:true}).optional(),capturedAt:z.string().datetime({offset:true}).optional()})).min(1).max(50)}).strict();
export function browserPrompts(input:unknown):Prompt[]{
 const packet=captureSchema.parse(input);const url=new URL(packet.url);
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw new Error('浏览器来源必须是标准 HTTPS 页面');
 const provider=webProvider(url);url.search='';url.hash='';
 const conversationId='web:'+packet.conversationId;
 return packet.messages.map(m=>({id:hash(`${provider}:${conversationId}:${m.id}`),provider,conversationId,conversationTitle:packet.title||url.hostname,text:m.text,timestamp:m.timestamp??m.capturedAt??packet.capturedAt,source:url.href,capturedAt:new Date(m.capturedAt??packet.capturedAt).toISOString(),timeSource:m.timestamp?'platform':'captured'}));
}
export function parseBrowserExport(input:unknown):Prompt[]{
 const data=z.object({format:z.literal('tracelet.browser-export.v1'),captures:z.array(z.unknown()).max(10000)}).parse(input);
 return data.captures.flatMap(browserPrompts);
}

export function frame(value:unknown){const body=Buffer.from(JSON.stringify(value));const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body])}
