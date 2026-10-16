import { app, BrowserWindow, ipcMain, dialog, safeStorage, Tray, Menu, nativeImage, shell } from 'electron';
import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { watch, type FSWatcher } from 'chokidar';
import { Store } from './store';
import { parseJSONL, parseExport } from './parsers';
import { preview, digest, analyze } from './analyzer';
import type { Settings } from './types';

let window:BrowserWindow|null=null;let tray:Tray;let store:Store;let quitting=false;let watcher:FSWatcher|undefined;
let settings:Omit<Settings,'keyPresent'|'keyStorageAvailable'>={watchCodex:false,watchClaude:false,model:'deepseek/deepseek-v4-flash',paused:false};
let errors:string[]=[];let busy=false;let queue=Promise.resolve();
const dev=process.argv.includes('--dev')&&!app.isPackaged;
const smoke=process.argv.includes('--smoke')&&!app.isPackaged;
if(smoke&&process.env.TRACELET_SMOKE_DATA)app.setPath('userData',process.env.TRACELET_SMOKE_DATA);
const dataDir=()=>app.getPath('userData');
const keyFile=()=>join(dataDir(),'openrouter.key');
const changed=()=>window?.webContents.send('changed');
const report=(e:unknown)=>{errors=[String(e instanceof Error?e.message:e),...errors].slice(0,5);changed()};
async function atomic(file:string,data:string|Buffer){await writeFile(file+'.tmp',data,{mode:0o600});await rename(file+'.tmp',file)}
async function getKey(){try{return safeStorage.decryptString(await readFile(keyFile()))}catch(e:any){if(e.code==='ENOENT')return '';throw new Error('无法解锁 API Key。请重新保存 Key。')}}
async function keyPresent(){try{await stat(keyFile());return true}catch{return false}}
async function publicSettings(){return {...settings,keyPresent:await keyPresent(),keyStorageAvailable:safeStorage.isEncryptionAvailable()}}
function show(){if(window){window.show();window.focus();return}
 window=new BrowserWindow({width:1250,height:850,minWidth:960,minHeight:680,title:'Tracelet · 你的个人记忆层',backgroundColor:'#f7f7f2',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
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
async function startWatch(){await watcher?.close();watcher=undefined;if(settings.paused)return;
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
 register('snapshot',async()=>({traces:store.traces(),memories:store.memories(),settings:await publicSettings(),errors,promptCount:store.count()}));
 register('prompts',(id:unknown)=>{if(typeof id!=='string')throw new Error('对话 ID 无效');return store.prompts(id)});
 register('settings',async(value:unknown)=>{if(!value||typeof value!=='object')throw new Error('设置无效');const v=value as Record<string,unknown>;
  for(const key of ['watchCodex','watchClaude','paused'] as const){if(key in v){if(typeof v[key]!=='boolean')throw new Error('设置无效');settings[key]=v[key]}}
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
 register('preview',(ids:unknown)=>{const p=preview(store.unanalyzed(selected(ids)),settings.model);return {...p,digest:digest(p)}});
 register('analyze',async(ids:unknown,approvedDigest:unknown)=>{if(busy)throw new Error('分析正在进行中');const p=preview(store.unanalyzed(selected(ids)),settings.model);if(digest(p)!==approvedDigest)throw new Error('内容已更新，请重新预览后再发送');if(!p.prompts.length)throw new Error('所选对话没有待分析的新提问');
  const key=await getKey();if(!key)throw new Error('请先在设置中保存 API Key');busy=true;try{const memories=await analyze(p,key);const existing=new Set(store.memories().map(m=>m.claim.trim()));const novel=memories.filter(m=>!existing.has(m.claim.trim()));await store.addMemories(novel);await store.markAnalyzed(p.prompts);changed();return novel.length}finally{busy=false}
 });
 register('review',async(id:unknown,status:unknown)=>{if(typeof id!=='string'||!['accepted','rejected'].includes(String(status)))throw new Error('审核参数无效');await store.review(id,status as 'accepted'|'rejected');changed()});
 register('export',async()=>{const file=await dialog.showSaveDialog({defaultPath:'tracelet-export.json',filters:[{name:'JSON',extensions:['json']}]});if(file.canceled||!file.filePath)return false;await writeFile(file.filePath,JSON.stringify({version:1,exportedAt:new Date().toISOString(),prompts:store.prompts(),memories:store.memories()},null,2),{mode:0o600});return true});
 register('erase',async()=>{if(busy)throw new Error('请等待分析结束后再清空数据');const answer=await dialog.showMessageBox({type:'warning',message:'删除所有本地提问与记忆？',detail:'采集将暂停。原始平台文件不会被删除；重新开启采集会再次导入。此操作无法撤销。',buttons:['取消','删除'],defaultId:0,cancelId:0});if(answer.response!==1)return false;settings.paused=true;await atomic(join(dataDir(),'settings.json'),JSON.stringify(settings));await startWatch();await queue;await store.erase();changed();return true});
 register('open-data',()=>shell.openPath(dataDir()));
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',show);
 app.whenReady().then(async()=>{await mkdir(dataDir(),{recursive:true,mode:0o700});
  try{const saved=JSON.parse(await readFile(join(dataDir(),'settings.json'),'utf8'));for(const key of ['watchCodex','watchClaude','paused'] as const)if(typeof saved[key]==='boolean')settings[key]=saved[key];if(typeof saved.model==='string'&&saved.model.trim())settings.model=saved.model}catch(e:any){if(e.code!=='ENOENT')report(new Error('设置文件损坏，已使用默认设置。'))}
  store=await new Store(join(dataDir(),'tracelet.sqlite')).open();handlers();
  const icon=nativeImage.createFromDataURL('data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M4 5h8a5 5 0 0 1 0 10H7m0-5v10m-4-4 4 4 4-4" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/></svg>').toString('base64'));
  if(!(smoke&&process.platform==='linux'&&!process.env.DISPLAY)){tray=new Tray(icon);tray.setTitle('⌁');tray.setToolTip('Tracelet · 个人记忆');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Tracelet',click:show},{label:'退出',click:()=>app.quit()}]));tray.on('click',show)}
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Tracelet',submenu:[{role:'about'},{role:'hide'},{role:'quit'}]},{role:'editMenu'},{role:'windowMenu'}]));
  show();await startWatch();
  if(smoke){await new Promise<void>(r=>{if(!window!.webContents.isLoading())r();else window!.webContents.once('did-finish-load',()=>r())});
   await window!.webContents.executeJavaScript(`window.tracelet.settings({watchCodex:true})`);
   const deadline=Date.now()+15000;let count=0;while(Date.now()<deadline){const s=await window!.webContents.executeJavaScript('window.tracelet.snapshot()');count=s.promptCount;if(count===2)break;await new Promise(r=>setTimeout(r,200))}
   if(count!==2)throw new Error('Smoke failed: watcher did not ingest exactly 2 prompts');
   const rendered=await window!.webContents.executeJavaScript(`document.body.innerText.includes('你的提问')`);if(!rendered)throw new Error('Smoke failed: React UI did not render');
   console.log('TRACELET_SMOKE_OK: real Electron window, preload IPC, SQLite/WASM, file watcher, React UI');app.quit();
  }
 }).catch(e=>{if(smoke){console.error('TRACELET_SMOKE_FAILED:',String(e.message));app.exit(1)}else{dialog.showErrorBox('Tracelet 启动失败',String(e.message));app.quit()}});
 app.on('activate',()=>{if(store)show()});
 app.on('before-quit',()=>{quitting=true;void watcher?.close()});
 app.on('window-all-closed',()=>{});
}
