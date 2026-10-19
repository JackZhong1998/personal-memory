import { createHash } from 'node:crypto';
import type { Prompt, Provider } from './types';
import {parseBrowserExport} from './browser-capture';
type Row = Record<string, any>;
export const hash = (value:string) => createHash('sha256').update(value).digest('hex');
const textOf = (content:unknown):string => {
 if(typeof content==='string') return content;
 if(Array.isArray(content)) return content.filter(x=>typeof x==='string'||['text','input_text'].includes(x?.type)).map(x=>typeof x==='string'?x:x.text??'').join('\n');
 return '';
};
const dateOf=(value:unknown)=>{const d=new Date(typeof value==='number'?value*1000:typeof value==='string'?value:0);return Number.isNaN(d.getTime())?new Date(0).toISOString():d.toISOString()};
function prompt(provider:Provider, conversationId:string, title:string, messageId:string, text:string, time:unknown, source:string):Prompt {
 return {id:hash(`${provider}:${conversationId}:${messageId}`),provider,conversationId,conversationTitle:title||`${provider} · ${conversationId.slice(0,8)}`,text:text.trim(),timestamp:dateOf(time),source};
}
export function parseJSONL(raw:string,provider:'codex'|'claude',source:string):Prompt[] {
 const lines=raw.split('\n');const rows:Row[]=[];
 for(let i=0;i<lines.length;i++){if(!lines[i].trim())continue;try{rows.push(JSON.parse(lines[i]))}catch{if(i!==lines.length-1)throw new Error(`第 ${i+1} 行 JSON 无效：${source}`)}}
 const meta=rows.find(r=>r.type==='session_meta')?.payload;
 const conversation=String(meta?.id??rows.find(r=>r.sessionId)?.sessionId??hash(source));
 const responseMode=provider==='codex'&&rows.some(r=>r.type==='response_item'&&r.payload?.role==='user');
 const result:Prompt[]=[];let ordinal=0;
 for(const row of rows){let body='';let id:string|undefined;
  if(provider==='codex'){
   if(responseMode&&row.type==='response_item'&&row.payload?.role==='user'){body=textOf(row.payload.content);id=row.payload.id}
   else if(!responseMode&&row.type==='event_msg'&&row.payload?.type==='user_message'){body=textOf(row.payload.message);id=row.payload.id}
  }else if(row.type==='user'&&row.message?.role==='user'&&!row.isMeta){body=textOf(row.message.content);id=row.uuid??row.message.id}
  if(!body.trim())continue;
  // Codex writes bootstrap instructions in user-role response items. They are not user prompts.
  if(provider==='codex'&&(/^(# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<user_instructions>)/.test(body.trim())))continue;
  const messageId=String(id??`turn-${ordinal}`);ordinal++;
  result.push(prompt(provider,conversation,'',messageId,body,row.timestamp,source));
 }
 const title=result[0]?.text.split('\n')[0].slice(0,70);if(title)for(const p of result)p.conversationTitle=title;
 return result;
}
export function parseExport(raw:string,source:string):Prompt[]{
 const data=JSON.parse(raw);if(data.format==='tracelet.browser-export.v1')return parseBrowserExport(data);const conversations=Array.isArray(data)?data:Array.isArray(data.conversations)?data.conversations:[data];const result:Prompt[]=[];
 for(const c of conversations){
  let provider:Provider;let messages:Row[];
  if(c.mapping&&typeof c.mapping==='object'){provider='chatgpt';messages=Object.values(c.mapping).map((n:any)=>n.message).filter(Boolean)}
  else if(Array.isArray(c.chat_messages)){provider='claude';messages=c.chat_messages}
  else if(Array.isArray(c.messages)){provider='grok';messages=c.messages}
  else throw new Error('不支持的导出结构。支持 ChatGPT conversations.json、Claude chat_messages、Grok messages（role/content）格式。');
  const cid=String(c.uuid??c.id??c.conversation_id??hash(JSON.stringify(c)));
  messages.forEach((m,i)=>{const role=m.author?.role??m.sender??m.role;if(!['user','human'].includes(role))return;
   const body=textOf(m.text??m.content?.parts??m.content??m.message);if(!body.trim())return;
   result.push(prompt(provider,cid,c.title??c.name??'',String(m.uuid??m.id??`turn-${i}`),body,m.create_time??m.created_at??m.timestamp,source));
  });
 }
 if(!result.length)throw new Error('文件中没有可识别的用户提问。');return result;
}
