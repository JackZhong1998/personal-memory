import type {Memory} from '../electron/types';
import {PlatformPill} from './Icons';
import {memoryProviders} from './provenance';
export const categoryNames={identity:'关于我',preferences:'表达偏好',needs:'需求与约束',procedures:'工作方式',events:'事件与决定'};
export const layerNames={profile:'长期个人',project:'项目记忆',episode:'会话情节'};
export const statusNames={pending:'待确认',accepted:'已确认',rejected:'已忽略',superseded:'历史版本'};
export function MemoryCard({memory:m,memories,busy,onReview,onEvidence,onLocate}:{memory:Memory;memories:Memory[];busy:boolean;onReview:(id:string,status:'accepted'|'rejected')=>void;onEvidence:(m:Memory)=>void;onLocate?:(m:Memory)=>void}){
 const old=memories.find(old=>old.id===m.relatedMemoryId);const replacing=!!m.relatedMemoryId;
 return <article className={`memory-card ${m.status} ${m.action==='conflict'?'conflict':''}`} data-memory-id={m.id}>
  <div className="memory-card-top"><span className={'category-dot '+m.category}/>{categoryNames[m.category]}<span className={'state-chip '+m.status}>{statusNames[m.status]}</span></div>
  <p className="memory-claim">{m.claim}</p>
  <div className="memory-meta"><span>{m.layer?layerNames[m.layer]:'未分层'}</span><span>{m.scope?.kind==='conversation'?'会话范围':m.scope?.label??'未标注范围'}</span>{m.basis==='inferred'&&<span className="inference-chip">推断</span>}</div>
  <div className="memory-provenance" aria-label="记忆来源">{memoryProviders(m).map(p=><PlatformPill key={p} provider={p}/>)}{!memoryProviders(m).length&&<span className="unknown-source">来源未标注</span>}</div>
  {replacing&&<div className="memory-comparison"><strong>{m.status==='accepted'?'已替换旧版本':m.action==='conflict'?'待解决冲突':'更新建议'}</strong><p>{old?.claim??'关联记忆不可用'}</p></div>}
  <details className="memory-details"><summary>详情</summary>{m.rationale&&<p>{m.rationale}</p>}<p>{m.basis==='explicit'?'明确表达':m.basis==='inferred'?'模型推断':'旧版记录'} · 模型自评 {Math.round(m.confidence*100)}%（非准确率）</p></details>
  {(m.validFrom||m.expiresAt)&&<div className="memory-time">{m.validFrom&&`生效：${new Date(m.validFrom).toLocaleDateString()}`}{m.expiresAt&&` · 截止：${new Date(m.expiresAt).toLocaleDateString()}`}</div>}
  <footer><div className="evidence-actions"><button className="text-button" onClick={()=>onEvidence(m)}>原文 {m.evidenceIds.length}</button>{onLocate&&<button className="text-button" onClick={()=>onLocate(m)}>定位提问</button>}</div>{m.status==='pending'?<><button className="dismiss" disabled={busy} onClick={()=>onReview(m.id,'rejected')}>忽略</button><button className="confirm" disabled={busy} onClick={()=>onReview(m.id,'accepted')}>{replacing?'确认替换':'确认记忆'}</button></>:m.status==='accepted'?<button className="dismiss" disabled={busy} onClick={()=>onReview(m.id,'rejected')}>撤回</button>:<span>{m.status==='superseded'?'历史版本':'已忽略'}</span>}</footer>
 </article>
}
