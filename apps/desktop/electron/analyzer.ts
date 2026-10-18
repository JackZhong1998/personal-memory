import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { hash } from './parsers';
import type { AnalysisPreview, Memory, Prompt, AnalysisMemory } from './types';
import { SYSTEM, ANALYSIS_VERSION } from './memory-prompt';
export {SYSTEM,ANALYSIS_VERSION};
const scopeSchema=z.object({kind:z.enum(['global','project','conversation']),label:z.string().trim().min(1).max(160)}).strict();
const itemSchema=z.object({
 category:z.enum(['identity','preferences','needs','procedures','events']),claim:z.string().trim().min(1).max(1200),
 layer:z.enum(['profile','project','episode']),scope:scopeSchema,basis:z.enum(['explicit','inferred']),
 action:z.enum(['add','update','conflict','duplicate']),relatedMemoryId:z.string().min(1).nullable(),
 evidenceIds:z.array(z.string()).min(1).max(20),evidenceQuotes:z.array(z.object({promptId:z.string(),quote:z.string().trim().min(2).max(1200)}).strict()).min(1).max(30),
 rationale:z.string().trim().min(1).max(600),confidence:z.number().min(0).max(1),
 validFrom:z.string().datetime({offset:true}).nullable(),expiresAt:z.string().datetime({offset:true}).nullable()
}).strict();
const schema=z.object({memories:z.array(itemSchema).max(12)}).strict();
export const traceId=(p:Pick<Prompt,'provider'|'conversationId'>)=>`${p.provider}:${p.conversationId}`;
export const sameScope=(a?:Memory['scope'],b?:Memory['scope'])=>!!a&&!!b&&a.kind===b.kind&&a.label.normalize('NFKC').trim().toLowerCase()===b.label.normalize('NFKC').trim().toLowerCase();
export const wirePrompt=(p:Prompt)=>({id:p.id,text:p.text,traceId:traceId(p),timestamp:p.timestamp});
function terms(text:string){const tokens:string[]=text.toLowerCase().match(/[a-z0-9_-]{2,}/g)??[];for(const run of text.match(/[\u4e00-\u9fff]{2,}/g)??[])for(let i=0;i<run.length-1;i++)tokens.push(run.slice(i,i+2));return new Set(tokens)}
export function relevantMemories(prompts:Prompt[],memories:Memory[]):AnalysisMemory[]{
 const words=terms(prompts.map(p=>p.text).join('\n'));const ids=new Set(prompts.map(p=>p.id));const traces=new Set(prompts.map(traceId));
 const ranked=memories.filter(m=>m.status==='accepted').map((m,index)=>({m,index,score:(m.evidenceIds.some(id=>ids.has(id))?100:0)+(m.evidence?.some(p=>traces.has(traceId(p)))||m.scope?.kind==='conversation'&&traces.has(m.scope.label)?80:0)+[...terms(m.claim+' '+(m.scope?.label??''))].filter(t=>words.has(t)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
 let size=0;const result:AnalysisMemory[]=[];
 for(const {m} of ranked){const row:AnalysisMemory={id:m.id,category:m.category,claim:m.claim,layer:m.layer,scope:m.scope,basis:m.basis,validFrom:m.validFrom,expiresAt:m.expiresAt};const chars=JSON.stringify(row).length;if(size+chars+result.length+2>12000)continue;result.push(JSON.parse(JSON.stringify(row)));size+=chars;if(result.length===24)break}return result;
}
export function preview(prompts:Prompt[],model:string,memories:Memory[]=[]):AnalysisPreview {
 let chars=0;const selected:Prompt[]=[];for(const p of prompts){const size=JSON.stringify(wirePrompt(p)).length;if(chars+size>40000)continue;selected.push(p);chars+=size;if(selected.length>=100)break}
 const existingMemories=relevantMemories(selected,memories);
 return {prompts:selected,truncated:selected.length<prompts.length,characters:chars,model,existingMemories,contextCharacters:JSON.stringify(existingMemories).length,promptVersion:ANALYSIS_VERSION};
}
export const digest=(p:AnalysisPreview)=>hash(JSON.stringify({model:p.model,prompts:p.prompts.map(wirePrompt),existingMemories:p.existingMemories,promptVersion:p.promptVersion}));
export function validateMemories(data:unknown,prompts:Prompt[],existing:AnalysisMemory[]=[],model?:string):Memory[]{
 const parsed=schema.parse(data);const byId=new Map(prompts.map(p=>[p.id,p]));const old=new Map(existing.map(m=>[m.id,m]));
 for(const m of parsed.memories){
  if(m.evidenceIds.some(id=>!byId.has(id)))throw new Error('AI 返回了不存在的证据，已拒绝保存。');
  if(m.evidenceQuotes.some(q=>!m.evidenceIds.includes(q.promptId)||!byId.get(q.promptId)?.text.includes(q.quote))||m.evidenceIds.some(id=>!m.evidenceQuotes.some(q=>q.promptId===id)))throw new Error('AI 引用的原文与证据不匹配，已拒绝保存。');
  if(m.layer==='profile'&&(m.scope.kind!=='global'||m.scope.label!=='用户')||m.layer==='project'&&m.scope.kind!=='project'||m.layer==='episode'&&m.scope.kind==='global')throw new Error('记忆层级与适用范围不匹配。');
  if(m.category==='identity'&&(m.basis!=='explicit'||m.layer!=='profile'))throw new Error('身份记忆必须来自明确自述。');
  if(m.scope.kind==='conversation'&&m.evidenceIds.some(id=>traceId(byId.get(id)!)!==m.scope.label))throw new Error('会话记忆引用了其他会话的范围。');
  if(m.validFrom&&m.expiresAt&&Date.parse(m.expiresAt)<Date.parse(m.validFrom))throw new Error('记忆有效时间顺序无效。');
  if(m.action==='add'){if(m.relatedMemoryId!==null)throw new Error('新增记忆不能替换旧记忆。')}
  else {const target=m.relatedMemoryId&&old.get(m.relatedMemoryId);if(!target||target.category!==m.category||!sameScope(target.scope,m.scope))throw new Error('记忆关联目标不存在或适用范围不同。')}
 }
 return parsed.memories.filter(m=>m.action!=='duplicate').map(m=>({...m,action:m.action as 'add'|'update'|'conflict',relatedMemoryId:m.relatedMemoryId??undefined,evidence:prompts.filter(p=>m.evidenceIds.includes(p.id)).map(({id,text,timestamp,provider,conversationId})=>({id,text,timestamp,provider,conversationId})),id:randomUUID(),status:'pending',createdAt:new Date().toISOString(),analysisVersion:ANALYSIS_VERSION,model}));
}
export async function analyze(input:AnalysisPreview,key:string):Promise<Memory[]>{
 const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
  method:'POST',signal:AbortSignal.timeout(120000),
  headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json','X-Title':'Tracelet'},
  body:JSON.stringify({model:input.model,temperature:0.1,max_tokens:6000,response_format:{type:'json_object'},messages:[
   {role:'system',content:SYSTEM},
   {role:'user',content:JSON.stringify({promptVersion:input.promptVersion,prompts:input.prompts.map(wirePrompt),existingMemories:input.existingMemories})}
  ]})
 });
 if(!response.ok)throw new Error(`OpenRouter 请求失败 (${response.status})。请检查 API Key、额度和模型权限。`);
 const json:any=await response.json();if(json.choices?.[0]?.finish_reason==='length')throw new Error('模型输出被截断，未保存记忆。请缩小选择范围后重试。');const content=json.choices?.[0]?.message?.content;
 if(typeof content!=='string')throw new Error('模型没有返回可解析的内容。');
 let data:unknown;try{data=JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{throw new Error('模型未返回有效 JSON；没有保存任何记忆。')}
 return validateMemories(data,input.prompts,input.existingMemories,input.model);
}
