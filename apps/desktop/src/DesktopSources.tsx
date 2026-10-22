import {useEffect,useState} from 'react';
import type {Bridge,DesktopApp,DesktopPreview,Provider} from '../electron/types';
import {builtins,platformLabel} from '../electron/platform';
export function DesktopSources({api,paused,onImported,onImport}:{api:Bridge;paused:boolean;onImported:()=>Promise<void>;onImport:()=>void}){
 const [apps,setApps]=useState<DesktopApp[]>([]),[pid,setPid]=useState(''),[provider,setProvider]=useState<Provider>('doubao'),[custom,setCustom]=useState(''),[conversation,setConversation]=useState('');
 const [preview,setPreview]=useState<DesktopPreview|null>(null),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const act=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn()}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 useEffect(()=>{if(paused){setPreview(null);setSelected([])}},[paused]);
 const actual=provider==='custom:desktop'?`custom:${custom}` as Provider:provider;
 return <div className="desktop-sources">
  <section className="settings-section"><h2>桌面应用</h2><p>打开目标应用中的对话，读取窗口后只勾选你发出的提问。需 macOS 辅助功能授权。</p>
   <div className="data-actions"><button className="button" disabled={busy} onClick={()=>void act(async()=>{const trusted=await api.desktopPermission();setNotice(trusted?'辅助功能已授权':'请在系统设置 → 隐私与安全性 → 辅助功能中开启 Personal Memory，然后重试。')})}>授权辅助功能</button><button className="button" disabled={busy} onClick={()=>void act(async()=>{setPreview(null);setSelected([]);const list=await api.desktopApps();setApps(list);setPid('');setNotice(list.length?'选择正在运行的应用':'未找到运行中的应用')})}>刷新应用列表</button></div>
   <div className="capture-fields"><label>来源平台<select aria-label="桌面来源平台" disabled={busy} value={provider} onChange={e=>{setProvider(e.target.value as Provider);setPreview(null);setSelected([])}}>{builtins.map(p=><option key={p} value={p}>{platformLabel(p)}</option>)}<option value="custom:desktop">自定义平台</option></select></label>{provider==='custom:desktop'&&<label>平台标识<input aria-label="自定义桌面平台标识" placeholder="例如 my-agent" value={custom} maxLength={151} onChange={e=>setCustom(e.target.value)}/></label>}
   <label>运行中的应用<select aria-label="选择桌面应用" disabled={busy} value={pid} onChange={e=>{setPid(e.target.value);setPreview(null);setSelected([])}}><option value="">选择应用</option>{apps.map(a=><option key={a.pid} value={a.pid}>{a.name} · {a.bundleId}</option>)}</select></label>
   <label>对话标识<input aria-label="桌面对话标识" maxLength={200} placeholder="同一对话复用标识；新对话请换一个" value={conversation} onChange={e=>setConversation(e.target.value)}/></label></div>
   <button className="button primary" disabled={busy||paused||!pid} onClick={()=>void act(async()=>{setPreview(null);setSelected([]);const result=await api.desktopPreview(Number(pid));setPreview(result);setNotice(result.nodes.length?'请勾选已发送的用户提问，排除助手回答、标题和按钮。':'应用未开放可读文本；可改用网页版或导入文件。')})}>{busy?'处理中…':'读取窗口预览'}</button>
   {paused&&<p role="status">采集已暂停，请在连接与设置中恢复。</p>}
   <p className="fine-print">一次只读取所选应用的一个窗口，不持续监听。内容先留在内存，确认后才入库；不会自动发送给 AI。应用不提供可访问文本时无法读取。</p>
  </section>
  {preview&&<section className="settings-section"><h2>核对用户提问 <small>{selected.length} / {preview.nodes.length}</small></h2><p>{preview.app.name} · {preview.title}</p>{preview.truncated&&<p role="status">窗口内容过多，本次仅展示部分文本。</p>}<div className="capture-preview">{preview.nodes.map(n=><label className="capture-candidate" key={n.id}><input type="checkbox" aria-label={'保留文本 '+n.id} disabled={busy} checked={selected.includes(n.id)} onChange={e=>setSelected(e.target.checked?[...selected,n.id]:selected.filter(id=>id!==n.id))}/><span>{n.text}</span></label>)}</div><div className="data-actions"><button className="button" disabled={busy} onClick={()=>{setPreview(null);setSelected([])}}>丢弃预览</button><button className="button primary" disabled={busy||paused||!selected.length||!conversation.trim()||(provider==='custom:desktop'&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(custom))} onClick={()=>void act(async()=>{const added=await api.desktopCommit(preview.token,selected,actual,conversation);setPreview(null);setSelected([]);await onImported();setNotice(`已入库，新增 ${added} 条提问。可在记忆工作台按平台查看。`)})}>确认这些是我的提问并入库</button></div></section>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  <section className="settings-section"><h2>其他接入方式</h2><div className="setting-row"><div><strong>Codex / Claude Code</strong><p>本地文件持续同步，在连接与设置中开启。</p></div></div><div className="setting-row"><div><strong>网页版 AI / 自定义网站</strong><p>豆包、DeepSeek、Kimi、通义、元宝、ChatGPT、Claude、Grok、Manus、Genspark。模板需逐站预览验证。</p></div></div><div className="setting-row"><div><strong>对话文件导入</strong><p>平台原生格式或带来源标识的通用 JSON，可接入其他 Agent。</p></div><button className="button" onClick={onImport}>导入文件</button></div></section>
 </div>;
}
