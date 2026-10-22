// Validate the files users install, after packaging; keep signature trust separate from integrity.
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const run=(command,args,options={})=>{try{return execFileSync(command,args,{encoding:'utf8',timeout:45000,killSignal:'SIGKILL',...options})}catch(e){const detail=String(e.stderr||e.message).slice(0,3000);console.error('::error::'+detail.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));throw e}};
const arch=process.argv[2];if(process.platform!=='darwin'||!['arm64','x64'].includes(arch))throw new Error('macOS and architecture required');
const {version}=JSON.parse(readFileSync('package.json','utf8'));const root=await mkdtemp(join(tmpdir(),'pm-package-artifacts-'));
const verify=async(app,kind)=>{
 console.log('::notice::Checking '+kind+' packaged signature and startup');
 run('codesign',['--verify','--deep','--strict','--verbose=2',app]);
 run('codesign',['--verify','--strict',join(app,'Contents/Resources/native/window-capture')]);
 const data=await mkdtemp(join(tmpdir(),'personal-memory-package-check-'));
 try{
  // No quarantine removal, ad-hoc re-signing or Gatekeeper override during verification.
  const output=run(join(app,'Contents/MacOS/Personal Memory'),['--package-check','--disable-gpu'],{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,env:{...process.env,PERSONAL_MEMORY_PACKAGE_CHECK_DATA:data}});
  if(!output.includes('PACKAGE_CHECK_OK v'+version))throw new Error('Packaged app did not complete startup check: '+kind);
  console.log(kind+': '+output.trim());
 }finally{await rm(data,{recursive:true,force:true})}
};
let mounted=false;try{
 run('ditto',['-x','-k',resolve(`release/Personal-Memory-mac-${arch}.zip`),join(root,'zip')]);
 await verify(join(root,'zip/Personal Memory.app'),'ZIP');
 const mount=join(root,'mounted');await mkdir(mount);
 run('hdiutil',['attach',resolve(`release/Personal-Memory-mac-${arch}.dmg`),'-readonly','-nobrowse','-mountpoint',mount]);mounted=true;
 await verify(join(mount,'Personal Memory.app'),'DMG');
 console.log('PACKAGED_ARTIFACTS_OK: '+arch+' ZIP and DMG signatures, renderer, SQLite/WASM and native helper');
}finally{if(mounted)run('hdiutil',['detach',join(root,'mounted')]);await rm(root,{recursive:true,force:true})}
