import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Bridge,Snapshot} from '../electron/types';
import {DataPage} from './DataPage';
import {MemoryPage} from './MemoryPage';
import {ConnectionsPage} from './ConnectionsPage';
import {Icon} from './Icons';
import './style.css';
import './product.css';
declare global{interface Window{tracelet:Bridge}}
const api=window.tracelet;
const pages=[['data','traces','采集数据'],['memory','memories','记忆总结'],['connections','settings','连接设置']] as const;
function App(){
 const [data,setData]=useState<Snapshot>(),[page,setPage]=useState('data'),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const refresh=async()=>{try{setData(await api.snapshot())}catch(e){setNotice(String(e))}};
 useEffect(()=>{void refresh();return api.onChange(()=>void refresh())},[]);
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{const result=await fn();if(result&&typeof result==='object'&&'message' in result)setNotice(String(result.message));await refresh()}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 if(!data)return <div className="loading"><Icon name="logo" size={40}/><p>{notice||'正在打开…'}</p></div>;
 const syncing=!!data.historySync?.running;
 return <div className="app simple-app"><aside className="sidebar"><a className="brand" onClick={()=>setPage('data')}><Icon name="logo" size={32}/><span className="brand-name">Personal<br/>Memory</span></a><nav aria-label="主导航">{pages.map(([id,icon,label])=><button key={id} className={'nav '+(page===id?'active':'')} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon name={icon}/>{label}</button>)}</nav><div className="sidebar-bottom"><Icon name="lock" size={13}/> 数据保存在本机<span className="version">v0.7.1</span></div></aside><main><header><span>{pages.find(p=>p[0]===page)?.[2]}</span><button className="global-status" onClick={()=>setPage('connections')}><i className={data.settings.paused?'paused':''}/>{data.settings.paused?'采集已暂停':syncing?'历史同步中':data.settings.watchCodex||data.settings.watchClaude||data.settings.watchBrowser?'本地采集':'未开启采集'}</button></header><div className="content"><div className="page-heading"><h1>{pages.find(p=>p[0]===page)?.[2]}</h1><div className="heading-actions">{data.settings.paused&&<button className="button" disabled={busy} onClick={()=>void run(()=>api.settings({paused:false}))}>恢复采集</button>}{page==='data'&&<button className="button primary" disabled={busy||syncing||data.settings.paused} onClick={()=>void run(async()=>{let added=0,files=0,cancelled=false;const failures:string[]=[];for(const provider of ['codex','claude'] as const){const result=await api.syncLocalHistory(provider);added+=result.added;files+=result.total;failures.push(...result.errors);if(result.cancelled){cancelled=true;break}}return {message:(cancelled?'同步已停止':files?'同步结束':'未找到本地会话，请在连接设置中检查目录')+` · 新增 ${added} 条`+(failures.length?'\n'+failures.slice(0,3).join('\n'):'')}})}><Icon name="source" size={14}/>{syncing?'同步中…':'立即同步'}</button>}{page==='connections'&&<button className="button" disabled={busy||data.settings.paused} onClick={()=>void run(()=>api.settings({paused:true}))}>暂停采集</button>}</div></div>
 {notice&&<div className="notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={()=>setNotice('')}>×</button></div>}{data.errors.length>0&&<details className="error-panel"><summary>采集异常 · {data.errors.length}</summary>{data.errors.map((e,i)=><p key={i}>{e}</p>)}</details>}
 {page==='data'&&syncing&&<div className="sync-strip" role="status">{data.historySync?.provider==='claude'?'Claude Code':'Codex'} · {data.historySync?.processed}/{data.historySync?.total} 个文件 · 新增 {data.historySync?.added} 条<button className="text-button" onClick={()=>void api.cancelHistorySync()}>停止</button></div>}
 {page==='data'&&<DataPage data={data} onConnect={()=>setPage('connections')}/>}{page==='memory'&&<MemoryPage data={data}/>}{page==='connections'&&<ConnectionsPage data={data} api={api} run={run} refresh={refresh}/>}
 </div></main></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
