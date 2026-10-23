import {createHash} from 'node:crypto';
import type {Prompt} from './types';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
// Keep persisted message IDs when old event-only rollouts later acquire response items.
export function reconcileCodexIdentities(rows:Prompt[],existing:Prompt[]):Prompt[]{
 const result=rows.map(p=>({...p})),used=new Set<string>(),occupied=new Set(existing.map(p=>p.id));
 const assign=(p:Prompt,old:Prompt)=>{p.id=old.id;p.sourceKeys=[...new Set([...(old.sourceKeys??[]),...(p.sourceKeys??[])])];used.add(old.id)};
 const matched=new Set<Prompt>();
 for(const p of result){const old=existing.find(o=>!used.has(o.id)&&o.sourceKeys?.some(key=>p.sourceKeys?.includes(key)));if(old){assign(p,old);matched.add(p)}}
 for(const p of result.filter(p=>!matched.has(p))){const old=existing.find(o=>!used.has(o.id)&&!o.sourceKeys?.length&&o.text===p.text&&o.timestamp===p.timestamp);if(old){assign(p,old);matched.add(p)}}
 for(const p of result.filter(p=>!matched.has(p))){
  const old=existing.find(o=>!used.has(o.id)&&!o.sourceKeys?.length&&[p.id,...(p.legacyIds??[])].includes(o.id));
  if(old){assign(p,old);continue}
  if(occupied.has(p.id)){const key=p.sourceKeys?.[0];if(!key)throw new Error('Codex message identity missing');p.id=hash('codex-history:'+key);if(occupied.has(p.id))throw new Error('Codex message identity conflict')}
  occupied.add(p.id);
 }
 return result;
}
