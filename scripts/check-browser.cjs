const {app,BrowserWindow}=require('electron');
const {mkdirSync,writeFileSync,readFileSync,mkdtempSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');const http=require('node:http');
app.disableHardwareAcceleration();
const root=mkdtempSync(join(require('node:os').tmpdir(),'personal-memory-site-'));app.setPath('userData',root);
let server,mode='current';
const manifest=prefix=>({available:true,tag:'v0.4.0',signed:false,assets:[`${prefix}-mac-arm64.dmg`,`${prefix}-mac-x64.dmg`,`${prefix}-browser-extension.zip`,'SHA256SUMS.txt'].map(name=>({name,url:`https://github.com/JackZhong1998/personal-memory/releases/download/v0.4.0/${name}`}))});
app.whenReady().then(async()=>{
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
 server=http.createServer((req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);
  if(file==='release.json'){let data=mode==='off'?{available:false}:manifest(mode==='legacy'?'Tracelet':'Personal-Memory');if(mode==='invalid')data.assets.forEach(a=>a.url='https://example.invalid/'+a.name);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return}
  if(!['index.html','privacy.html','style.css','app.js','icon.png','workspace.png'].includes(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',mime[require('node:path').extname(file)]);res.end(readFileSync(join(resolve('site'),file)));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
 mkdirSync('.local',{recursive:true});const page=new BrowserWindow({width:1440,height:1080,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const errors=[];page.webContents.on('console-message',(_event,...args)=>{const details=args[0];if(details?.level==='error')errors.push(details.message)});
 for(const scenario of ['current','legacy','off','invalid']){
  mode=scenario;await page.loadURL(base);const positive=['current','legacy'].includes(mode);
  if(positive){const deadline=Date.now()+5000;while(Date.now()<deadline){if(await page.webContents.executeJavaScript(`[...document.querySelectorAll('.download-link,#extension-download')].every(a=>!a.hasAttribute('aria-disabled'))`))break;await new Promise(r=>setTimeout(r,50))}}
  await new Promise(r=>setTimeout(r,150));
  const result=await page.webContents.executeJavaScript(`({title:document.title,links:[...document.querySelectorAll('.download-link,#extension-download')].map(a=>({href:a.href,disabled:a.getAttribute('aria-disabled')==='true'}))})`);
  if(!result.title.includes('Personal Memory')||result.links.some(a=>a.disabled===positive))throw new Error(mode+' download state '+JSON.stringify(result));
  if(positive){const prefix=mode==='legacy'?'Tracelet':'Personal-Memory';if(result.links.some(a=>!a.href.includes('/v0.4.0/'+prefix+'-')))throw new Error('Wrong asset prefix')}
  else{await page.webContents.executeJavaScript(`document.querySelector('.download-link').click()`);if(!await page.webContents.executeJavaScript(`document.getElementById('release-status').textContent.includes('尚无')`))throw new Error('Disabled download feedback')}
  console.log('DOWNLOAD_OK',mode);
 }
 mode='current';for(const [name,width,height] of [['desktop',1440,1080],['mobile',390,844],['narrow',320,740]]){page.setSize(width,height);await page.loadURL(base);await page.webContents.executeJavaScript('document.fonts.ready');await new Promise(r=>setTimeout(r,250));
 const result=await page.webContents.executeJavaScript(`({overflow:document.documentElement.scrollWidth>innerWidth,tagline:document.querySelector('h1').innerText.replace(/\\s/g,''),privacy:!!document.querySelector('a[href="privacy.html"]')})`);if(result.overflow||!result.privacy||result.tagline!=='让个人数据属于你自己')throw new Error(name+' layout '+JSON.stringify(result));writeFileSync(`.local/site-${name}.png`,(await page.webContents.capturePage()).toPNG());console.log('LAYOUT_OK',name,'Personal Memory, tagline, no overflow');}
 if(errors.length)throw new Error(errors.join(', '));await page.loadURL(base+'privacy.html');if(!await page.webContents.executeJavaScript(`document.title.includes('Personal Memory')`))throw new Error('Privacy brand');page.destroy();server.close();app.quit();
}).catch(e=>{console.error('::error::'+e.message);server?.close();app.exit(1)});
app.on('will-quit',()=>rmSync(root,{recursive:true,force:true}));
