// Diagnose the previously published artifact without executing it or changing its signature.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const arch=process.argv[2];if(!['arm64','x64'].includes(arch))throw new Error('Invalid architecture');
const root=await mkdtemp(join(tmpdir(),'pm-old-signature-'));
try{
 const base='https://github.com/JackZhong1998/personal-memory/releases/download/v0.5.1/',name=`Personal-Memory-mac-${arch}.zip`;
 const get=async file=>{const r=await fetch(base+file);if(!r.ok)throw new Error('Previous artifact fetch failed: '+r.status);return Buffer.from(await r.arrayBuffer())};
 const manifest=(await get('SHA256SUMS.txt')).toString();const expected=manifest.split('\n').map(line=>line.trim().split(/\s+/)).find(row=>row[1]===name)?.[0];
 const data=await get(name);if(!expected||createHash('sha256').update(data).digest('hex')!==expected)throw new Error('Previous release checksum mismatch');
 await writeFile(join(root,'old.zip'),data);execFileSync('ditto',['-x','-k',join(root,'old.zip'),join(root,'extracted')]);
 const app=join(root,'extracted/Personal Memory.app');const result=spawnSync('codesign',['--verify','--deep','--strict','--verbose=2',app],{encoding:'utf8'});
 console.log('PREVIOUS_RELEASE_SIGNATURE_VALID='+String(result.status===0));
 const detail=(result.stderr||result.error?.message||'').replaceAll(root,'<temporary>').slice(0,2000);console.log(detail);
 console.log('::notice::Previous v0.5.1 signature '+(result.status===0?'valid; Gatekeeper/notarization still separate':'invalid: '+detail.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A')));
}finally{await rm(root,{recursive:true,force:true})}
