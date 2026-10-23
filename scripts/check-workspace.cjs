const {app,BrowserWindow}=require('electron');
app.disableHardwareAcceleration();
const {mkdtempSync,writeFileSync,rmSync,mkdirSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');
const project=resolve(__dirname,'..');
const root=mkdtempSync(join(tmpdir(),'tracelet-visual-'));app.setPath('userData',join(root,'data'));
const prompts=[
 ['c1','我们要做 Personal Memory，一个在 Mac 上运行的个人记忆层。'],['c1','先支持 Codex 和 Claude Code，从本地对话文件里收集我发出的提问。'],['c1','对话要持续更新，同一条消息重复同步不要重复保存。'],['c1','请把已采集的内容放在左边，提炼的记忆放在右边，能看到每条记忆来自哪里。'],
 ['c2','以后默认用中文解释，涉及实现时请给出可以运行的例子。'],['c2','这一次先用英文整理一份摘要，其他对话仍按默认中文。'],['c3','Personal Memory 之前只考虑 Mac，现在也要规划 Windows 支持，先不做移动端。'],['c4','网页端需要提供对话文件导入。'],['c5','今天确认了第一阶段的产品范围。']
].map(([cid,text],i)=>({id:'visual-p'+i,provider:i<4?'codex':i<7?'claude':i===7?'chatgpt':'grok',conversationId:cid,conversationTitle:cid==='c1'?'Personal Memory · 采集与记忆工作台':cid==='c2'?'交流方式与偏好':cid==='c3'?'Personal Memory · 平台规划':cid==='c4'?'导出与文件导入':'阶段计划',text,timestamp:`2026-10-18T0${i}:00:00Z`,source:'synthetic-fixture'}));
const base={confidence:.95,createdAt:'2026-10-18T07:00:00Z',basis:'explicit',analysisVersion:'tracelet-memory-v2',action:'add'};
const memory=(id,claim,category,layer,scope,status,indices,extra={})=>({...base,id,claim,category,layer,scope,status,evidenceIds:indices.map(i=>prompts[i].id),evidence:indices.map(i=>prompts[i]),...extra});
const memories=[
 memory('m1','Personal Memory 的采集与记忆工作台需要左右对照：左侧展示原始提问，右侧展示提炼记忆，并支持追溯原文。','needs','project',{kind:'project',label:'Personal Memory'},'pending',[3],{rationale:'保留用户明确提出的布局要求和原文追溯约束。'}),
 memory('m2','默认使用中文解释；涉及实现时，希望提供可运行的例子。','preferences','profile',{kind:'global',label:'用户'},'accepted',[4]),
 memory('m3','Personal Memory 计划同时支持 Mac 和 Windows，当前不规划移动端。','needs','project',{kind:'project',label:'Personal Memory'},'pending',[6],{action:'update',relatedMemoryId:'m4',rationale:'这是同一项目的平台规划变更，等待确认后替代旧版本。'}),
 memory('m4','Personal Memory 首先支持 Mac。','needs','project',{kind:'project',label:'Personal Memory'},'accepted',[0]),
 memory('m5','当前对话的这份摘要使用英文，其他对话保持默认中文。','preferences','episode',{kind:'conversation',label:'claude:c2'},'pending',[5]),
 memory('m6','网页端提供对话文件导入。','needs','project',{kind:'project',label:'Personal Memory'},'accepted',[7]),
 memory('m7','已确认第一阶段的产品范围。','events','episode',{kind:'conversation',label:'grok:c5'},'accepted',[8]),
 memory('m8','跨平台工作记录需要统一整理。','procedures','project',{kind:'project',label:'Personal Memory'},'pending',[0,4]),
 memory('m9','旧版记录示例。','identity','profile',{kind:'global',label:'用户'},'accepted',[])

];
const traces=[...new Set(prompts.map(p=>p.provider+':'+p.conversationId))].map(id=>{const rows=prompts.filter(p=>p.provider+':'+p.conversationId===id);return {id,provider:rows[0].provider,title:rows[0].conversationTitle,count:rows.length,updatedAt:rows.at(-1).timestamp}});
const snapshot={traces,memories,promptCount:prompts.length,errors:[],settings:{watchCodex:true,watchClaude:true,model:'deepseek/deepseek-v4-flash',keyPresent:false,keyStorageAvailable:true,paused:false}};
writeFileSync(join(root,'preload.cjs'),`const {contextBridge}=require('electron');const snapshot=${JSON.stringify(snapshot)};const prompts=${JSON.stringify(prompts)};let calls=[];contextBridge.exposeInMainWorld('tracelet',{snapshot:async()=>snapshot,prompts:async id=>prompts.filter(p=>p.provider+':'+p.conversationId===id).reverse(),onChange:()=>()=>{},analyze:async()=>{calls.push('analyze');throw Error('must not run')},preview:async()=>{calls.push('preview');throw Error('must not run')},testCalls:()=>calls});`);
app.whenReady().then(async()=>{const page=new BrowserWindow({width:1440,height:1050,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,preload:join(root,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});await page.loadFile(join(project,'dist/index.html'));page.setSize(1440,1050);await new Promise(r=>setTimeout(r,300));
 const run=code=>page.webContents.executeJavaScript(code),wait=async code=>{for(let i=0;i<100;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,50))}throw new Error('Three-page UI failed: '+code)},click=text=>run(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
 await wait(`document.querySelectorAll('.collected-prompt').length===4`);if(await run(`document.querySelectorAll('.nav').length`)!==3)throw new Error('Expected only three navigation pages');
 for(const [provider,count] of [['codex',4],['claude',1],['chatgpt',1],['grok',1]]){await run(`document.querySelector('.application[data-provider="${provider}"]').click()`);await wait(`document.querySelectorAll('.collected-prompt').length===${count}&&[...document.querySelectorAll('.collected-prompt')].every(e=>e.dataset.provider==='${provider}')`);const times=await run(`[...document.querySelectorAll('.prompt-meta time')].map(e=>e.dateTime)`);if(times.join()!==[...times].sort().join())throw new Error('Inputs not chronological');console.log('GROUPING_OK',provider,count)}
 await run(`document.querySelector('.application[data-provider="claude"]').click()`);await wait(`document.querySelectorAll('.conversation').length===2`);await run(`document.querySelectorAll('.conversation')[1].click()`);await wait(`document.querySelectorAll('.collected-prompt').length===2&&document.querySelector('.conversation-detail').innerText.includes('以后默认用中文')`);
 await run(`document.querySelector('.application[data-provider="codex"]').click()`);await wait(`document.querySelectorAll('.collected-prompt').length===4`);
 mkdirSync(join(project,'.local'),{recursive:true});
 for(const [name,width,height] of [['wide',1440,1050],['compact',1024,900]]){page.setSize(width,height);await new Promise(r=>setTimeout(r,200));if(await run(`document.documentElement.scrollWidth>innerWidth`))throw new Error('Data overflow at '+width);writeFileSync(join(project,`.local/data-page-${name}.png`),(await page.webContents.capturePage()).toPNG())}
 await click('记忆总结');await wait(`!!document.querySelector('.system-prompt')&&document.querySelectorAll('.result-card').length===9`);const source=require('node:fs').readFileSync('apps/desktop/electron/memory-prompt.ts','utf8').match(/export const SYSTEM=`([\s\S]*)`;/)[1];if(await run(`document.querySelector('.system-prompt').textContent`)!==source)throw new Error('Full System Prompt not shown exactly');if((await run('window.tracelet.testCalls()')).length)throw new Error('Analysis or preview unexpectedly invoked');
 for(const [name,width,height] of [['wide',1440,1050],['compact',1024,900]]){page.setSize(width,height);await new Promise(r=>setTimeout(r,200));if(await run(`document.documentElement.scrollWidth>innerWidth`))throw new Error('Memory overflow at '+width);writeFileSync(join(project,`.local/memory-page-${name}.png`),(await page.webContents.capturePage()).toPNG())}
 console.log('THREE_PAGE_UI_OK: three pages, application/conversation isolation, chronological inputs, exact full System Prompt, read-only existing results, no analysis or preview calls');page.destroy();app.quit();
}).catch(e=>{console.error('::error::'+e.message);app.exit(1)});app.on('will-quit',()=>rmSync(root,{recursive:true,force:true}));
