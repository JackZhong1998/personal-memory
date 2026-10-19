// Format/size exports from the image-generated logo master. No redesign during builds.
const {app,nativeImage,BrowserWindow}=require('electron');const {readFileSync,writeFileSync}=require('node:fs');const {resolve,join}=require('node:path');
app.disableHardwareAcceleration();const root=resolve('assets/brand');
app.whenReady().then(async()=>{
 const master=nativeImage.createFromPath(join(root,'logo-master.png'));if(master.isEmpty())throw new Error('Missing logo master');
 const png=size=>master.resize({width:size,height:size,quality:'best'}).toPNG();
 for(const size of [16,32,48,128,180,256,512])writeFileSync(join(root,`icon-${size}.png`),png(size));writeFileSync(join(root,'icon.png'),png(1024));
 const chunks=[['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]].map(([type,size])=>{const data=png(size),header=Buffer.alloc(8);header.write(type,0,4,'ascii');header.writeUInt32BE(data.length+8,4);return Buffer.concat([header,data])});const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((n,b)=>n+b.length,0),4);writeFileSync(join(root,'icon.icns'),Buffer.concat([header,...chunks]));
 const page=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});await page.loadURL('about:blank');const svg=readFileSync(join(root,'mark.svg'),'utf8');
 for(const [size,name] of [[22,'trayTemplate.png'],[44,'trayTemplate@2x.png']]){const data=await page.webContents.executeJavaScript(`(async()=>{const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(${JSON.stringify(svg)});await img.decode();const canvas=document.createElement('canvas');canvas.width=${size};canvas.height=${size};canvas.getContext('2d').drawImage(img,0,0,${size},${size});return canvas.toDataURL('image/png')})()`);writeFileSync(join(root,name),Buffer.from(data.split(',')[1],'base64'))}
 page.destroy();console.log('BRAND_EXPORTS_OK: PNG sizes 16–1024, ICNS, transparent menu-bar template');app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
