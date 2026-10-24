import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseDoubaoAssignment,syncDoubaoWork,watchDoubaoWork} from '../electron/doubao-work';
import {Store} from '../electron/store';
const header='# Assignment\n- Agent ID: m_example\n- Role: main\n- Assigned by: user\n';
const section=(text:string,time='2026-10-22T11:51:46.220375854Z')=>`\n## [${time}] 需求\n${text}\n`;
test('Doubao Work preserves real user timestamps and repeated turns, excludes internal agent notifications',()=>{
 const rows=parseDoubaoAssignment(header+section('真实提问')+section('<system-reminder>agent result</system-reminder>')+section('真实提问','2026-10-22T11:52:46.220375854Z'),'session','m_example','assignment.md');
 assert.equal(rows.length,2);assert.equal(rows[0].provider,'doubao-work');assert.equal(rows[0].timestamp,'2026-10-22T11:51:46.220Z');assert.equal(rows[0].timeSource,'platform');assert.notEqual(rows[0].id,rows[1].id);
 assert.equal(parseDoubaoAssignment(header.replace('Role: main','Role: sub')+section('not user'),'s','s_x','file').length,0);
 assert.equal(parseDoubaoAssignment(header.replace('Assigned by: user','Assigned by: main')+section('not user'),'s','m_x','file').length,0);
 assert.equal(parseDoubaoAssignment(section('compacted but original user')+section('<system-reminder>tool output</system-reminder>'),'s','m_x','file').length,1);
});
test('Doubao Work IDs survive appends and text edits without duplicating the original turn',()=>{
 const first=parseDoubaoAssignment(header+section('first'),'s','m_x','file');
 const next=parseDoubaoAssignment(header+section('edited')+section('next','2026-10-22T12:00:00Z'),'s','m_x','file');
 assert.equal(first[0].id,next[0].id);assert.equal(new Set(next.map(p=>p.id)).size,2);
});
test('Doubao Work real directory layout syncs history, deduplicates across restart, and ignores subagents and symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pm-doubao-'));let db=await new Store(join(root,'db')).open();
 try{
  const sessions=join(root,'sessions'),main=join(sessions,'123','agents','m_first','system'),sub=join(sessions,'123','agents','s_worker','system');
  await mkdir(main,{recursive:true});await mkdir(sub,{recursive:true});
  await writeFile(join(main,'assignment.md'),header+section('历史需求'));await writeFile(join(main,'trajectory.jsonl'),JSON.stringify({role:'user',content:'历史需求'})+'\n');
  await writeFile(join(sub,'assignment.md'),header+section('子任务不入库'));await symlink(join(sessions,'123'),join(sessions,'linked'));
  const sync=()=>syncDoubaoWork([sessions],p=>db.upsert(p),new AbortController().signal,()=>{});
  let result=await sync();assert.equal(result.total,1);assert.equal(result.added,1);assert.equal(result.errors.length,0);
  assert.equal((await sync()).added,0);db.close();db=await new Store(join(root,'db')).open();assert.equal((await sync()).added,0);
  await writeFile(join(main,'assignment.md'),header+section('历史需求')+section('新需求','2026-10-23T02:00:00Z'));
  assert.equal((await sync()).added,1);assert.equal(db.count(),2);assert.equal(db.traces().length,1);assert.equal(db.traces()[0].provider,'doubao-work');
  const abort=new AbortController();abort.abort();assert.equal((await syncDoubaoWork([sessions],p=>db.upsert(p),abort.signal,()=>{})).cancelled,true);
 }finally{db.close();await rm(root,{recursive:true,force:true})}
});
test('Missing and unsafe Doubao sources are explicit and do not block valid sessions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pm-doubao-'));
 try{
  const main=join(root,'1','agents','m_a','system');await mkdir(main,{recursive:true});
  await symlink('/etc/hosts',join(main,'assignment.md'));
  const result=await syncDoubaoWork([root,join(root,'absent')],async()=>0,new AbortController().signal,()=>{});
  assert.equal(result.skipped,1);assert.equal(result.errors.length,1);assert.equal(result.missing.length,1);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('Real Doubao filesystem watcher imports an appended user turn and stops after close',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pm-doubao-watch-')),dir=join(root,'s','agents','m_a','system');
 const db=await new Store(join(root,'db')).open();let watcher:ReturnType<typeof watchDoubaoWork>|undefined;
 try{
  await mkdir(dir,{recursive:true});const file=join(dir,'assignment.md');await writeFile(file,header+section('已有需求'));
  const sync=()=>syncDoubaoWork([root],p=>db.upsert(p),new AbortController().signal,()=>{});
  await sync();let resolveUpdate:()=>void;const update=new Promise<void>(resolve=>{resolveUpdate=resolve});const errors:unknown[]=[];
  watcher=watchDoubaoWork([root],async()=>{await sync();resolveUpdate()},e=>errors.push(e));await watcher.ready;
  await writeFile(file,header+section('已有需求')+section('自动收到的新需求','2026-10-23T03:00:00Z'));
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([update,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('watcher did not import new turn')),7000)})])}finally{clearTimeout(timeout)}
  assert.deepEqual(errors,[]);assert.equal(db.count(),2);assert.equal((await sync()).added,0);
  await watcher.close();watcher=undefined;await writeFile(file,header+section('关闭后需求'));assert.equal(db.count(),2);
 }finally{await watcher?.close();db.close();await rm(root,{recursive:true,force:true})}
});
