const {app,BrowserWindow}=require('electron');
app.disableHardwareAcceleration();
const {mkdtempSync,writeFileSync,rmSync,mkdirSync}=require('node:fs');const {tmpdir}=require('node:os');const {join,resolve}=require('node:path');
const project=resolve(__dirname,'..');
const root=mkdtempSync(join(tmpdir(),'tracelet-visual-'));app.setPath('userData',join(root,'data'));
const prompts=[
 ['c1','我们要做 Tracelet，一个在 Mac 上运行的个人记忆层。'],['c1','先支持 Codex 和 Claude Code，从本地对话文件里收集我发出的提问。'],['c1','对话要持续更新，同一条消息重复同步不要重复保存。'],['c1','请把已采集的内容放在左边，提炼的记忆放在右边，能看到每条记忆来自哪里。'],
 ['c2','以后默认用中文解释，涉及实现时请给出可以运行的例子。'],['c2','这一次先用英文整理一份摘要，其他对话仍按默认中文。'],['c3','Tracelet 之前只考虑 Mac，现在也要规划 Windows 支持，先不做移动端。'],['c4','网页端需要提供对话文件导入。'],['c5','今天确认了第一阶段的产品范围。']
].map(([cid,text],i)=>({id:'visual-p'+i,provider:i<4?'codex':i<7?'claude':i===7?'chatgpt':'grok',conversationId:cid,conversationTitle:cid==='c1'?'Tracelet · 采集与记忆工作台':cid==='c2'?'交流方式与偏好':cid==='c3'?'Tracelet · 平台规划':cid==='c4'?'导出与文件导入':'阶段计划',text,timestamp:`2026-10-18T0${i}:00:00Z`,source:'synthetic-fixture'}));
const base={confidence:.95,createdAt:'2026-10-18T07:00:00Z',basis:'explicit',analysisVersion:'tracelet-memory-v2',action:'add'};
const memory=(id,claim,category,layer,scope,status,indices,extra={})=>({...base,id,claim,category,layer,scope,status,evidenceIds:indices.map(i=>prompts[i].id),evidence:indices.map(i=>prompts[i]),...extra});
const memories=[
 memory('m1','Tracelet 的采集与记忆工作台需要左右对照：左侧展示原始提问，右侧展示提炼记忆，并支持追溯原文。','needs','project',{kind:'project',label:'Tracelet'},'pending',[3],{rationale:'保留用户明确提出的布局要求和原文追溯约束。'}),
 memory('m2','默认使用中文解释；涉及实现时，希望提供可运行的例子。','preferences','profile',{kind:'global',label:'用户'},'accepted',[4]),
 memory('m3','Tracelet 计划同时支持 Mac 和 Windows，当前不规划移动端。','needs','project',{kind:'project',label:'Tracelet'},'pending',[6],{action:'update',relatedMemoryId:'m4',rationale:'这是同一项目的平台规划变更，等待确认后替代旧版本。'}),
 memory('m4','Tracelet 首先支持 Mac。','needs','project',{kind:'project',label:'Tracelet'},'accepted',[0]),
 memory('m5','当前对话的这份摘要使用英文，其他对话保持默认中文。','preferences','episode',{kind:'conversation',label:'claude:c2'},'pending',[5]),
 memory('m6','网页端提供对话文件导入。','needs','project',{kind:'project',label:'Tracelet'},'accepted',[7]),
 memory('m7','已确认第一阶段的产品范围。','events','episode',{kind:'conversation',label:'grok:c5'},'accepted',[8]),
 memory('m8','跨平台工作记录需要统一整理。','procedures','project',{kind:'project',label:'Tracelet'},'pending',[0,4]),
 memory('m9','旧版记录示例。','identity','profile',{kind:'global',label:'用户'},'accepted',[])

];
const traces=[...new Set(prompts.map(p=>p.provider+':'+p.conversationId))].map(id=>{const rows=prompts.filter(p=>p.provider+':'+p.conversationId===id);return {id,provider:rows[0].provider,title:rows[0].conversationTitle,count:rows.length,updatedAt:rows.at(-1).timestamp}});
const snapshot={traces,memories,promptCount:prompts.length,errors:[],settings:{watchCodex:true,watchClaude:true,model:'deepseek/deepseek-v4-flash',keyPresent:false,keyStorageAvailable:true,paused:false}};
writeFileSync(join(root,'preload.cjs'),`const {contextBridge}=require('electron');const snapshot=${JSON.stringify(snapshot)};const prompts=${JSON.stringify(prompts)};contextBridge.exposeInMainWorld('tracelet',{snapshot:async()=>snapshot,prompts:async id=>prompts.filter(p=>p.provider+':'+p.conversationId===id),onChange:()=>()=>{}});`);
app.whenReady().then(async()=>{const page=new BrowserWindow({width:1440,height:1050,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,preload:join(root,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});await page.loadFile(join(project,'dist/index.html'));await new Promise(r=>setTimeout(r,350));
 for(const [name,width,height] of [['wide',1440,1050],['compact',1024,900]]){page.setSize(width,height);await new Promise(r=>setTimeout(r,180));const state=await page.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,sources:document.querySelectorAll('.source-conversation').length,groups:document.querySelectorAll('.source-group').length,cards:document.querySelectorAll('.memory-card').length,background:getComputedStyle(document.documentElement).backgroundColor})`);if(state.overflow||state.sources!==5||state.groups!==4||state.cards!==9||state.background!=='rgb(255, 255, 255)')throw new Error(JSON.stringify(state));
 mkdirSync(join(project,'.local'),{recursive:true});writeFileSync(join(project,`.local/workspace-pro-${name}.png`),(await page.webContents.capturePage()).toPNG());console.log('LAYOUT_OK',name,JSON.stringify(state))}
 const click=async code=>{await page.webContents.executeJavaScript(code);await new Promise(r=>setTimeout(r,150))};
 await click(`document.querySelector('.source-conversation input').click()`);
 for(const [provider,count] of [['codex',3],['claude',4],['chatgpt',1],['grok',1]]){
  await click(`document.querySelector('.platform-tabs [data-provider="${provider}"]').click()`);
  const state=await page.webContents.executeJavaScript(`({groups:[...document.querySelectorAll('.source-group')].map(x=>x.dataset.sourceGroup),raw:[...document.querySelectorAll('.source-prompt')].every(x=>x.dataset.provider==='${provider}'),cards:document.querySelectorAll('.memory-card').length,origins:[...document.querySelectorAll('.memory-card')].every(x=>!!x.querySelector('.platform-pill.${provider}')),selected:document.querySelectorAll('.source-conversation input:checked').length})`);
  if(state.groups.join(',')!==provider||!state.raw||state.cards!==count||!state.origins||state.selected!==0)throw new Error(provider+': '+JSON.stringify(state));console.log('PROVENANCE_OK',provider,state.cards);
 }
 await click(`document.querySelector('.platform-tabs button').click()`);
 await click(`[...document.querySelectorAll('.category-filters button')].find(b=>b.textContent==='需求与约束').click()`);
 if(await page.webContents.executeJavaScript(`document.querySelectorAll('.memory-card').length`)!==4)throw new Error('Category filter failed');
 await click(`document.querySelector('[aria-label="记忆层级"]').value='project';document.querySelector('[aria-label="记忆层级"]').dispatchEvent(new Event('change',{bubbles:true}))`);
 if(await page.webContents.executeJavaScript(`document.querySelectorAll('.memory-card').length`)!==4)throw new Error('Layer filter failed');
 await click(`[...document.querySelectorAll('.memory-card button')].find(b=>b.textContent.includes('定位提问')).click()`);
 if(!await page.webContents.executeJavaScript(`!!document.querySelector('.source-prompt.highlighted')`))throw new Error('Locate failed');
 console.log('INTERACTION_OK: platform isolation, selection reset, categories, layers, evidence navigation');page.destroy();app.quit();
}).catch(e=>{console.error('::error::'+e.message);app.exit(1)});app.on('will-quit',()=>rmSync(root,{recursive:true,force:true}));
