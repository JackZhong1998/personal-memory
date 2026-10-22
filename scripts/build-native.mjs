import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
if(process.platform==='darwin'){
 mkdirSync('dist-native',{recursive:true});
 try{execFileSync('xcrun',['swiftc','-O','native/macos/WindowCapture.swift','-framework','AppKit','-framework','ApplicationServices','-o','dist-native/window-capture'],{stdio:'pipe'})}catch(e){const details=String(e.stderr||e.message);console.error(details);for(const line of details.split('\n').filter(s=>s.includes('error:')))console.error('::error::'+line.replaceAll('%','%25').replaceAll('\r','%0D'));process.exit(1)}
 // Launch the built helper, without requesting permission or reading any window.
 const apps=JSON.parse(execFileSync('dist-native/window-capture',['--apps'],{encoding:'utf8',timeout:15000}));
 if(!Array.isArray(apps))throw new Error('Native helper returned invalid application list');
 console.log('NATIVE_CAPTURE_OK: compiled and launched on '+process.arch);
}else console.log('Native window capture: macOS build required; source retained for Mac CI.');
