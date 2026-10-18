import type {Memory} from '../electron/types';
export const categoryNames={identity:'关于我',preferences:'表达偏好',needs:'需求与约束',procedures:'工作方式',events:'事件与决定'};
export const layerNames={profile:'长期个人',project:'项目记忆',episode:'会话情节'};
export const statusNames={pending:'待确认',accepted:'已确认',rejected:'已忽略',superseded:'历史版本'};
export function MemoryCard({memory:m,memories,busy,onReview,onEvidence,onLocate}:{memory:Memory;memories:Memory[];busy:boolean;onReview:(id:string,status:'accepted'|'rejected')=>void;onEvidence:(m:Memory)=>void;onLocate?:(m:Memory)=>void}){
 const old=memories.find(old=>old.id===m.relatedMemoryId);const replacing=!!m.relatedMemoryId;
 return <article className={`memory-card ${m.status} ${m.action==='conflict'?'conflict':''}`} data-memory-id={m.id}>
  <div className="memory-card-top"><span className="category-dot"/>{categoryNames[m.category]}<span className={'state-chip '+m.status}>{statusNames[m.status]}</span></div>
  <p className="memory-claim">{m.claim}</p>
  <div className="memory-meta"><span>{m.layer?layerNames[m.layer]:'旧版 · 未分层'}</span><span>{m.scope?.kind==='conversation'?'当前会话':m.scope?.label??'范围未标注'}</span>{m.basis&&<span>{m.basis==='explicit'?'明确表达':'推断 · 请核对'}</span>}</div>
  {replacing&&<div className="memory-comparison"><strong>{m.action==='conflict'?'存在冲突，需你决定':'更新建议'}</strong><p>原记忆：{old?.claim??'关联记忆暂不可用'}</p><span>确认后替代原记忆，保留历史版本。</span></div>}
  {m.rationale&&<p className="memory-rationale">{m.rationale}</p>}
  {(m.validFrom||m.expiresAt)&&<div className="memory-time">{m.validFrom&&`生效：${new Date(m.validFrom).toLocaleDateString()}`}{m.expiresAt&&` · 截止：${new Date(m.expiresAt).toLocaleDateString()}`}</div>}
  <div className="evidence-actions"><button className="text-button" onClick={()=>onEvidence(m)}>↗ {m.evidenceIds.length} 条原文证据</button>{onLocate&&<button className="text-button" onClick={()=>onLocate(m)}>← 定位提问</button>}</div>
  <footer><small>模型自评 {Math.round(m.confidence*100)}% · 非准确率</small>{m.status==='pending'?<><button disabled={busy} onClick={()=>onReview(m.id,'rejected')}>忽略</button><button className="confirm" disabled={busy} onClick={()=>onReview(m.id,'accepted')}>{replacing?'确认并替换':'确认记忆'}</button></>:m.status==='accepted'?<button disabled={busy} onClick={()=>onReview(m.id,'rejected')}>撤回</button>:<span>{m.status==='superseded'?'保留原始依据':'未纳入有效记忆'}</span>}</footer>
 </article>
}
