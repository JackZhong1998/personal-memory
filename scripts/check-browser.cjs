const {app,BrowserWindow}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
app.setPath('userData',join(require('node:os').tmpdir(),'tracelet-browser-check'));
app.whenReady().then(async()=>{
 mkdirSync('.local',{recursive:true});
 const page=new BrowserWindow({width:1440,height:1080,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const errors=[];page.webContents.on('console-message',(_event,...args)=>{const details=args[0];if(details?.level==='error')errors.push(details.message)});
 for(const [name,width,height] of [['desktop',1440,1080],['mobile',390,844]]){
  page.setSize(width,height);await page.loadURL('http://127.0.0.1:8080/');
  await page.webContents.executeJavaScript('document.fonts.ready');await new Promise(r=>setTimeout(r,350));
  const result=await page.webContents.executeJavaScript(`({title:document.title,overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('.download-link')].every(a=>a.getAttribute('aria-disabled')==='true'),privacy:!!document.querySelector('a[href="privacy.html"]')})`);
  if(result.overflow||!result.buttons||!result.privacy)throw new Error(name+' website checks failed: '+JSON.stringify(result));
  await page.webContents.executeJavaScript(`document.querySelector('.download-link').click()`);
  const message=await page.webContents.executeJavaScript(`document.getElementById('release-status').textContent`);if(!message.includes('尚无'))throw new Error('Unavailable download did not give feedback');
  await page.webContents.executeJavaScript('window.scrollTo(0,0)');
  const image=await page.webContents.capturePage();writeFileSync(`.local/site-${name}.png`,image.toPNG());
  console.log('BROWSER_OK:',name,result.title,'no overflow, download availability and feedback verified');
 }
 if(errors.length)throw new Error('Browser console errors: '+errors.join(', '));
 await page.loadURL('http://127.0.0.1:8080/privacy.html');if(!(await page.webContents.executeJavaScript(`document.body.innerText.includes('你的记忆，由你掌握')`)))throw new Error('Privacy page failed');
 page.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
