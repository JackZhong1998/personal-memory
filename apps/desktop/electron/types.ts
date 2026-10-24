export type LocalProvider = 'codex' | 'claude' | 'doubao-work';
export type Provider = 'codex' | 'claude' | 'chatgpt' | 'grok' | 'manus' | 'genspark' | 'doubao' | 'doubao-work' | 'deepseek' | 'kimi' | 'qwen' | 'yuanbao' | 'cursor' | 'windsurf' | 'trae' | `custom:${string}`;
export interface SourceProject {id:string; name:string; path?:string}
export interface Prompt {project?:SourceProject|null; id:string; provider:Provider; conversationId:string; conversationTitle:string; text:string; timestamp:string; source:string; capturedAt?:string; timeSource?:'platform'|'captured'; sourceKeys?:string[]; legacyIds?:string[]; sequence?:number}
export interface Trace {project?:SourceProject|null; id:string; provider:Provider; title:string; count:number; updatedAt:string}
export type MemoryCategory='identity'|'preferences'|'needs'|'procedures'|'events';
export interface MemoryScope {kind:'global'|'project'|'conversation'; label:string}
export interface Memory {id:string; category:MemoryCategory; claim:string; evidenceIds:string[]; evidence?:Pick<Prompt,'id'|'text'|'timestamp'|'provider'|'conversationId'|'source'|'timeSource'>[]; confidence:number; status:'pending'|'accepted'|'rejected'|'superseded'; createdAt:string;
 layer?:'profile'|'project'|'episode'; scope?:MemoryScope; basis?:'explicit'|'inferred'; action?:'add'|'update'|'conflict'; relatedMemoryId?:string; rationale?:string; evidenceQuotes?:{promptId:string;quote:string}[]; validFrom?:string|null; expiresAt?:string|null; analysisVersion?:string; model?:string; supersededBy?:string;
}
export type AnalysisMemory=Pick<Memory,'id'|'category'|'claim'|'layer'|'scope'|'basis'|'validFrom'|'expiresAt'>;
export interface Settings {watchCodex:boolean; watchClaude:boolean; watchDoubaoWork?:boolean; watchBrowser:boolean; model:string; keyPresent:boolean; keyStorageAvailable:boolean; paused:boolean; codexHome?:string; collectionVersion?:number}
export interface Snapshot {traces:Trace[]; memories:Memory[]; settings:Settings; errors:string[]; promptCount:number; historySync?:HistorySyncState}
export interface AnalysisPreview {prompts:Prompt[]; truncated:boolean; characters:number; model:string; existingMemories:AnalysisMemory[]; contextCharacters:number; promptVersion:string}
export interface HistorySyncState {running:boolean; total:number; processed:number; added:number; skipped:number; cancelled:boolean; provider?:LocalProvider; roots:string[]; missing:string[]; errors:string[]}
export interface LocalConnection {provider:LocalProvider; roots:string[];enabled:boolean;available:boolean;state:'watching'|'off'|'paused'|'missing'|'error';errors:string[]}
export interface BrowserConnection {configured:('chrome'|'edge')[];responding:boolean;lastSeenAt?:string;lastReceivedAt?:string;version?:string;enabledSites?:number;pending?:number;sites?:{host:string;enabled:boolean}[]}
export interface ConnectionsState {local:LocalConnection[];browser:BrowserConnection;accessibility:boolean}
export interface Bridge {
 connections():Promise<ConnectionsState>;syncLocalHistory(provider:LocalProvider):Promise<HistorySyncState>;
 syncCodexHistory():Promise<HistorySyncState>; cancelHistorySync():Promise<void>; chooseCodexHome():Promise<boolean>;
 desktopApps():Promise<DesktopApp[]>; desktopPermission():Promise<boolean>;
 desktopPreview(pid:number):Promise<DesktopPreview>;
 desktopCommit(token:string,ids:string[],provider:Provider,conversation:string):Promise<number>;
 snapshot():Promise<Snapshot>; prompts(traceId:string):Promise<Prompt[]>;
 settings(value:Partial<Pick<Settings,'watchCodex'|'watchClaude'|'watchDoubaoWork'|'watchBrowser'|'model'|'paused'>>):Promise<void>;
 saveKey(key:string):Promise<void>; removeKey():Promise<void>; models():Promise<{id:string;name:string}[]>;
 importFile(provider?:Provider):Promise<{added:number;message:string}>; preview(ids:string[]):Promise<AnalysisPreview & {digest:string}>;
 analyze(ids:string[],digest:string):Promise<number>; review(id:string,status:'accepted'|'rejected'):Promise<void>;
 exportData():Promise<boolean>; eraseData():Promise<boolean>; openData():Promise<void>;
 pairBrowser(id:string,browser:'chrome'|'edge'):Promise<void>; openExtension():Promise<void>;
 onChange(callback:()=>void):()=>void;
}
export interface DesktopApp {pid:number; bundleId:string; name:string}
export interface DesktopPreview {token:string; app:DesktopApp; title:string; capturedAt:string; truncated:boolean; nodes:{id:string;text:string}[]}
