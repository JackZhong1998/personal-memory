import type {Provider} from './types';
export const builtins:Provider[]=['codex','claude','chatgpt','grok','manus','genspark','doubao','doubao-work','deepseek','kimi','qwen','yuanbao','cursor','windsurf','trae'];
export const platformNames:Record<string,string>={codex:'Codex',claude:'Claude',chatgpt:'ChatGPT',grok:'Grok',manus:'Manus',genspark:'Genspark',doubao:'豆包','doubao-work':'豆包工作',deepseek:'DeepSeek',kimi:'Kimi',qwen:'通义 / Qwen',yuanbao:'腾讯元宝',cursor:'Cursor',windsurf:'Windsurf',trae:'Trae'};
export function platformLabel(provider:Provider):string {return platformNames[provider]??provider.replace(/^custom:/,'')}
export function validProvider(value:unknown):value is Provider {return typeof value==='string'&&(builtins.includes(value as Provider)||/^custom:[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(value))}
export function webProvider(url:URL):Provider {
 for(const [host,provider] of [['claude.ai','claude'],['grok.com','grok'],['chatgpt.com','chatgpt'],['manus.im','manus'],['manus.ai','manus'],['genspark.ai','genspark'],['doubao.com','doubao'],['deepseek.com','deepseek'],['kimi.com','kimi'],['kimi.moonshot.cn','kimi'],['tongyi.aliyun.com','qwen'],['qianwen.com','qwen'],['qwen.ai','qwen'],['yuanbao.tencent.com','yuanbao']] as const)if(url.hostname===host||url.hostname.endsWith('.'+host))return provider;
 return `custom:${url.hostname}`;
}
