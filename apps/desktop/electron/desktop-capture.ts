import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {validProvider} from './platform';
import type {DesktopPreview,Prompt,Provider} from './types';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const desktopAppSchema=z.object({pid:z.number().int().positive(),bundleId:z.string().min(1).max(250),name:z.string().min(1).max(200)}).strict();
export const desktopReadSchema=z.object({app:desktopAppSchema,title:z.string().max(200),truncated:z.boolean(),nodes:z.array(z.object({id:z.string().min(1).max(100),text:z.string().trim().min(1).max(64000)}).strict()).max(1000)}).strict();
// Raw AX text can contain assistant responses and controls. Only a reviewed subset becomes user prompts.
export class DesktopReview {
 private pending:DesktopPreview|null=null;
 constructor(private now=()=>Date.now()){}
 stage(raw:unknown):DesktopPreview {const data=desktopReadSchema.parse(raw);if(new Set(data.nodes.map(n=>n.id)).size!==data.nodes.length)throw new Error('窗口节点 ID 重复');this.pending={...data,token:randomUUID(),capturedAt:new Date(this.now()).toISOString()};return structuredClone(this.pending)}
 confirm(token:unknown,ids:unknown,provider:unknown,conversation:unknown):Prompt[]{
  const data=this.pending;
  if(!data||token!==data.token||this.now()-Date.parse(data.capturedAt)>10*60*1000)throw new Error('预览已过期，请重新读取窗口');
  if(!validProvider(provider)||typeof conversation!=='string'||!conversation.trim()||conversation.length>200)throw new Error('请选择来源平台并填写对话标识');
  if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!data.nodes.some(n=>n.id===id)))throw new Error('请只选择预览中的用户提问');
  const chosen=new Set(ids),occurrences=new Map<string,number>();
  const conversationId='desktop:'+hash(data.app.bundleId+':'+conversation.trim());
  const rows=data.nodes.filter(n=>chosen.has(n.id)).map(n=>{const fingerprint=hash(n.text),ordinal=occurrences.get(fingerprint)??0;occurrences.set(fingerprint,ordinal+1);return {id:hash(`${provider}:${conversationId}:${fingerprint}:${ordinal}`),provider:provider as Provider,conversationId,conversationTitle:conversation.trim(),text:n.text,timestamp:data.capturedAt,capturedAt:data.capturedAt,timeSource:'captured' as const,source:'desktop://'+encodeURIComponent(data.app.bundleId)}});
  return rows;
 }
 clear(){this.pending=null}
}
