import { app, BrowserWindow, ipcMain, dialog, safeStorage, Tray, Menu, nativeImage, shell, systemPreferences } from 'electron';
import { readFile, writeFile, mkdir, rename, unlink, stat, readdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DesktopReview,desktopAppSchema,desktopReadSchema} from './desktop-capture';
import {z} from 'zod';
import { homedir } from 'node:os';
import { watch, type FSWatcher } from 'chokidar';
import {browserPrompts,frame} from './browser-capture';
import { Store } from './store';
import { parseJSONL, parseExport } from './parsers';
import { preview, digest, analyze, sameScope } from './analyzer';
import type { Settings } from './types';

let window:BrowserWindow|null=null;let tray:Tray;let store:Store;let quitting=false;let watcher:FSWatcher|undefined;
let settings:Omit<Settings,'keyPresent'|'keyStorageAvailable'>={watchCodex:false,watchClaude:false,watchBrowser:false,model:'deepseek/deepseek-v4-flash',paused:false};
let browserWatcher:FSWatcher|undefined;
let errors:string[]=[];let busy=false;let queue=Promise.resolve();
// Keep the legacy OS identity for Keychain/safeStorage and existing user data.
app.setName('Tracelet');
app.setPath('userData',join(app.getPath('appData'),app.isPackaged?'Tracelet':'tracelet'));
const dev=process.argv.includes('--dev')&&!app.isPackaged;
const smoke=process.argv.includes('--smoke')&&!app.isPackaged;
if(smoke)app.disableHardwareAcceleration();
if(smoke&&process.env.TRACELET_SMOKE_DATA)app.setPath('userData',process.env.TRACELET_SMOKE_DATA);
const dataDir=()=>app.getPath('userData');
const brandPath=(file:string)=>app.isPackaged?join(process.resourcesPath,'brand',file):join(__dirname,'../assets/brand',file);
const keyFile=()=>join(dataDir(),'openrouter.key');
const desktopReview=new DesktopReview();
const changed=()=>window?.webContents.send('changed');
async function nativeCapture(args:string[]){
 if(process.platform!=='darwin')throw new Error('窗口采集仅支持 macOS；其他系统可导入对话文件。');
 const binary=app.isPackaged?join(process.resourcesPath,'native/window-capture'):join(__dirname,'../dist-native/window-capture');
 try{const {stdout}=await promisify(execFile)(binary,args,{timeout:15000,maxBuffer:2*1024*1024});return JSON.parse(stdout)}catch(e:any){if(e.code==='ENOENT')throw new Error('缺少 Mac 窗口采集组件，请安装完整安装包或运行 npm run build:native。');let detail='';try{const result=JSON.parse(e.stdout);if(typeof result.error==='string')detail=result.error.slice(0,200)}catch{}throw new Error(detail||'无法读取窗口，请检查辅助功能授权并在目标应用打开对话。')}
}
const report=(e:unknown)=>{errors=[String(e instanceof Error?e.message:e),...errors].slice(0,5);changed()};
async function atomic(file:string,data:string|Buffer){await writeFile(file+'.tmp',data,{mode:0o600});await rename(file+'.tmp',file)}
async function getKey(){try{return safeStorage.decryptString(await readFile(keyFile()))}catch(e:any){if(e.code==='ENOENT')return '';throw new Error('无法解锁 API Key。请重新保存 Key。')}}
async function keyPresent(){try{await stat(keyFile());return true}catch{return false}}
async function publicSettings(){return {...settings,keyPresent:await keyPresent(),keyStorageAvailable:safeStorage.isEncryptionAvailable()}}
function show(){if(window){window.show();window.focus();return}
 window=new BrowserWindow({width:1250,height:850,minWidth:960,minHeight:680,title:'Personal Memory · 你的个人记忆层',icon:brandPath('icon.png'),show:!smoke,backgroundColor:'#ffffff',webPreferences:{...(smoke?{offscreen:true,backgroundThrottling:false}:{}),preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',e=>e.preventDefault());
 window.on('close',e=>{if(!quitting){e.preventDefault();window?.hide()}});
 window.on('closed',()=>{window=null});
 if(dev)void window.loadURL('http://127.0.0.1:5173');else void window.loadFile(join(__dirname,'../dist/index.html'));
}
function register(name:string,fn:(...args:any[])=>unknown){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==window?.webContents)throw new Error('不可信的请求来源');return fn(...args)})}
async function ingest(path:string,provider:'codex'|'claude'){
 if(settings.paused||!path.endsWith('.jsonl'))return;
 if((await stat(path)).size>100*1024*1024)throw new Error('跳过超过 100 MB 的对话文件：'+path);
 const prompts=parseJSONL(await readFile(path,'utf8'),provider,path);await store.upsert(prompts);changed();
}
async function ingestBrowser(file:string){
 if(settings.paused||!settings.watchBrowser||!file.endsWith('.json'))return;
 if((await stat(file)).size>1024*1024)throw new Error('浏览器数据包超过限制');
 await store.upsert(browserPrompts(JSON.parse(await readFile(file,'utf8'))));await unlink(file);changed();
}
async function startWatch(){await browserWatcher?.close();browserWatcher=undefined;
 if(settings.watchBrowser&&!settings.paused){const inbox=join(dataDir(),'browser-inbox');await mkdir(inbox,{recursive:true,mode:0o700});
 browserWatcher=watch(inbox,{ignoreInitial:false,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:300,pollInterval:100}});
 browserWatcher.on('add',file=>{queue=queue.then(()=>ingestBrowser(file)).catch(report)}).on('error',report);
 }
 await watcher?.close();watcher=undefined;if(settings.paused)return;
 const paths:{path:string;provider:'codex'|'claude'}[]=[];
 if(settings.watchCodex)paths.push({path:resolve(process.env.CODEX_HOME||join(homedir(),'.codex'),'sessions'),provider:'codex'});
 if(settings.watchClaude)paths.push({path:join(homedir(),'.claude','projects'),provider:'claude'});
 if(!paths.length)return;
 watcher=watch(paths.map(p=>p.path),{ignoreInitial:false,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:700,pollInterval:150},ignored:(p,s)=>!!s?.isFile()&&!p.endsWith('.jsonl')});
 const onFile=(file:string)=>{const source=paths.find(p=>file.startsWith(p.path+'/'));if(!source)return;queue=queue.then(()=>ingest(file,source.provider)).catch(report)};
 watcher.on('add',onFile).on('change',onFile).on('error',report);
}
function selected(ids:unknown){if(!Array.isArray(ids)||ids.length>1000||ids.some(i=>typeof i!=='string'))throw new Error('对话选择无效');return store.prompts().filter(p=>ids.includes(`${p.provider}:${p.conversationId}`))}
function handlers(){
 register('desktop-apps',async()=>z.array(desktopAppSchema).parse(await nativeCapture(['--apps'])));
 register('desktop-permission',()=>{if(process.platform!=='darwin')throw new Error('窗口采集仅支持 macOS');return systemPreferences.isTrustedAccessibilityClient(true)});
 register('desktop-preview',async(pid:unknown)=>{desktopReview.clear();if(settings.paused)throw new Error('采集已暂停，请先恢复');if(typeof pid!=='number'||!Number.isInteger(pid)||pid<=0)throw new Error('请选择正在运行的应用');const raw=desktopReadSchema.parse(await nativeCapture(['--read',String(pid)]));if(settings.paused)throw new Error('采集已暂停');if(raw.app.pid!==pid)throw new Error('应用已变化，请刷新列表');return desktopReview.stage(raw)});
 register('desktop-commit',async(token:unknown,ids:unknown,provider:unknown,conversation:unknown)=>{if(settings.paused)throw new Error('采集已暂停');const rows=desktopReview.confirm(token,ids,provider,conversation);const added=await store.upsert(rows);desktopReview.clear();changed();return added});
 register('snapshot',async()=>({traces:store.traces(),memories:store.memories(),settings:await publicSettings(),errors,promptCount:store.count()}));
 register('prompts',(id:unknown)=>{if(typeof id!=='string')throw new Error('对话 ID 无效');return store.prompts(id)});
 register('settings',async(value:unknown)=>{if(!value||typeof value!=='object')throw new Error('设置无效');const v=value as Record<string,unknown>;
  for(const key of ['watchCodex','watchClaude','watchBrowser','paused'] as const){if(key in v){if(typeof v[key]!=='boolean')throw new Error('设置无效');settings[key]=v[key]}}
  if(settings.paused)desktopReview.clear();
  if('model' in v){if(typeof v.model!=='string'||!v.model.trim()||v.model.length>200)throw new Error('模型 ID 无效');settings.model=v.model.trim()}
  await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings));await startWatch();changed();
 });
 register('save-key',async(key:unknown)=>{if(typeof key!=='string'||!key.startsWith('sk-or-')||key.length>1000)throw new Error('请输入有效的 OpenRouter API Key');if(!safeStorage.isEncryptionAvailable())throw new Error('系统钥匙串不可用，未保存 Key');await atomic(keyFile(),safeStorage.encryptString(key.trim()));changed()});
 register('remove-key',async()=>{await unlink(keyFile()).catch((e:any)=>{if(e.code!=='ENOENT')throw e});changed()});
 register('models',async()=>{const r=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('无法获取模型列表 ('+r.status+')');const json:any=await r.json();return json.data.filter((m:any)=>typeof m.id==='string'&&m.id.startsWith('deepseek/')).map((m:any)=>({id:m.id,name:m.name}))});
 register('import',async()=>{const file=await dialog.showOpenDialog({title:'导入对话文件',properties:['openFile'],filters:[{name:'对话导出',extensions:['json','jsonl']}]});if(file.canceled)return {added:0,message:'已取消'};
  const path=file.filePaths[0];if((await stat(path)).size>100*1024*1024)throw new Error('导入文件不能超过 100 MB');const raw=await readFile(path,'utf8');
  let prompts;if(path.endsWith('.jsonl')){const provider: 'codex'|'claude'=raw.includes('"session_meta"')||raw.includes('"response_item"')||raw.includes('"event_msg"')?'codex':'claude';prompts=parseJSONL(raw,provider,path)}else prompts=parseExport(raw,path);
  if(!prompts.length)throw new Error('文件中没有可识别的用户提问');const added=await store.upsert(prompts);changed();return {added,message:`已同步 ${prompts.length} 条提问，新增 ${added} 条。`};
 });
 register('preview',(ids:unknown)=>{const p=preview(store.unanalyzed(selected(ids)),settings.model,store.memories());return {...p,digest:digest(p)}});
 register('analyze',async(ids:unknown,approvedDigest:unknown)=>{if(busy)throw new Error('分析正在进行中');const p=preview(store.unanalyzed(selected(ids)),settings.model,store.memories());if(digest(p)!==approvedDigest)throw new Error('内容或参考记忆已更新，请重新预览后再发送');if(!p.prompts.length)throw new Error('所选对话没有待分析的新提问');
  const key=await getKey();if(!key)throw new Error('请先在设置中保存 API Key');busy=true;try{const memories=await analyze(p,key);const existing=store.memories().filter(m=>m.status==='pending'||m.status==='accepted');const novel=memories.filter(m=>!existing.some(old=>old.claim.trim()===m.claim.trim()&&old.category===m.category&&sameScope(old.scope,m.scope)));await store.addMemories(novel);await store.markAnalyzed(p.prompts);changed();return novel.length}finally{busy=false}
 });
 register('review',async(id:unknown,status:unknown)=>{if(typeof id!=='string'||!['accepted','rejected'].includes(String(status)))throw new Error('审核参数无效');await store.review(id,status as 'accepted'|'rejected');changed()});
 register('export',async()=>{const file=await dialog.showSaveDialog({defaultPath:'personal-memory-export.json',filters:[{name:'JSON',extensions:['json']}]});if(file.canceled||!file.filePath)return false;await writeFile(file.filePath,JSON.stringify({version:1,exportedAt:new Date().toISOString(),prompts:store.prompts(),memories:store.memories()},null,2),{mode:0o600});return true});
 register('erase',async()=>{if(busy)throw new Error('请等待分析结束后再清空数据');const answer=await dialog.showMessageBox({type:'warning',message:'删除所有本地提问与记忆？',detail:'采集将暂停。原始平台文件不会被删除；重新开启采集会再次导入。此操作无法撤销。',buttons:['取消','删除'],defaultId:0,cancelId:0});if(answer.response!==1)return false;settings.paused=true;await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings));await startWatch();await queue;await store.erase();desktopReview.clear();for(const file of await readdir(join(dataDir(),'browser-inbox')).catch(()=>[]))if(file.endsWith('.json')||file.endsWith('.tmp'))await unlink(join(dataDir(),'browser-inbox',file));changed();return true});
 register('open-extension',()=>shell.openPath(app.isPackaged?join(process.resourcesPath,'browser-extension'):join(__dirname,'../browser-extension')));
 register('pair-browser',async(id:unknown,browser:unknown)=>{
  if(process.platform!=='darwin')throw new Error('桌面配对目前支持 macOS');
  if(typeof id!=='string'||! /^[a-p]{32}$/.test(id)||!['chrome','edge'].includes(String(browser)))throw new Error('请输入扩展管理页面中的 32 位扩展 ID');
  const quote=(v:string)=>"'"+v.replaceAll("'", "'\\''")+"'";
  const host=app.isPackaged?join(process.resourcesPath,'bridge/browser-host.cjs'):join(__dirname,'browser-host.cjs');
  const launcher=join(dataDir(),'browser-host.sh');
  await atomic(launcher,'#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '+quote(process.execPath)+' '+quote(host)+' --data-dir '+quote(dataDir())+'\n');await chmod(launcher,0o700);
  const folder=join(homedir(),'Library/Application Support',browser==='chrome'?'Google/Chrome':'Microsoft Edge','NativeMessagingHosts');await mkdir(folder,{recursive:true});
  await atomic(join(folder,'app.tracelet.browser.json'),JSON.stringify({name:'app.tracelet.browser',description:'Personal Memory local browser capture',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]}));
  settings.watchBrowser=true;await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings));await startWatch();changed();
 });
 register('open-data',()=>shell.openPath(dataDir()));
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',show);
 app.whenReady().then(async()=>{app.setAboutPanelOptions({applicationName:'Personal Memory',applicationVersion:app.getVersion()});await mkdir(dataDir(),{recursive:true,mode:0o700});
  try{const saved=JSON.parse(await readFile(join(dataDir(),'settings.json'),'utf8'));for(const key of ['watchCodex','watchClaude','watchBrowser','paused'] as const)if(typeof saved[key]==='boolean')settings[key]=saved[key];if(typeof saved.model==='string'&&saved.model.trim())settings.model=saved.model}catch(e:any){if(e.code!=='ENOENT')report(new Error('设置文件损坏，已使用默认设置。'))}
  store=await new Store(join(dataDir(),'tracelet.sqlite')).open();handlers();
  const icon=nativeImage.createFromPath(brandPath('trayTemplate.png'));if(icon.isEmpty())throw new Error('应用图标缺失');if(process.platform==='darwin'){icon.setTemplateImage(true);app.dock?.setIcon(brandPath('icon.png'))}
  if(!(smoke&&process.platform==='linux'&&!process.env.DISPLAY)){tray=new Tray(icon);tray.setTitle('');tray.setToolTip('Personal Memory · 个人记忆');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Personal Memory',click:show},{label:'退出',click:()=>app.quit()}]));tray.on('click',show)}
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Personal Memory',submenu:[{role:'about',label:'关于 Personal Memory'},{role:'hide',label:'隐藏 Personal Memory'},{role:'quit',label:'退出 Personal Memory'}]},{role:'editMenu'},{role:'windowMenu'}]));
  show();await startWatch();
  if(smoke){await new Promise<void>(r=>{if(!window!.webContents.isLoading())r();else window!.webContents.once('did-finish-load',()=>r())});
   await window!.webContents.executeJavaScript(`window.tracelet.settings({watchCodex:true})`);
   const deadline=Date.now()+15000;let count=0;while(Date.now()<deadline){const s=await window!.webContents.executeJavaScript('window.tracelet.snapshot()');count=s.promptCount;if(count===2)break;await new Promise(r=>setTimeout(r,200))}
   if(count!==2)throw new Error('Smoke failed: watcher did not ingest exactly 2 prompts');
   const evidence=store.prompts();
   await store.addMemories([{id:'smoke-memory',category:'preferences',claim:'这次对话希望使用中文回答',layer:'episode',scope:{kind:'conversation',label:'codex:smoke-conversation'},basis:'explicit',action:'add',rationale:'本次请求明确要求中文，保持会话范围。',evidenceIds:[evidence[0].id],evidence:[evidence[0]],evidenceQuotes:[{promptId:evidence[0].id,quote:evidence[0].text}],confidence:.95,status:'pending',createdAt:new Date().toISOString()}]);changed();
   const uiDeadline=Date.now()+10000;let rendered=false;while(Date.now()<uiDeadline){rendered=await window!.webContents.executeJavaScript(`!!document.querySelector('.memory-workspace')&&document.body.innerText.includes('这次对话希望使用中文回答')&&document.body.innerText.includes('请用中文回答。')`);if(rendered)break;await new Promise(r=>setTimeout(r,100))}if(!rendered)throw new Error('Smoke failed: split workspace did not render real data');
   await window!.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('定位提问')).click()`);
   await new Promise(r=>setTimeout(r,200));if(!await window!.webContents.executeJavaScript(`!!document.querySelector('.source-prompt.highlighted')`))throw new Error('Smoke failed: evidence navigation');
   if(process.env.TRACELET_SMOKE_SCREENSHOT)await writeFile(process.env.TRACELET_SMOKE_SCREENSHOT,(await window!.webContents.capturePage()).toPNG());
   await window!.webContents.executeJavaScript(`[...document.querySelectorAll('.memory-card button')].find(b=>b.textContent==='确认记忆').click()`);
   const reviewDeadline=Date.now()+5000;while(Date.now()<reviewDeadline&&store.memories()[0]?.status!=='accepted')await new Promise(r=>setTimeout(r,50));if(store.memories()[0]?.status!=='accepted')throw new Error('Smoke failed: human review');
   // Persistence completes before React's review refresh. Wait for the UI action to settle.
   const idleDeadline=Date.now()+10000;let idle=false;while(Date.now()<idleDeadline){idle=await window!.webContents.executeJavaScript(`![...document.querySelectorAll('.memory-card button')].some(b=>b.textContent==='确认记忆')&&!![...document.querySelectorAll('.memory-card button')].find(b=>b.textContent==='撤回'&&!b.disabled)`);if(idle)break;await new Promise(r=>setTimeout(r,100))}if(!idle)throw new Error('Smoke failed: review UI did not settle');
   await window!.webContents.executeJavaScript(`const checkbox=document.querySelector('.source-conversation input');if(!checkbox.checked)checkbox.click()`);
   const selectionDeadline=Date.now()+10000;let selectionReady=false;while(Date.now()<selectionDeadline){selectionReady=await window!.webContents.executeJavaScript(`!!document.querySelector('.source-conversation input:checked')&&!![...document.querySelectorAll('.source-footer button')].find(b=>b.textContent.includes('预览')&&!b.disabled)`);if(selectionReady)break;await new Promise(r=>setTimeout(r,100))}if(!selectionReady)throw new Error('Smoke failed: preview selection did not settle');
   await window!.webContents.executeJavaScript(`[...document.querySelectorAll('.source-footer button')].find(b=>b.textContent.includes('预览')&&!b.disabled).click()`);
   const previewDeadline=Date.now()+5000;let previewReady=false;while(Date.now()<previewDeadline){previewReady=await window!.webContents.executeJavaScript(`!!document.querySelector('.outbound-context')&&document.body.innerText.includes('tracelet-memory-v2')`);if(previewReady)break;await new Promise(r=>setTimeout(r,100))}if(!previewReady)throw new Error('Smoke failed: outgoing reference preview');
   await window!.webContents.executeJavaScript('window.tracelet.settings({watchBrowser:true})');
   const browserPacket={format:'tracelet.browser.capture.v1',url:'https://grok.com/c/smoke',conversationId:'b'.repeat(64),title:'Browser smoke',capturedAt:'2026-10-19T00:00:00Z',messages:[{id:'browser-smoke',role:'user',text:'浏览器采集保留来源。'}]};
   const host=spawn(process.execPath,[join(__dirname,'browser-host.cjs'),'--data-dir',dataDir()],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','pipe','pipe']});const responses:Buffer[]=[];host.stdout.on('data',b=>responses.push(b));host.stdin.end(frame(browserPacket));
   const hostTimer=setTimeout(()=>host.kill('SIGKILL'),10000);const hostCode=await new Promise(resolve=>{host.on('error',()=>resolve(1));host.on('close',resolve)});clearTimeout(hostTimer);
   const response=Buffer.concat(responses);if(hostCode!==0||response.length<4||!JSON.parse(response.subarray(4,4+response.readUInt32LE()).toString()).ok)throw new Error('Smoke failed: compiled browser native host');
   const browserDeadline=Date.now()+5000;while(Date.now()<browserDeadline&&store.count()!==3)await new Promise(r=>setTimeout(r,100));
   const browserPrompt=store.prompts().find(p=>p.provider==='grok');if(store.count()!==3||browserPrompt?.timeSource!=='captured'||browserPrompt?.source!=='https://grok.com/c/smoke')throw new Error('Smoke failed: native inbox watcher');
   console.log('TRACELET_SMOKE_OK: watcher, SQLite/WASM, split workspace, evidence navigation, human review, exact outgoing preview, compiled native host and browser inbox; no AI request sent');app.quit();
  }
 }).catch(e=>{if(smoke){console.error('::error::TRACELET_SMOKE_FAILED: '+String(e.message));app.exit(1)}else{dialog.showErrorBox('Personal Memory 启动失败',String(e.message));app.quit()}});
 app.on('activate',()=>{if(store)show()});
 app.on('before-quit',()=>{quitting=true;void watcher?.close();void browserWatcher?.close()});
 app.on('window-all-closed',()=>{});
}
