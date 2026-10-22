import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
for(const [prefix,status] of [['Personal-Memory','adhoc'],['Tracelet','unsigned']])test(`Release staging preserves ${prefix} asset names, ${status} metadata and matching architectures`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'tracelet-release-'));const script=resolve('scripts/prepare-release.mjs');
 try{for(const runner of ['arm64','x64']){const dir=join(root,'artifacts',`mac-${runner}`);await mkdir(dir,{recursive:true});await writeFile(join(dir,'signing-status.txt'),status+'\n');
  for(const arch of ['arm64','x64'])for(const ext of ['dmg','zip'])await writeFile(join(dir,`${prefix}-mac-${arch}.${ext}`),`${runner}:${arch}`);
 }
 const result=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 assert.equal((await readdir(join(root,'publish'))).length,4);
 for(const arch of ['arm64','x64'])assert.equal(await readFile(join(root,'publish',`${prefix}-mac-${arch}.dmg`),'utf8'),`${arch}:${arch}`);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('Release staging fails when an architecture or its metadata is missing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tracelet-release-'));try{const result=spawnSync(process.execPath,[resolve('scripts/prepare-release.mjs')],{cwd:root,encoding:'utf8'});assert.notEqual(result.status,0)}finally{await rm(root,{recursive:true,force:true})}
});
