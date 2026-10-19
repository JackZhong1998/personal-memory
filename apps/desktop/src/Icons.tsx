import brandIcon from '../../../assets/brand/icon-128.png';
import type {ReactNode} from 'react';
import type {Provider} from '../electron/types';
import {platformLabel} from './provenance';
export function Icon({name,size=18}:{name:string;size?:number}){
 if(name==='logo')return <img src={brandIcon} width={size} height={size} alt="" aria-hidden="true"/>;
 const paths:Record<string,ReactNode>={
  workspace:<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 4v16M14 9h3m-3 5h3"/></>,
  overview:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  traces:<><path d="M8 4h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M3 8v12a2 2 0 0 0 2 2h11M10 9h7m-7 5h5"/></>,
  memories:<><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/></>,
  settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/></>,
  add:<path d="M12 5v14M5 12h14"/>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  arrow:<path d="m9 5 7 7-7 7"/>,lock:<><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></>,
  source:<><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10m-10 5h6"/></>
 };
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.source}</svg>
}
export function PlatformMark({provider}:{provider:Provider}){
 const shapes:Partial<Record<Provider,ReactNode>>={codex:<><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14"/></>,claude:<>{Array.from({length:8},(_,i)=><path key={i} d="M12 3v5" transform={`rotate(${i*45} 12 12)`}/>)}</>,chatgpt:<><path d="m12 3 8 5v8l-8 5-8-5V8l8-5Zm0 5 4 2.5v4L12 17l-4-2.5v-4L12 8Z"/></>,grok:<path d="m17 3-6 7h6L7 21l3-9H5L17 3Z"/>};
 return <span className={'platform-mark '+provider}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[provider]??<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/></>}</svg></span>
}
export function PlatformPill({provider}:{provider:Provider}){return <span className={'platform-pill '+provider}><PlatformMark provider={provider}/>{platformLabel(provider)}</span>}
