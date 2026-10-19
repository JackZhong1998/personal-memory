import type {Provider} from './types';
export const builtins:Provider[]=['codex','claude','chatgpt','grok','manus','genspark'];
export function platformLabel(provider:Provider):string {return ({codex:'Codex',claude:'Claude',chatgpt:'ChatGPT',grok:'Grok',manus:'Manus',genspark:'Genspark'} as Record<string,string>)[provider]??provider.replace(/^custom:/,'')}
export function webProvider(url:URL):Provider {
 for(const [host,provider] of [['claude.ai','claude'],['grok.com','grok'],['chatgpt.com','chatgpt'],['manus.im','manus'],['manus.ai','manus'],['genspark.ai','genspark']] as const)if(url.hostname===host||url.hostname.endsWith('.'+host))return provider;
 return `custom:${url.hostname}`;
}
