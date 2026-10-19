import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await mkdir('browser-extension',{recursive:true});
for(const file of ['manifest.json','popup.html','options.html','style.css'])await copyFile('extension/'+file,'browser-extension/'+file);
for(const name of ['background','popup','options','content'])await build({entryPoints:[`extension/src/${name}.mjs`],outfile:`browser-extension/${name}.js`,bundle:true,format:name==='content'?'iife':'esm',target:'chrome120'});
await mkdir('release',{recursive:true});
execFileSync('python3',['-c',"import pathlib,zipfile; p=pathlib.Path('browser-extension'); z=zipfile.ZipFile('release/Personal-Memory-browser-extension.zip','w',zipfile.ZIP_DEFLATED); [z.write(f, 'Personal-Memory-browser-extension/'+f.name) for f in sorted(p.iterdir()) if f.is_file()]; z.close()"]);
console.log('Browser extension built: release/Personal-Memory-browser-extension.zip');
