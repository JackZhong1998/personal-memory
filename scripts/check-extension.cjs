const {app,BrowserWindow}=require('electron');
const {build}=require('esbuild');const {mkdtempSync,rmSync,writeFileSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');
const root=mkdtempSync(join(tmpdir(),'tracelet-browser-ui-'));app.setPath('userData',root);
app.whenReady().then(async()=>{
 const result=await build({entryPoints:[resolve('extension/src/core.mjs')],bundle:true,write:false,format:'iife',globalName:'CaptureCore'});
 const page=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});writeFileSync(join(root,'fixture.html'),'<!doctype html><html><body></body></html>');await page.loadFile(join(root,'fixture.html'));await page.webContents.executeJavaScript(result.outputFiles[0].text);
 const state=await page.webContents.executeJavaScript(`(async()=>{
 const assert=(ok,name)=>{if(!ok)throw new Error(name)};
 document.body.innerHTML='<div class="user-message" data-message-id="1"><div class="body">请用中文回答。</div></div><div data-role="assistant">助手回答</div><textarea>未发送草稿</textarea><div class="user-message" contenteditable="true">未发送内容</div><div class="user-message" data-message-id="2"><div class="body">请用中文回答。</div></div><div class="user-message"><div class="user-message" data-message-id="3"><div class="body">嵌套消息</div></div></div><div class="user-message" data-role="assistant">不采集</div>';
 const rule={selector:'.user-message',idAttribute:'data-message-id'};
 const first=await CaptureCore.extract(document,'https://grok.com/c/1?token=secret',rule);
 assert(first.messages.length===3,'exclude assistant, draft and nested duplicate');assert(!JSON.stringify(first).includes('secret'),'strip URL secrets');assert(first.messages[0].id!==first.messages[1].id,'identical text stable distinct IDs');
 document.querySelector('[data-message-id="1"] .body').textContent='编辑后的需求';const edit=await CaptureCore.extract(document,'https://grok.com/c/1',rule);assert(edit.messages[0].id===first.messages[0].id&&edit.messages[0].text==='编辑后的需求','stable edited ID');
 const next=await CaptureCore.extract(document,'https://grok.com/c/2',rule);assert(next.conversationId!==first.conversationId,'SPA conversation isolation');
 const custom=await CaptureCore.extract(document,'https://ai.example/chat?id=abc',{...rule,conversationParam:'id'});const custom2=await CaptureCore.extract(document,'https://ai.example/chat?id=xyz',{...rule,conversationParam:'id'});assert(custom.conversationId!==custom2.conversationId&&custom.url==='https://ai.example/chat','custom query sessions');
 for(const selector of ['body','textarea','*','input','[contenteditable="true"]']){let failed=false;try{await CaptureCore.extract(document,'https://ai.example/c/1',{selector})}catch{failed=true}assert(failed,'reject broad selector '+selector)}
 const fallback=await CaptureCore.extract(document,'https://grok.com/c/1',{selector:'.user-message'});assert(new Set(fallback.messages.map(m=>m.id)).size===3,'text fallback occurrence IDs');
 const records=Object.fromEntries(Array.from({length:51},(_,i)=>['p'+i,{url:first.url,conversationId:first.conversationId,title:'test',capturedAt:first.capturedAt,id:'p'+i,text:'需求'.repeat(24000)}]));const packets=CaptureCore.packets(records);assert(packets.every(p=>new TextEncoder().encode(JSON.stringify(p)).length<1048576&&p.messages.length<=50),'native frame sizes');assert(packets.flatMap(p=>p.messages).length===51,'no batch loss');
 return {messages:first.messages.length,packets:packets.length};
 })()`);
 console.log('BROWSER_DOM_OK: submitted messages, no draft/assistant, nested dedup, edits, SPA, custom query sessions, bounded native frames',JSON.stringify(state));page.destroy();app.quit();
}).catch(e=>{console.error('BROWSER_DOM_FAILED:',e.message);app.exit(1)});
app.on('will-quit',()=>rmSync(root,{recursive:true,force:true}));
