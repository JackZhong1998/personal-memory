export type Provider = 'codex' | 'claude' | 'chatgpt' | 'grok';
export interface Prompt {id:string; provider:Provider; conversationId:string; conversationTitle:string; text:string; timestamp:string; source:string}
export interface Trace {id:string; provider:Provider; title:string; count:number; updatedAt:string}
export type MemoryCategory='identity'|'preferences'|'needs'|'procedures'|'events';
export interface MemoryScope {kind:'global'|'project'|'conversation'; label:string}
export interface Memory {id:string; category:MemoryCategory; claim:string; evidenceIds:string[]; evidence?:Pick<Prompt,'id'|'text'|'timestamp'|'provider'|'conversationId'>[]; confidence:number; status:'pending'|'accepted'|'rejected'|'superseded'; createdAt:string;
 layer?:'profile'|'project'|'episode'; scope?:MemoryScope; basis?:'explicit'|'inferred'; action?:'add'|'update'|'conflict'; relatedMemoryId?:string; rationale?:string; evidenceQuotes?:{promptId:string;quote:string}[]; validFrom?:string|null; expiresAt?:string|null; analysisVersion?:string; model?:string; supersededBy?:string;
}
export type AnalysisMemory=Pick<Memory,'id'|'category'|'claim'|'layer'|'scope'|'basis'|'validFrom'|'expiresAt'>;
export interface Settings {watchCodex:boolean; watchClaude:boolean; model:string; keyPresent:boolean; keyStorageAvailable:boolean; paused:boolean}
export interface Snapshot {traces:Trace[]; memories:Memory[]; settings:Settings; errors:string[]; promptCount:number}
export interface AnalysisPreview {prompts:Prompt[]; truncated:boolean; characters:number; model:string; existingMemories:AnalysisMemory[]; contextCharacters:number; promptVersion:string}
export interface Bridge {
 snapshot():Promise<Snapshot>; prompts(traceId:string):Promise<Prompt[]>;
 settings(value:Partial<Pick<Settings,'watchCodex'|'watchClaude'|'model'|'paused'>>):Promise<void>;
 saveKey(key:string):Promise<void>; removeKey():Promise<void>; models():Promise<{id:string;name:string}[]>;
 importFile():Promise<{added:number;message:string}>; preview(ids:string[]):Promise<AnalysisPreview & {digest:string}>;
 analyze(ids:string[],digest:string):Promise<number>; review(id:string,status:'accepted'|'rejected'):Promise<void>;
 exportData():Promise<boolean>; eraseData():Promise<boolean>; openData():Promise<void>;
 onChange(callback:()=>void):()=>void;
}
