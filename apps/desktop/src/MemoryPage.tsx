import type {Snapshot} from '../electron/types';
import {SYSTEM,ANALYSIS_VERSION} from '../electron/memory-prompt';
import {categoryNames,layerNames} from './MemoryCard';
import {Icon} from './Icons';
export function MemoryPage({data}:{data:Snapshot}){
 const memories=data.memories.filter(m=>m.status==='pending'||m.status==='accepted');
 return <section className="memory-page" aria-label="记忆总结"><section className="protocol-pane"><div className="detail-heading"><div><span className="overline">提炼规则</span><h2>System Prompt</h2></div><span className="neutral-badge">只读</span></div><div className="protocol-version">{ANALYSIS_VERSION}</div><pre className="system-prompt">{SYSTEM}</pre></section><section className="results-pane"><div className="detail-heading"><h2>总结结果 <small>{memories.length}</small></h2><span className="neutral-badge">分析已暂停</span></div><div className="memory-results">{memories.length>0&&<p className="muted previous-results">仅显示已有结果</p>}{memories.map(m=><article className="result-card" key={m.id}><div><span>{categoryNames[m.category]}</span><span>{m.layer?layerNames[m.layer]:'未分层'}</span><span>{m.status==='accepted'?'已确认':'待确认'}</span></div><p>{m.claim}</p><footer>{m.scope?.label??'未标注范围'} · {m.evidenceIds.length} 条证据</footer></article>)}{!memories.length&&<div className="page-empty"><Icon name="memories" size={30}/><h3>尚未生成总结</h3><span>先确认左侧提炼规则</span></div>}</div></section></section>
}
