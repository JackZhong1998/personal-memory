import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readLocalJSONL} from '../electron/local-jsonl';
import {codexUserText} from '../electron/codex-text';
import {parseJSONL} from '../electron/parsers';
import {Store} from '../electron/store';
const meta={type:'session_meta',payload:{id:'local'}};
const user=(text:string)=>({type:'response_item',timestamp:'2026-10-23T00:00:00Z',payload:{role:'user',content:[{type:'input_text',text}]}});
const jsonl=(rows:unknown[])=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
test('Codex app context is excluded while file requests and typed answers are retained',()=>{
 for(const text of ['<recommended_plugins>tools</recommended_plugins>','<external_codex_apps_open_page>{}</external_codex_apps_open_page>','<heartbeat>automation</heartbeat>','The following is the Codex agent history whose request action you are reviewing'])assert.equal(codexUserText(text),'');
 assert.equal(codexUserText('# Files mentioned by the user:\nfile.png\n\n## My request:\n请分析图片\n<image name="a"></image>'),'请分析图片');
 assert.equal(codexUserText('<send_user_message_question_reply>\n[{"question":"context","answer":"继续执行"}]\n</send_user_message_question_reply>'),'继续执行');
 const raw=jsonl([meta,user('<external_codex_apps_open_page>{}</external_codex_apps_open_page>'),user('真实提问')]);
 const p=parseJSONL(raw,'codex','file');assert.equal(p.length,1);assert.equal(p[0].conversationTitle,'真实提问');
 const withoutWrapper=parseJSONL(jsonl([meta,user('真实提问')]),'codex','file');assert.notEqual(p[0].id,withoutWrapper[0].id,'legacy ordinal must include the excluded wrapper');
});
test('Streaming JSONL handles large assistant records, incomplete final writes, malformed middle records and cancellation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-stream-'));const file=join(dir,'history.jsonl');
 try{
  await writeFile(file,jsonl([meta,{type:'response_item',payload:{role:'assistant',content:'x'.repeat(2*1024*1024)}},user('用户问题')])+'{"type":');
  assert.equal((await readLocalJSONL(file,'codex')).length,1);
  await writeFile(file,jsonl([meta,user('用户问题')])+'bad\n');await assert.rejects(()=>readLocalJSONL(file,'codex'),/JSON 无效/);
  await writeFile(file,'bad\n'+jsonl([meta,user('用户问题')]));await assert.rejects(()=>readLocalJSONL(file,'codex'),/JSON 无效/);
  const abort=new AbortController();abort.abort();assert.deepEqual(await readLocalJSONL(file,'codex',abort.signal),[]);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Upgrade hides old context records without deleting raw data and preserves real prompt IDs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pm-upgrade-'));const file=join(dir,'db');let db=await new Store(file).open();
 try{
  await db.upsert([{id:'context',provider:'codex',conversationId:'c',conversationTitle:'bad title',text:'<recommended_plugins>context</recommended_plugins>',timestamp:'2026-01-01T00:00:00Z',source:'source'},{id:'real',provider:'codex',conversationId:'c',conversationTitle:'bad title',text:'# Files mentioned by the user:\nx.png\n## My request:\n真正的提问',timestamp:'2026-01-02T00:00:00Z',source:'source'}]);
  db.close();db=await new Store(file).open();assert.equal(db.count(),1);assert.equal(db.prompts()[0].id,'real');assert.equal(db.prompts()[0].text,'真正的提问');assert.equal(db.traces()[0].title,'真正的提问');
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
