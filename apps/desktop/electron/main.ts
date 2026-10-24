import { app, BrowserWindow, ipcMain, dialog, safeStorage, Tray, Menu, nativeImage, shell, systemPreferences } from 'electron';
import {writeFileSync} from 'node:fs';
import { readFile, writeFile, mkdir, rename, unlink, stat, readdir, chmod } from 'node:fs/promises';
import { join, resolve, basename, dirname, isAbsolute, sep } from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DesktopReview,desktopAppSchema,desktopReadSchema} from './desktop-capture';
import {z} from 'zod';
import {browserConnection,localConnection} from './connections';
import {ANALYSIS_ENABLED} from './memory-prompt';
import {readLocalJSONL} from './local-jsonl';
import {syncDoubaoWork,watchDoubaoWork} from './doubao-work';
import {readCodexDatabase,watchCodexDatabase,codexDatabaseName} from './codex-database';
import {syncCodexFiles,syncCodexHistory} from './history-sync';
import {validProvider} from './platform';
import { homedir, tmpdir } from 'node:os';
import { watch, type FSWatcher } from 'chokidar';
import {browserPrompts,frame} from './browser-capture';
import { Store } from './store';
import { parseJSONL, parseExport } from './parsers';
import { preview, digest, analyze, sameScope } from './analyzer';
import type { Settings, HistorySyncState, Provider } from './types';

let window:BrowserWindow|null=null;let tray:Tray;let store:Store;let quitting=false;let watcher:FSWatcher|undefined;
let settings:Omit<Settings,'keyPresent'|'keyStorageAvailable'>={watchCodex:true,watchClaude:true,watchDoubaoWork:true,watchBrowser:false,model:'deepseek/deepseek-v4-flash',paused:false};
let browserWatcher:FSWatcher|undefined;let doubaoWatcher:ReturnType<typeof watchDoubaoWork>|undefined;let doubaoGeneration=0;let codexDatabaseWatcher:ReturnType<typeof watchCodexDatabase>|undefined;
const doubaoRoots=()=>[join(homedir(),'Library/Application Support/DoubaoWork/Default/.doubaowork/agent_mode/workspace/.sessions')];
let historySync:HistorySyncState|undefined;let historyAbort:AbortController|undefined;let historyTask:Promise<HistorySyncState>|undefined;
const codexHome=()=>resolve(settings.codexHome||process.env.CODEX_HOME||join(homedir(),'.codex'));
const claudeRoots=()=>[join(homedir(),'.claude','projects')];
const codexRoots=()=>['sessions','archived_sessions'].map(name=>join(codexHome(),name));
let errors:string[]=[];let busy=false;let queue=Promise.resolve();
// Keep the legacy OS identity for Keychain/safeStorage and existing user data.
app.setName('Tracelet');
app.setPath('userData',join(app.getPath('appData'),app.isPackaged?'Tracelet':'tracelet'));
const dev=process.argv.includes('--dev')&&!app.isPackaged;
const smoke=process.argv.includes('--smoke')&&!app.isPackaged;
const packageCheck=app.isPackaged&&process.argv.includes('--package-check');
if(packageCheck){const target=process.env.PERSONAL_MEMORY_PACKAGE_CHECK_DATA;if(!target||!resolve(target).startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('personal-memory-package-check-'))throw new Error('Package check requires an isolated temporary data directory');app.setPath('userData',target)}
if(smoke||packageCheck)app.disableHardwareAcceleration();
if(smoke&&process.env.TRACELET_SMOKE_DATA)app.setPath('userData',process.env.TRACELET_SMOKE_DATA);
const dataDir=()=>app.getPath('userData');
const startupEvents:{stage:string;at:string}[]=[];
function startupStage(stage:string){startupEvents.push({stage,at:new Date().toISOString()});if(startupEvents.length>20)startupEvents.shift();try{writeFileSync(join(dataDir(),'startup-status.json'),JSON.stringify({version:app.getVersion(),pid:process.pid,events:startupEvents}),{mode:0o600})}catch{}}
let firstSnapshot=true;
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
async function publicSettings(){return {...settings,codexHome:codexHome(),keyPresent:await keyPresent(),keyStorageAvailable:ANALYSIS_ENABLED&&!packageCheck&&safeStorage.isEncryptionAvailable()}}
function show(){if(window){window.show();window.focus();return}
 window=new BrowserWindow({width:1250,height:850,minWidth:960,minHeight:680,title:'Personal Memory · 你的个人记忆层',icon:brandPath('icon.png'),show:!(smoke||packageCheck),backgroundColor:'#ffffff',webPreferences:{...((smoke||packageCheck)?{offscreen:true,backgroundThrottling:false}:{}),preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',e=>e.preventDefault());
 window.on('close',e=>{if(!quitting){e.preventDefault();window?.hide()}});
 window.on('closed',()=>{window=null});
 if(dev)void window.loadURL('http://127.0.0.1:5173');else void window.loadFile(join(__dirname,'../dist/index.html'));
}
function register(name:string,fn:(...args:any[])=>unknown){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==window?.webContents)throw new Error('不可信的请求来源');return fn(...args)})}
async function ingest(path:string,provider:'codex'|'claude'){
 if(settings.paused||!path.endsWith('.jsonl'))return;
 const prompts=await readLocalJSONL(path,provider);if(!settings.paused)await store.upsert(prompts);changed();
}
async function ingestBrowser(file:string){
 if(settings.paused||!settings.watchBrowser||!file.endsWith('.json'))return;
 if((await stat(file)).size>1024*1024)throw new Error('浏览器数据包超过限制');
 await store.upsert(browserPrompts(JSON.parse(await readFile(file,'utf8'))));await unlink(file);changed();
}
async function startWatch(){
 const generation=++doubaoGeneration;
 await codexDatabaseWatcher?.close();codexDatabaseWatcher=undefined;
 if(settings.watchCodex&&!settings.paused){
  const sync=()=>{queue=queue.then(async()=>{if(generation!==doubaoGeneration||settings.paused||!settings.watchCodex)return;const rows=await readCodexDatabase(codexHome());if(generation===doubaoGeneration&&!settings.paused&&settings.watchCodex){await store.upsert(rows);changed()}}).catch(report)};
  codexDatabaseWatcher=watchCodexDatabase(codexHome(),sync,report);sync();
 }
await doubaoWatcher?.close();doubaoWatcher=undefined;
 if(settings.watchDoubaoWork&&!settings.paused){
  const sync=()=>{queue=queue.then(async()=>{if(generation!==doubaoGeneration||settings.paused||!settings.watchDoubaoWork)return;const result=await syncDoubaoWork(doubaoRoots(),rows=>generation!==doubaoGeneration||settings.paused||!settings.watchDoubaoWork?Promise.resolve(0):store.upsert(rows),new AbortController().signal,()=>{});if(result.errors.length)report(result.errors.join('\n'));changed()}).catch(report)};
  doubaoWatcher=watchDoubaoWork(doubaoRoots(),sync,report);sync();
 }
 await browserWatcher?.close();browserWatcher=undefined;
 if(settings.watchBrowser&&!settings.paused){const inbox=join(dataDir(),'browser-inbox');await mkdir(inbox,{recursive:true,mode:0o700});
 browserWatcher=watch(inbox,{ignoreInitial:false,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:300,pollInterval:100}});
 browserWatcher.on('add',file=>{queue=queue.then(()=>ingestBrowser(file)).catch(report)}).on('error',report);
 }
 await watcher?.close();watcher=undefined;if(settings.paused)return;
 const paths:{path:string;provider:'codex'|'claude'}[]=[];
 if(settings.watchCodex)paths.push(...codexRoots().map(path=>({path,provider:'codex' as const})));
 if(settings.watchClaude)paths.push({path:join(homedir(),'.claude','projects'),provider:'claude'});
 if(!paths.length)return;
 watcher=watch(paths.map(p=>p.path),{ignoreInitial:false,followSymlinks:false,awaitWriteFinish:{stabilityThreshold:700,pollInterval:150},ignored:(p,s)=>!!s?.isFile()&&!p.endsWith('.jsonl')});
 const onFile=(file:string)=>{const source=paths.find(p=>file.startsWith(p.path+'/'));if(!source)return;queue=queue.then(()=>ingest(file,source.provider)).catch(report)};
 watcher.on('add',onFile).on('change',onFile).on('error',report);
}
function selected(ids:unknown){if(!Array.isArray(ids)||ids.length>1000||ids.some(i=>typeof i!=='string'))throw new Error('对话选择无效');return store.prompts().filter(p=>ids.includes(`${p.provider}:${p.conversationId}`))}
function handlers(){
 const syncLocal=async(provider:unknown)=>{
  if(provider!=='codex'&&provider!=='claude'&&provider!=='doubao-work')throw new Error('未知本地来源');
  if(settings.paused)throw new Error('采集已暂停，请先恢复采集');
  if(historyTask){if(historySync?.provider!==provider)throw new Error('另一个应用正在同步，请稍候');return historyTask}
  const controller=new AbortController();historyAbort=controller;
  historyTask=provider==='codex'?syncCodexHistory(codexRoots(),rows=>settings.paused||controller.signal.aborted?Promise.resolve(0):store.upsert(rows),controller.signal,state=>{historySync=state;changed()}):provider==='doubao-work'?syncDoubaoWork(doubaoRoots(),rows=>settings.paused||controller.signal.aborted?Promise.resolve(0):store.upsert(rows),controller.signal,state=>{historySync=state;changed()}):syncCodexFiles(claudeRoots(),rows=>settings.paused||controller.signal.aborted?Promise.resolve(0):store.upsert(rows),controller.signal,state=>{historySync=state;changed()},provider);
  try{return await historyTask}finally{historyTask=undefined;historyAbort=undefined}
 };
 register('sync-codex-history',()=>syncLocal('codex'));
 register('sync-local-history',syncLocal);
 register('connections',async()=>{
  const configured:('chrome'|'edge')[]=[];
  for(const browser of ['chrome','edge'] as const)try{const dir=join(homedir(),'Library/Application Support',browser==='chrome'?'Google/Chrome':'Microsoft Edge','NativeMessagingHosts');const manifest=JSON.parse(await readFile(join(dir,'app.tracelet.browser.json'),'utf8'));if(manifest.name==='app.tracelet.browser'&&Array.isArray(manifest.allowed_origins)&&manifest.allowed_origins.length&&manifest.path===join(dataDir(),'browser-host.sh')){await stat(manifest.path);configured.push(browser)}}catch{}
  return {local:await Promise.all([localConnection('codex',[...codexRoots(),join(codexHome(),codexDatabaseName)],settings.watchCodex,settings.paused),localConnection('claude',claudeRoots(),settings.watchClaude,settings.paused),localConnection('doubao-work',doubaoRoots(),!!settings.watchDoubaoWork,settings.paused)]),browser:await browserConnection(dataDir(),configured),accessibility:process.platform==='darwin'&&systemPreferences.isTrustedAccessibilityClient(false)};
 });
 register('cancel-history-sync',()=>{historyAbort?.abort()});
 register('choose-codex-home',async()=>{
  if(historyTask)throw new Error('请先停止历史同步');
  const result=await dialog.showOpenDialog({title:'选择 Codex 数据目录（包含会话目录或历史数据库）',defaultPath:codexHome(),properties:['openDirectory','showHiddenFiles']});
  if(result.canceled)return false;let selected=resolve(result.filePaths[0]);if(['sessions','archived_sessions'].includes(basename(selected)))selected=dirname(selected);
  const exists=await Promise.all(['sessions','archived_sessions',codexDatabaseName].map(async name=>{try{const s=await stat(join(selected,name));return name===codexDatabaseName?s.isFile():s.isDirectory()}catch{return false}}));
  if(!exists.some(Boolean))throw new Error('此目录下没有会话目录或历史数据库，请选择 Codex 的数据目录');
  settings.codexHome=selected;historySync=undefined;await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings));await startWatch();changed();return true;
 });
 register('desktop-apps',async()=>z.array(desktopAppSchema).parse(await nativeCapture(['--apps'])));
 register('desktop-permission',()=>{if(process.platform!=='darwin')throw new Error('窗口采集仅支持 macOS');return systemPreferences.isTrustedAccessibilityClient(true)});
 register('desktop-preview',async(pid:unknown)=>{desktopReview.clear();if(settings.paused)throw new Error('采集已暂停，请先恢复');if(typeof pid!=='number'||!Number.isInteger(pid)||pid<=0)throw new Error('请选择正在运行的应用');const raw=desktopReadSchema.parse(await nativeCapture(['--read',String(pid)]));if(settings.paused)throw new Error('采集已暂停');if(raw.app.pid!==pid)throw new Error('应用已变化，请刷新列表');return desktopReview.stage(raw)});
 register('desktop-commit',async(token:unknown,ids:unknown,provider:unknown,conversation:unknown)=>{if(settings.paused)throw new Error('采集已暂停');const rows=desktopReview.confirm(token,ids,provider,conversation);const added=await store.upsert(rows);desktopReview.clear();changed();return added});
 register('snapshot',async()=>{const initial=firstSnapshot;if(initial)startupStage('snapshot-start');const publicConfig=await publicSettings();if(initial)startupStage('snapshot-settings-ready');const result={traces:store.traces(),memories:store.memories(),settings:publicConfig,historySync,errors,promptCount:store.count()};if(initial){firstSnapshot=false;startupStage('snapshot-complete')}return result});
 register('prompts',(id:unknown)=>{if(typeof id!=='string')throw new Error('对话 ID 无效');return store.prompts(id)});
 register('settings',async(value:unknown)=>{if(!value||typeof value!=='object')throw new Error('设置无效');const v=value as Record<string,unknown>;
  for(const key of ['watchCodex','watchClaude','watchDoubaoWork','watchBrowser','paused'] as const){if(key in v){if(typeof v[key]!=='boolean')throw new Error('设置无效');settings[key]=v[key]}}
  if(settings.paused){desktopReview.clear();historyAbort?.abort()}
  if('model' in v){if(typeof v.model!=='string'||!v.model.trim()||v.model.length>200)throw new Error('模型 ID 无效');settings.model=v.model.trim()}
  await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings));await startWatch();changed();
 });
 register('save-key',async(key:unknown)=>{if(typeof key!=='string'||!key.startsWith('sk-or-')||key.length>1000)throw new Error('请输入有效的 OpenRouter API Key');if(!safeStorage.isEncryptionAvailable())throw new Error('系统钥匙串不可用，未保存 Key');await atomic(keyFile(),safeStorage.encryptString(key.trim()));changed()});
 register('remove-key',async()=>{await unlink(keyFile()).catch((e:any)=>{if(e.code!=='ENOENT')throw e});changed()});
 register('models',async()=>{const r=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('无法获取模型列表 ('+r.status+')');const json:any=await r.json();return json.data.filter((m:any)=>typeof m.id==='string'&&m.id.startsWith('deepseek/')).map((m:any)=>({id:m.id,name:m.name}))});
 register('import',async(hint:unknown)=>{
  if(settings.paused)throw new Error('采集已暂停，请先恢复采集再导入');
  if(hint!==undefined&&!validProvider(hint))throw new Error('来源平台无效');const provider=hint as Provider|undefined;
  const files=await dialog.showOpenDialog({title:provider==='doubao'?'批量导入豆包历史 JSON':'批量导入对话文件',properties:['openFile','multiSelections'],filters:[{name:'对话导出',extensions:provider?['json']:['json','jsonl']}]});
  if(files.canceled)return {added:0,message:'已取消'};
  let added=0,success=0;const failures:string[]=[];
  for(const path of files.filePaths){if(settings.paused){failures.push('采集已暂停，其余文件未导入');break}try{
   if((await stat(path)).size>100*1024*1024)throw new Error('文件超过 100 MB');const raw=await readFile(path,'utf8');
   let prompts;if(path.endsWith('.jsonl')){if(provider)throw new Error('此入口仅支持 JSON');const source:'codex'|'claude'=raw.includes('"session_meta"')||raw.includes('"response_item"')||raw.includes('"event_msg"')?'codex':'claude';prompts=parseJSONL(raw,source,path)}else prompts=parseExport(raw,path,provider);
   if(!prompts.length)throw new Error('没有可识别的用户提问');if(provider&&prompts.some(p=>p.provider!==provider))throw new Error('文件声明的来源与所选平台不符，未导入');
   if(settings.paused)throw new Error('采集已暂停，未导入');added+=await store.upsert(prompts);success++;changed();
  }catch(e){failures.push(basename(path)+': '+(e instanceof Error?e.message:String(e)))}}
  return {added,message:`已处理 ${success}/${files.filePaths.length} 个文件，新增 ${added} 条提问（重复记录不再新增）。`+(failures.length?'\n'+failures.slice(0,5).join('\n'):'')};
 });
 register('preview',(ids:unknown)=>{const p=preview(store.unanalyzed(selected(ids)),settings.model,store.memories());return {...p,digest:digest(p)}});
 register('analyze',async(ids:unknown,approvedDigest:unknown)=>{if(!ANALYSIS_ENABLED)throw new Error('记忆分析已暂停；当前仅展示提炼协议和已有结果');if(busy)throw new Error('分析正在进行中');const p=preview(store.unanalyzed(selected(ids)),settings.model,store.memories());if(digest(p)!==approvedDigest)throw new Error('内容或参考记忆已更新，请重新预览后再发送');if(!p.prompts.length)throw new Error('所选对话没有待分析的新提问');
  const key=await getKey();if(!key)throw new Error('请先在设置中保存 API Key');busy=true;try{const memories=await analyze(p,key);const existing=store.memories().filter(m=>m.status==='pending'||m.status==='accepted');const novel=memories.filter(m=>!existing.some(old=>old.claim.trim()===m.claim.trim()&&old.category===m.category&&sameScope(old.scope,m.scope)));await store.addMemories(novel);await store.markAnalyzed(p.prompts);changed();return novel.length}finally{busy=false}
 });
 register('review',async(id:unknown,status:unknown)=>{if(typeof id!=='string'||!['accepted','rejected'].includes(String(status)))throw new Error('审核参数无效');await store.review(id,status as 'accepted'|'rejected');changed()});
 register('export',async()=>{const file=await dialog.showSaveDialog({defaultPath:'personal-memory-export.json',filters:[{name:'JSON',extensions:['json']}]});if(file.canceled||!file.filePath)return false;await writeFile(file.filePath,JSON.stringify({version:1,exportedAt:new Date().toISOString(),prompts:store.prompts(),memories:store.memories()},null,2),{mode:0o600});return true});
 register('erase',async()=>{if(busy)throw new Error('请等待分析结束后再清空数据');const answer=await dialog.showMessageBox({type:'warning',message:'删除所有本地提问与记忆？',detail:'采集将暂停。原始平台文件不会被删除；重新开启采集会再次导入。此操作无法撤销。',buttons:['取消','删除'],defaultId:0,cancelId:0});if(answer.response!==1)return false;settings.paused=true;historyAbort?.abort();await historyTask;await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings));await startWatch();await queue;await store.erase();desktopReview.clear();for(const file of await readdir(join(dataDir(),'browser-inbox')).catch(()=>[]))if(file.endsWith('.json')||file.endsWith('.tmp'))await unlink(join(dataDir(),'browser-inbox',file));changed();return true});
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
  try{const saved=JSON.parse(await readFile(join(dataDir(),'settings.json'),'utf8'));for(const key of ['watchCodex','watchClaude','watchDoubaoWork','watchBrowser','paused'] as const)if(typeof saved[key]==='boolean')settings[key]=saved[key];if(saved.collectionVersion===1)settings.collectionVersion=1;if(typeof saved.codexHome==='string'&&isAbsolute(saved.codexHome))settings.codexHome=saved.codexHome;if(typeof saved.model==='string'&&saved.model.trim())settings.model=saved.model}catch(e:any){if(e.code!=='ENOENT')report(new Error('设置文件损坏，已使用默认设置。'))}
  if(!settings.collectionVersion){settings.watchCodex=true;settings.watchClaude=true;settings.collectionVersion=1;await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings))}
  store=await new Store(join(dataDir(),'tracelet.sqlite')).open();handlers();startupStage('store-ready');
  const icon=nativeImage.createFromPath(brandPath('trayTemplate.png'));if(icon.isEmpty())throw new Error('应用图标缺失');if(process.platform==='darwin'){icon.setTemplateImage(true);app.dock?.setIcon(brandPath('icon.png'))}
  if(!packageCheck&&!(smoke&&process.platform==='linux'&&!process.env.DISPLAY)){tray=new Tray(icon);tray.setTitle('');tray.setToolTip('Personal Memory · 个人记忆');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Personal Memory',click:show},{label:'退出',click:()=>app.quit()}]));tray.on('click',show)}
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Personal Memory',submenu:[{role:'about',label:'关于 Personal Memory'},{role:'hide',label:'隐藏 Personal Memory'},{role:'quit',label:'退出 Personal Memory'}]},{role:'editMenu'},{role:'windowMenu'}]));
  if(packageCheck||smoke){settings.watchCodex=false;settings.watchClaude=false;settings.watchDoubaoWork=false;settings.watchBrowser=false;settings.paused=packageCheck}
  show();startupStage('window-created');await startWatch();startupStage('watchers-ready');
  if(packageCheck){
   const deadline=Date.now()+20000;let ready=false;while(Date.now()<deadline){if(!window!.webContents.isLoading()){ready=await window!.webContents.executeJavaScript(`!!document.querySelector('.data-page')&&!!document.querySelector('.sidebar')`);if(ready)break}await new Promise(r=>setTimeout(r,100))}
   if(!ready||store.count()!==0)throw new Error('Packaged renderer or empty SQLite failed');
   const apps=z.array(desktopAppSchema).parse(await nativeCapture(['--apps']));
   console.log('PACKAGE_CHECK_OK v'+app.getVersion()+': packaged renderer, SQLite/WASM, native helper ('+apps.length+' running apps); isolated data, no AI request');app.quit();return;
  }
  if(smoke){await new Promise<void>(r=>{if(!window!.webContents.isLoading())r();else window!.webContents.once('did-finish-load',()=>r())});
   const historyResult=await window!.webContents.executeJavaScript('window.tracelet.syncCodexHistory()');
   if(historyResult.added!==2||historyResult.processed!==2||historyResult.skipped!==0)throw new Error('Smoke failed: complete historical sessions/archive scan');
   if((await window!.webContents.executeJavaScript('window.tracelet.syncCodexHistory()')).added!==0)throw new Error('Smoke failed: repeated history sync duplicated prompts');
   await window!.webContents.executeJavaScript(`window.tracelet.settings({watchCodex:true})`);
   const deadline=Date.now()+15000;let count=0;while(Date.now()<deadline){const s=await window!.webContents.executeJavaScript('window.tracelet.snapshot()');count=s.promptCount;if(count===2)break;await new Promise(r=>setTimeout(r,200))}
   if(count!==2)throw new Error('Smoke failed: watcher did not ingest exactly 2 prompts');
   const waitUI=async(code:string)=>{const until=Date.now()+10000;while(Date.now()<until){if(await window!.webContents.executeJavaScript(code))return;await new Promise(r=>setTimeout(r,100))}throw new Error('Smoke UI failed: '+code)};
   await waitUI(`document.querySelectorAll('.collected-prompt').length===2&&document.body.innerText.includes('请用中文回答。')`);
   await window!.webContents.executeJavaScript(`[...document.querySelectorAll('.nav')].find(b=>b.textContent==='记忆总结').click()`);
   await waitUI(`!!document.querySelector('.system-prompt')&&document.body.innerText.includes('分析已暂停')`);
   const blocked=await window!.webContents.executeJavaScript(`window.tracelet.analyze([], '').then(()=>false,e=>String(e).includes('暂停'))`);if(!blocked)throw new Error('Smoke failed: analysis must be blocked');
   await window!.webContents.executeJavaScript(`[...document.querySelectorAll('.nav')].find(b=>b.textContent==='采集数据').click()`);
   await writeFile(join(codexRoots()[1],'watcher.jsonl'),[{type:'session_meta',payload:{id:'smoke-followup'}},{type:'response_item',timestamp:'2026-10-23T00:00:00Z',payload:{role:'user',content:[{type:'input_text',text:'自动采集归档里的新提问。'}]}}].map(row=>JSON.stringify(row)).join('\n')+'\n');
   const watchDeadline=Date.now()+10000;while(Date.now()<watchDeadline&&store.count()!==3)await new Promise(r=>setTimeout(r,100));if(store.count()!==3)throw new Error('Smoke failed: automatic archived watcher');
   await window!.webContents.executeJavaScript('window.tracelet.settings({watchBrowser:true})');
   const browserPacket={format:'tracelet.browser.capture.v1',url:'https://grok.com/c/smoke',conversationId:'b'.repeat(64),title:'Browser smoke',capturedAt:'2026-10-19T00:00:00Z',messages:[{id:'browser-smoke',role:'user',text:'浏览器采集保留来源。'}]};
   const host=spawn(process.execPath,[join(__dirname,'browser-host.cjs'),'--data-dir',dataDir()],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','pipe','pipe']});const responses:Buffer[]=[];host.stdout.on('data',b=>responses.push(b));host.stdin.end(frame(browserPacket));
   const hostTimer=setTimeout(()=>host.kill('SIGKILL'),10000);const hostCode=await new Promise(resolve=>{host.on('error',()=>resolve(1));host.on('close',resolve)});clearTimeout(hostTimer);
   const response=Buffer.concat(responses);if(hostCode!==0||response.length<4||!JSON.parse(response.subarray(4,4+response.readUInt32LE()).toString()).ok)throw new Error('Smoke failed: compiled browser native host');
   const browserDeadline=Date.now()+5000;while(Date.now()<browserDeadline&&store.count()!==4)await new Promise(r=>setTimeout(r,100));
   const browserPrompt=store.prompts().find(p=>p.provider==='grok');if(store.count()!==4||browserPrompt?.timeSource!=='captured'||browserPrompt?.source!=='https://grok.com/c/smoke')throw new Error('Smoke failed: native inbox watcher');
   console.log('TRACELET_SMOKE_OK: history scan (sessions + archives), repeated sync deduplication, automatic archived watcher, SQLite/WASM, grouped chronological data, System Prompt display, blocked analysis, compiled native host and browser inbox; no AI request sent');app.quit();
  }
 }).catch(e=>{if(smoke||packageCheck){console.error('::error::TRACELET_SMOKE_FAILED: '+String(e.message));app.exit(1)}else{dialog.showErrorBox('Personal Memory 启动失败',String(e.message));app.quit()}});
 app.on('activate',()=>{if(store)show()});
 app.on('before-quit',()=>{quitting=true;++doubaoGeneration;void doubaoWatcher?.close();void codexDatabaseWatcher?.close();historyAbort?.abort();void watcher?.close();void browserWatcher?.close()});
 app.on('window-all-closed',()=>{});
}
