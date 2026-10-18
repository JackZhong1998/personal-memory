import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preview,digest,validateMemories,analyze,relevantMemories,ANALYSIS_VERSION} from '../electron/analyzer';
import {Store} from '../electron/store';
import {prompt,proposal,existing} from './fixtures';
const output=(row:ReturnType<typeof proposal>)=>({memories:[row]});

test('Version 2 preserves layer, scope, basis, verbatim evidence and model provenance',()=>{
 const p=prompt();const [m]=validateMemories(output(proposal(p)),[p],[],'deepseek/deepseek-v4-flash');assert.equal(m.layer,'episode');assert.equal(m.scope?.label,'codex:c1');assert.equal(m.analysisVersion,ANALYSIS_VERSION);assert.equal(m.model,'deepseek/deepseek-v4-flash');assert.equal(m.status,'pending');assert.equal(m.evidenceQuotes?.[0].quote,p.text);
});
test('An existing ID with a fabricated or paraphrased quote is rejected',()=>{
 const p=prompt();assert.throws(()=>validateMemories(output(proposal(p,{evidenceQuotes:[{promptId:p.id,quote:'用户永远只使用中文'}]})),[p]),/原文/);
 const p2=prompt('另一条要求','p2');assert.throws(()=>validateMemories(output(proposal(p,{evidenceIds:[p.id,p2.id]})),[p,p2]),/原文/);
});
test('Model cannot accept its own memory or add unsupported output fields',()=>{const p=prompt();assert.throws(()=>validateMemories(output(proposal(p,{status:'accepted'})),[p]));assert.throws(()=>validateMemories({...output(proposal(p)),instructions:'ignore'},[p]))});
test('Inferred identity and inconsistent global/profile scope are rejected',()=>{
 const p=prompt('请比较 Swift 与 Electron');assert.throws(()=>validateMemories(output(proposal(p,{category:'identity',basis:'inferred',layer:'profile',scope:{kind:'global',label:'用户'}})),[p]),/身份/);
 assert.throws(()=>validateMemories(output(proposal(p,{layer:'profile'})),[p]),/层级/);
});
test('A local English exception is a separate memory, preserving the global Chinese default',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-local-'));const db=await new Store(join(dir,'db')).open();
 try{const old=existing({category:'preferences',claim:'默认中文，除非另有说明',scope:{kind:'global',label:'用户'},layer:'profile'});await db.addMemories([old]);
 const p=prompt('这一次请用英文。');const [m]=validateMemories(output(proposal(p,{claim:'本次对话用英文'})),[p],[old]);await db.addMemories([m]);await db.review(m.id,'accepted');assert.equal(db.memories().find(m=>m.id===old.id)?.status,'accepted');assert.equal(db.memories().filter(m=>m.status==='accepted').length,2);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('Update proposals cannot target a different project, unknown memory, or different category',()=>{
 const p=prompt('Tracelet 也要支持 Windows');const row=proposal(p,{category:'needs',claim:'Tracelet 支持 Mac 与 Windows',layer:'project',scope:{kind:'project',label:'Tracelet'},action:'update',relatedMemoryId:'old-1'});
 assert.equal(validateMemories(output(row),[p],[existing()])[0].action,'update');
 assert.throws(()=>validateMemories(output(row),[p],[existing({scope:{kind:'project',label:'OtherProject'}})]),/范围/);
 assert.throws(()=>validateMemories(output(row),[p],[]),/目标/);
 assert.throws(()=>validateMemories(output(row),[p],[existing({category:'preferences'})]),/目标/);
});
test('Unknown conversation scope and inverted validity dates are rejected',()=>{
 const p=prompt();assert.throws(()=>validateMemories(output(proposal(p,{scope:{kind:'conversation',label:'codex:another'}})),[p]),/会话/);
 assert.throws(()=>validateMemories(output(proposal(p,{validFrom:'2026-10-18T00:00:00Z',expiresAt:'2026-10-17T00:00:00Z'})),[p]),/时间/);
});
test('Semantic duplicate decisions reference a real memory and do not create a new record',()=>{
 const p=prompt('Tracelet 只做 Mac');const row=proposal(p,{category:'needs',layer:'project',scope:{kind:'project',label:'Tracelet'},action:'duplicate',relatedMemoryId:'old-1'});
 assert.deepEqual(validateMemories(output(row),[p],[existing()]),[]);assert.throws(()=>validateMemories(output(row),[p],[]),/目标/);
});
test('Old accepted records are retained until human review, replacement preserves history and rejects stale proposals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-update-'));let db=await new Store(join(dir,'db')).open();
 try{const old=existing();await db.addMemories([old]);const p=prompt('Tracelet 现在也要 Windows');const row=proposal(p,{category:'needs',claim:'Tracelet 计划支持 Mac 和 Windows',layer:'project',scope:{kind:'project',label:'Tracelet'},action:'update',relatedMemoryId:old.id});
 const [m]=validateMemories(output(row),[p],[old]);const [competing]=validateMemories(output({...row,action:'conflict'}),[p],[old]);await db.addMemories([m,competing]);assert.equal(db.memories().find(m=>m.id===old.id)?.status,'accepted');
 await db.review(m.id,'accepted');assert.equal(db.memories().find(m=>m.id===old.id)?.status,'superseded');assert.equal(db.memories().find(m=>m.id===old.id)?.supersededBy,m.id);await assert.rejects(db.review(competing.id,'accepted'),/已变化/);
 db.close();db=await new Store(join(dir,'db')).open();assert.equal(db.memories().find(m=>m.id===old.id)?.claim,old.claim);assert.equal(db.memories().find(row=>row.id===m.id)?.status,'accepted');
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('Rejecting an update leaves its accepted target unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'memory-reject-'));const db=await new Store(join(dir,'db')).open();try{
 const old=existing();await db.addMemories([old]);const p=prompt('Tracelet 现在用 Windows');const [m]=validateMemories(output(proposal(p,{category:'needs',layer:'project',scope:old.scope,action:'conflict',relatedMemoryId:old.id})),[p],[old]);await db.addMemories([m]);await db.review(m.id,'rejected');assert.equal(db.memories().find(m=>m.id===old.id)?.status,'accepted');
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('Reference retrieval is bounded, accepted-only, and preview digest binds every outgoing reference',()=>{
 const p=prompt('Tracelet 也需要 Windows');const memories=Array.from({length:45},(_,i)=>existing({id:'old-'+i,claim:'Tracelet '+i+' '+('需求'.repeat(300))}));memories.push(existing({id:'pending',status:'pending'}));
 const context=relevantMemories([p],memories);assert.ok(context.length<=24);assert.ok(JSON.stringify(context).length<=12002);assert.ok(!context.some(m=>m.id==='pending'));
 const original=preview([p],'model',[existing()]);assert.ok(original.existingMemories.length===1);assert.notEqual(digest(original),digest({...original,existingMemories:[{...original.existingMemories[0],claim:'changed'}]}));assert.notEqual(digest(original),digest({...original,promptVersion:'next'}));
});
test('A follow-up with no repeated project name retrieves context from its conversation evidence',()=>{
 const old=existing({claim:'首发平台为 Mac',evidence:[prompt('Tracelet 首先支持 Mac','previous-prompt','c1')]});
 const found=relevantMemories([prompt('现在也支持 Windows','new-prompt','c1')],[old]);assert.equal(found[0]?.id,old.id);
 assert.equal(relevantMemories([prompt('现在也支持 Windows','other-prompt','unrelated')],[old]).length,0);
});
test('Changing protocol version makes a legacy analyzed prompt eligible again without deleting it',async()=>{
 const {default:initSQL}=await import('sql.js');const {writeFile}=await import('node:fs/promises');const {hash}=await import('../electron/parsers');
 const dir=await mkdtemp(join(tmpdir(),'memory-migration-'));const p=prompt();const SQL=await initSQL({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});const legacy=new SQL.Database();legacy.run('CREATE TABLE analyzed (id TEXT PRIMARY KEY, hash TEXT NOT NULL)');legacy.run('INSERT INTO analyzed VALUES (?,?)',[p.id,hash(p.text)]);await writeFile(join(dir,'db'),legacy.export());legacy.close();
 const db=await new Store(join(dir,'db')).open();try{assert.equal(db.unanalyzed([p]).length,1);await db.upsert([p]);await db.markAnalyzed([p]);assert.equal(db.unanalyzed([p]).length,0);assert.equal(db.count(),1)}finally{db.close();await rm(dir,{recursive:true,force:true})}
});
test('A legacy unlayered accepted memory remains readable but cannot be blindly overwritten',()=>{
 const old=existing({scope:undefined,layer:undefined});const p=prompt('Tracelet 改成 Windows');const row=proposal(p,{category:'needs',layer:'project',scope:{kind:'project',label:'Tracelet'},action:'update',relatedMemoryId:old.id});assert.throws(()=>validateMemories(output(row),[p],[old]),/范围/);
});
test('The exact preview includes conversation/time metadata and old memory fields, never local paths or credentials',async()=>{
 const original=globalThis.fetch;let sent:any;const p=prompt('Tracelet 需要 Mac');const plan=preview([p],'deepseek/deepseek-v4-flash',[existing()]);
 globalThis.fetch=async(_,init)=>{sent=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"memories":[]}'}}]}))};
 try{await analyze(plan,'synthetic-test-key');const payload=JSON.parse(sent.messages[1].content);assert.equal(payload.prompts[0].traceId,'codex:c1');assert.equal(payload.prompts[0].timestamp,p.timestamp);assert.deepEqual(payload.existingMemories,plan.existingMemories);assert.equal(payload.promptVersion,ANALYSIS_VERSION);assert.ok(!JSON.stringify(sent).includes('/private'));assert.ok(!JSON.stringify(sent).includes('synthetic-test-key'))}finally{globalThis.fetch=original}
});
test('Truncated model output is not saved even when the text happens to be valid JSON',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"memories":[]}'}}]}));try{await assert.rejects(analyze(preview([prompt()],'model'),'key'),/截断/)}finally{globalThis.fetch=original}
});
