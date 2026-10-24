import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serialize} from 'node:v8';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {directoryProject} from '../electron/source-project';
import {levelLogRecords,parseDoubaoProjects,readLevelValues,readDoubaoProjects,snappyBlock} from '../electron/doubao-projects';
import {parseDoubaoAssignment,syncDoubaoWork} from '../electron/doubao-work';
import {readCodexDatabase,codexDatabaseName} from '../electron/codex-database';
import {Store} from '../electron/store';
import {parseJSONL} from '../electron/parsers';
const vint=(n:number)=>{const bytes=[];do{let b=n%128;n=Math.floor(n/128);bytes.push(b|(n?128:0))}while(n);return Buffer.from(bytes)};
const field=(b:Buffer)=>Buffer.concat([vint(b.length),b]);
const physical=(b:Buffer,type=1)=>{const h=Buffer.alloc(7);h.writeUInt16LE(b.length,4);h[6]=type;return Buffer.concat([h,b])};
const batch=(sequence:number,key:Buffer,value?:Buffer)=>{const h=Buffer.alloc(12);h.writeBigUInt64LE(BigInt(sequence));h.writeUInt32LE(1,8);return Buffer.concat([h,Buffer.from([value?1:0]),field(key),...(value?[field(value)]:[])])};
const projectValue=(projects:any[])=>serialize({schema:'conversation-list-data-project-v4',data:{projects}});
const projects=[{projectId:'native-1',name:'同名项目',conversations:[{conversation_id:'123'}]}];
const prompt={id:'a',provider:'doubao-work' as const,conversationId:'123',conversationTitle:'问题',text:'问题',timestamp:'2026-10-23T01:00:00Z',source:'assignment.md'};
test('Directory projects use full paths for identity and Codex JSONL preserves the directory',()=>{
 assert.notEqual(directoryProject('/first/app')?.id,directoryProject('/second/app')?.id);
 assert.equal(directoryProject('relative/app'),undefined);
 const rows=parseJSONL([JSON.stringify({type:'session_meta',payload:{id:'c',cwd:'/first/app'}}),JSON.stringify({type:'event_msg',timestamp:prompt.timestamp,payload:{type:'user_message',message:'问题'}})].join('\n'),'codex','rollout.jsonl');
 assert.deepEqual(rows[0].project,directoryProject('/first/app'));
});
test('Project cache follows LevelDB sequence numbers, deletion, fragmented logs and current snapshot',()=>{
 const key=Buffer.from('project'),older=projectValue(projects),empty=projectValue([]);
 const record=batch(2,key,empty),cut=10;
 const files=new Map([['000001.log',physical(batch(1,key,older))],['000002.log',Buffer.concat([physical(record.subarray(0,cut),2),physical(record.subarray(cut),4)])]]);
 assert.equal(parseDoubaoProjects(readLevelValues(files)).size,0);
 files.set('000002.log',physical(batch(3,key)));assert.equal(readLevelValues(files).length,0);
 assert.equal(levelLogRecords(Buffer.concat([physical(Buffer.from('complete')),Buffer.from([1,2])])).length,1);
 assert.throws(()=>snappyBlock(Buffer.from([4,2,0,0])),/越界/);
 assert.equal(snappyBlock(Buffer.from([4,0,97,10,1,0])).toString(),'aaaa');
 assert.equal(parseDoubaoProjects([older]).get('123')?.name,'同名项目');
});
function table(key:Buffer,value:Buffer){
 const block=(rows:{key:Buffer;value:Buffer}[])=>Buffer.concat([...rows.map(r=>Buffer.concat([vint(0),vint(r.key.length),vint(r.value.length),r.key,r.value])),Buffer.from([0,0,0,0,1,0,0,0])]);
 const data=block([{key,value}]),trailer=Buffer.alloc(5),index=block([{key,value:Buffer.concat([vint(0),vint(data.length)])}]),footer=Buffer.alloc(48);
 Buffer.concat([vint(0),vint(0),vint(data.length+5),vint(index.length)]).copy(footer);Buffer.from('57fb808b247547db','hex').copy(footer,40);
 return Buffer.concat([data,trailer,index,trailer,footer]);
}
test('Compacted project cache reads live SST records and supports updates newer than the SST',()=>{
 const tag=Buffer.alloc(8);tag.writeBigUInt64LE(257n);const key=Buffer.from('project');
 const files=new Map([['000001.ldb',table(Buffer.concat([key,tag]),projectValue(projects))]]);
 assert.equal(parseDoubaoProjects(readLevelValues(files)).get('123')?.id,'native-1');
 files.set('000002.log',physical(batch(2,key,projectValue([]))));assert.equal(parseDoubaoProjects(readLevelValues(files)).size,0);
});
test('Doubao project cache enriches historical prompts, survives restart, updates names and clears moved-out conversations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-projects-'));let db=await new Store(join(dir,'db')).open();
 try{
  const sessions=join(dir,'Default/.doubaowork/agent_mode/workspace/.sessions'),main=join(sessions,'123/agents/m_main/system'),cache=join(dir,'Default/IndexedDB/chrome_doubaowork-chat_0.indexeddb.leveldb');
  await mkdir(main,{recursive:true});await mkdir(cache,{recursive:true});
  await writeFile(join(main,'assignment.md'),'# Assignment\n- Role: main\n- Assigned by: user\n## [2026-10-23T01:00:00Z] 需求\n问题');
  await writeFile(join(cache,'CURRENT'),'MANIFEST-000001\n');await writeFile(join(cache,'MANIFEST-000001'),physical(Buffer.concat([vint(2),vint(2)])));
  const save=async(data:any[])=>writeFile(join(cache,'000002.log'),physical(batch(1,Buffer.from('project'),projectValue(data))));
  await db.upsert(parseDoubaoAssignment('# Assignment\n- Role: main\n- Assigned by: user\n## [2026-10-23T01:00:00Z] 需求\n问题','123','m_main','assignment.md'));await save(projects);
  assert.equal((await readDoubaoProjects(sessions))?.get('123')?.name,'同名项目');
  const sync=()=>syncDoubaoWork([sessions],p=>db.upsert(p),new AbortController().signal,()=>{});
  assert.equal((await sync()).added,0);assert.equal(db.traces()[0].project?.id,'native-1');
  db.close();db=await new Store(join(dir,'db')).open();assert.equal(db.traces()[0].project?.name,'同名项目');
  await save([{...projects[0],name:'新名称'}]);await sync();assert.equal(db.traces()[0].project?.name,'新名称');
  await save([]);await sync();assert.equal(db.traces()[0].project,undefined);assert.equal(db.count(),1);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('Codex database prefers native project names, maps root paths, and repeated JSONL cannot downgrade them',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-codex-projects-')),db=await new Store(join(dir,'db')).open();
 try{
  execFileSync('/usr/bin/sqlite3',[join(dir,'state_5.sqlite'),"CREATE TABLE threads(id TEXT,title TEXT,source TEXT,cwd TEXT,project_id TEXT);CREATE TABLE projects(id TEXT,name TEXT);CREATE TABLE project_roots(project_id TEXT,path TEXT);INSERT INTO projects VALUES ('p','原生项目');INSERT INTO project_roots VALUES ('p','/code/app');INSERT INTO threads VALUES ('main','问题','vscode','/code/app',NULL);"]);
  const item=JSON.stringify({type:'userMessage',content:[{type:'text',text:'问题'}]});
  execFileSync('/usr/bin/sqlite3',[join(dir,codexDatabaseName),`CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,created_at_ms INTEGER,rollout_ordinal INTEGER,item_json TEXT,item_type TEXT);INSERT INTO thread_items VALUES ('main','a',1792717200000,0,'${item}','userMessage');`]);
  const rows=await readCodexDatabase(dir);assert.deepEqual(rows[0].project,{id:'p',name:'原生项目',path:'/code/app'});
  await db.upsert(rows);await db.upsert([{...rows[0],project:directoryProject('/code/app')}]);assert.equal(db.traces()[0].project?.name,'原生项目');assert.equal(db.count(),1);
  await db.upsert([{...rows[0],project:undefined}]);assert.equal(db.traces()[0].project?.name,'原生项目');
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
