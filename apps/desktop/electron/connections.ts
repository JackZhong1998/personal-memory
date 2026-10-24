import {access,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import type {BrowserConnection,LocalConnection,LocalProvider} from './types';
export const browserStatusSchema=z.object({format:z.literal('personal-memory.browser.status.v1'),version:z.string().max(40),enabledSites:z.number().int().min(0).max(10000),pending:z.number().int().min(0).max(100000),sites:z.array(z.object({host:z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),enabled:z.boolean()}).strict()).max(200).optional()}).strict();
export async function localConnection(provider:LocalProvider,roots:string[],enabled:boolean,paused:boolean):Promise<LocalConnection>{
 let available=false;const errors:string[]=[];
 for(const path of roots)try{await access(path,constants.R_OK);available=true}catch(e:any){if(e.code!=='ENOENT')errors.push(path+': '+e.message)}
 return {provider,roots,enabled,available,state:paused?'paused':!enabled?'off':errors.length?'error':available?'watching':'missing',errors};
}
export async function browserConnection(dir:string,configured:('chrome'|'edge')[],now=Date.now()):Promise<BrowserConnection>{
 let heartbeat:any;try{heartbeat=JSON.parse(await readFile(join(dir,'browser-connection.json'),'utf8'))}catch{}
 let receivedAt:string|undefined;try{const receipt=JSON.parse(await readFile(join(dir,'browser-delivery.json'),'utf8'));if(Number.isFinite(Date.parse(receipt.receivedAt)))receivedAt=new Date(receipt.receivedAt).toISOString()}catch{}
 const at=Date.parse(heartbeat?.seenAt),fresh=Number.isFinite(at)&&now-at>=0&&now-at<90000;
 const valid=browserStatusSchema.safeParse(heartbeat?.status);
 return {configured,lastReceivedAt:receivedAt,responding:fresh&&valid.success,lastSeenAt:Number.isFinite(at)?new Date(at).toISOString():undefined,...(valid.success?{version:valid.data.version,enabledSites:valid.data.enabledSites,pending:valid.data.pending,sites:valid.data.sites}:{} )};
}
