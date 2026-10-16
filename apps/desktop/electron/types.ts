export type Provider = 'codex' | 'claude' | 'chatgpt' | 'grok';
export interface Prompt {id:string; provider:Provider; conversationId:string; conversationTitle:string; text:string; timestamp:string; source:string}
export interface Trace {id:string; provider:Provider; title:string; count:number; updatedAt:string}
export interface Memory {id:string; category:'identity'|'preferences'|'needs'; claim:string; evidenceIds:string[]; evidence?:Pick<Prompt,'id'|'text'|'timestamp'|'provider'|'conversationId'>[]; confidence:number; status:'pending'|'accepted'|'rejected'; createdAt:string}
export interface Settings {watchCodex:boolean; watchClaude:boolean; model:string; keyPresent:boolean; keyStorageAvailable:boolean; paused:boolean}
export interface Snapshot {traces:Trace[]; memories:Memory[]; settings:Settings; errors:string[]; promptCount:number}
export interface AnalysisPreview {prompts:Prompt[]; truncated:boolean; characters:number; model:string}
export interface Bridge {
 snapshot():Promise<Snapshot>; prompts(traceId:string):Promise<Prompt[]>;
 settings(value:Partial<Pick<Settings,'watchCodex'|'watchClaude'|'model'|'paused'>>):Promise<void>;
 saveKey(key:string):Promise<void>; removeKey():Promise<void>; models():Promise<{id:string;name:string}[]>;
 importFile():Promise<{added:number;message:string}>; preview(ids:string[]):Promise<AnalysisPreview & {digest:string}>;
 analyze(ids:string[],digest:string):Promise<number>; review(id:string,status:'accepted'|'rejected'):Promise<void>;
 exportData():Promise<boolean>; eraseData():Promise<boolean>; openData():Promise<void>;
 onChange(callback:()=>void):()=>void;
}
