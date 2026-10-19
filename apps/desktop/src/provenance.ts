import type {Memory,Provider,Trace} from '../electron/types';
import {builtins} from '../electron/platform';
export {platformLabel} from '../electron/platform';
export const providers=builtins;
export function providerList(traces:Trace[]){return [...new Set([...providers,...traces.map(t=>t.provider)])]}
export function sourceStats(traces:Trace[]){return providerList(traces).map(provider=>({provider,conversations:traces.filter(t=>t.provider===provider).length,prompts:traces.filter(t=>t.provider===provider).reduce((n,t)=>n+t.count,0)}))}
export function memoryProviders(memory:Memory):Provider[]{return [...new Set(memory.evidence?.map(p=>p.provider)??[])]}
export function fromPlatform(memory:Memory,provider:Provider|'all'){return provider==='all'||memoryProviders(memory).includes(provider)}
