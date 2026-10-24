import {readFile,lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {deserialize} from 'node:v8';
import type {SourceProject} from './types';

// Read only the chat origin's LevelDB files. Never open LevelDB itself (which
// would create locks/journals), cookies, login data, or the source app's profile.
const cacheName='chrome_doubaowork-chat_0.indexeddb.leveldb';
const schema='conversation-list-data-project-v4';
const limit=128*1024*1024;
type Cursor={i:number};
function vint(b:Buffer,p:Cursor){let n=0,shift=0;while(p.i<b.length&&shift<=49){const x=b[p.i++];n+=(x&127)*2**shift;if(x<128&&Number.isSafeInteger(n))return n;shift+=7}throw new Error('无效的缓存整数')}
function slice(b:Buffer,p:Cursor){const len=vint(b,p);if(len>b.length-p.i)throw new Error('缓存记录不完整');const result=b.subarray(p.i,p.i+len);p.i+=len;return result}
export function levelLogRecords(b:Buffer):Buffer[]{
 const records:Buffer[]=[];let parts:Buffer[]=[];
 for(let i=0;i+7<=b.length;){const left=32768-i%32768;if(left<7){i+=left;continue}const len=b.readUInt16LE(i+4),type=b[i+6];if(!len){i+=left;continue}if(len+7>left)throw new Error('缓存日志块损坏');if(i+7+len>b.length)break;
  const data=b.subarray(i+7,i+7+len);i+=7+len;
  if(type===1){parts=[];records.push(data)}else if(type===2)parts=[data];else if(type===3){if(parts.length)parts.push(data)}else if(type===4){if(parts.length){parts.push(data);records.push(Buffer.concat(parts));parts=[]}}else throw new Error('无效的缓存日志类型');
 }return records;
}
export function snappyBlock(b:Buffer):Buffer{
 const p={i:0},length=vint(b,p);if(length>limit)throw new Error('缓存块过大');const out=Buffer.alloc(length);let at=0;
 while(p.i<b.length){const tag=b[p.i++],type=tag&3;let len=0,offset=0;
  if(type===0){len=tag>>>2;if(len<60)len++;else{const bytes=len-59;if(bytes>4||p.i+bytes>b.length)throw new Error('无效的压缩文字');len=b.readUIntLE(p.i,bytes)+1;p.i+=bytes}if(p.i+len>b.length||at+len>length)throw new Error('压缩文字越界');b.copy(out,at,p.i,p.i+len);p.i+=len;at+=len;continue}
  if(type===1){len=4+((tag>>>2)&7);if(p.i>=b.length)throw new Error('压缩引用不完整');offset=((tag&224)<<3)|b[p.i++]}
  else{len=1+(tag>>>2);const bytes=type===2?2:4;if(p.i+bytes>b.length)throw new Error('压缩引用不完整');offset=b.readUIntLE(p.i,bytes);p.i+=bytes}
  if(offset<1||offset>at||at+len>length)throw new Error('压缩引用越界');for(let i=0;i<len;i++)out[at+i]=out[at+i-offset];at+=len;
 }if(at!==length)throw new Error('压缩块长度不一致');return out;
}
function blockEntries(b:Buffer){if(b.length<4)throw new Error('缓存索引不完整');const count=b.readUInt32LE(b.length-4),end=b.length-4-count*4;if(end<0)throw new Error('缓存索引越界');const p={i:0},rows:{key:Buffer;value:Buffer}[]=[];let previous=Buffer.alloc(0);
 while(p.i<end){const shared=vint(b,p),rest=vint(b,p),size=vint(b,p);if(shared>previous.length||p.i+rest+size>end)throw new Error('缓存条目越界');const key=Buffer.concat([previous.subarray(0,shared),b.subarray(p.i,p.i+rest)]);p.i+=rest;const value=b.subarray(p.i,p.i+size);p.i+=size;rows.push({key,value});previous=key}return rows;
}
function tableEntries(file:Buffer){
 if(file.length<48||file.subarray(-8).toString('hex')!=='57fb808b247547db')throw new Error('不支持的缓存表');
 const footer={i:file.length-48};vint(file,footer);vint(file,footer);const indexOffset=vint(file,footer),indexSize=vint(file,footer);
 const block=(offset:number,size:number)=>{if(offset+size+5>file.length)throw new Error('缓存表块越界');const raw=file.subarray(offset,offset+size),compression=file[offset+size];if(compression===0)return raw;if(compression===1)return snappyBlock(raw);throw new Error('不支持的缓存压缩')};
 return blockEntries(block(indexOffset,indexSize)).flatMap(entry=>{const p={i:0};return blockEntries(block(vint(entry.value,p),vint(entry.value,p))) });
}
type RecordValue={sequence:bigint;value?:Buffer};
export function readLevelValues(files:Map<string,Buffer>):Buffer[]{
 const values=new Map<string,RecordValue>();
 const put=(key:Buffer,sequence:bigint,value?:Buffer)=>{const id=key.toString('hex'),old=values.get(id);if(!old||old.sequence<sequence)values.set(id,{sequence,value})};
 for(const [name,buffer] of files){
  if(name.endsWith('.ldb')||name.endsWith('.sst'))for(const row of tableEntries(buffer)){if(row.key.length<8)throw new Error('缓存键不完整');const tag=row.key.readBigUInt64LE(row.key.length-8);put(row.key.subarray(0,-8),tag>>8n,(tag&255n)===1n?row.value:undefined)}
  else if(name.endsWith('.log'))for(const record of levelLogRecords(buffer)){if(record.length<12)throw new Error('缓存写入批次不完整');const sequence=record.readBigUInt64LE(0),count=record.readUInt32LE(8),p={i:12};for(let i=0;i<count;i++){const type=record[p.i++],key=slice(record,p);if(type!==0&&type!==1)throw new Error('无效的缓存写入类型');put(key,sequence+BigInt(i),type===1?slice(record,p):undefined)}}
 }return [...values.values()].filter(r=>r.value).sort((a,b)=>a.sequence<b.sequence?1:a.sequence>b.sequence?-1:0).map(r=>r.value!);
}
export function parseDoubaoProjects(values:Buffer[]):Map<string,SourceProject>{
 const result=new Map<string,SourceProject>();
 for(const value of values){if(!value.includes(Buffer.from(schema)))continue;
  // Chromium wraps V8's serialized object in an IndexedDB envelope. Only
  // decode inline V8 objects bearing this exact app-owned cache schema.
  const start=value.indexOf(Buffer.from([255,15]));if(start<0)throw new Error('不支持的豆包项目缓存编码');
  const row=deserialize(value.subarray(start));if(row?.schema!==schema||!Array.isArray(row?.data?.projects))throw new Error('豆包项目缓存结构已变化');
  for(const project of row.data.projects){if(typeof project.projectId!=='string'||typeof project.name!=='string'||!Array.isArray(project.conversations))continue;
   for(const conversation of project.conversations)if(typeof conversation.conversation_id==='string')result.set(conversation.conversation_id,{id:project.projectId,name:project.name});
  }
  // This cache entry is a full project-list snapshot; never revive associations
  // from an older version or another cached account.
  return result;
 }return result;
}
async function regular(file:string){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>limit)throw new Error('豆包项目缓存不是有效普通文件');return s}
function liveFiles(manifest:Buffer){const tables=new Set<number>();let log=0,previousLog=0;
 for(const record of levelLogRecords(manifest)){const p={i:0};while(p.i<record.length){const tag=vint(record,p);
  if(tag===1)slice(record,p);else if(tag===2)log=vint(record,p);else if(tag===9)previousLog=vint(record,p);else if(tag===3||tag===4)vint(record,p);else if(tag===5){vint(record,p);slice(record,p)}else if(tag===6){vint(record,p);tables.delete(vint(record,p))}else if(tag===7){vint(record,p);tables.add(vint(record,p));vint(record,p);slice(record,p);slice(record,p)}else throw new Error('不支持的缓存清单');
 }}return (name:string)=>/^(\d+)\.(ldb|sst|log)$/.test(name)&&((name.endsWith('.log')&&Number(name.split('.')[0])>=log&&Number(name.split('.')[0])!==0)||Number(name.split('.')[0])===previousLog||tables.has(Number(name.split('.')[0])));
}
export async function readDoubaoProjects(sessionsRoot:string){
 const root=resolve(sessionsRoot,'../../../..','IndexedDB',cacheName);
 try{const info=await lstat(root);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('无效的豆包项目缓存目录')}catch(e:any){if(e.code==='ENOENT')return undefined;throw e}
 for(let attempt=0;attempt<3;attempt++)try{
  const current=join(root,'CURRENT');await regular(current);const name=(await readFile(current,'utf8')).trim();if(!/^MANIFEST-\d+$/.test(name))throw new Error('无效的豆包项目缓存清单');const manifest=join(root,name);await regular(manifest);const contents=await readFile(manifest),live=liveFiles(contents),files=(await readdir(root)).filter(live),buffers=new Map<string,Buffer>();
  for(const file of files){const path=join(root,file),before=await regular(path),data=await readFile(path),after=await regular(path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('豆包项目缓存正在更新');buffers.set(file,data)}
  if((await readFile(current,'utf8')).trim()!==name||!(await readFile(manifest)).equals(contents))throw new Error('豆包项目缓存正在更新');return parseDoubaoProjects(readLevelValues(buffers));
 }catch(e){if(attempt===2)throw e}
 return new Map<string,SourceProject>();
}
