import {copyFileSync,existsSync,mkdirSync,readFileSync,statSync} from 'node:fs';
mkdirSync('publish',{recursive:true});
for(const arch of ['arm64','x64']){
 const status=readFileSync(`artifacts/mac-${arch}/signing-status.txt`,'utf8').trim();
 if(!['signed','unsigned','adhoc'].includes(status))throw new Error(`Invalid signing status for ${arch}`);
 for(const extension of ['dmg','zip']){
  const name=['Personal-Memory','Tracelet'].map(prefix=>`${prefix}-mac-${arch}.${extension}`).find(name=>existsSync(`artifacts/mac-${arch}/${name}`));if(!name)throw new Error(`Missing ${arch} ${extension}`);const source=`artifacts/mac-${arch}/${name}`;
  if(statSync(source).size===0)throw new Error(`Empty release asset: ${name}`);
  copyFileSync(source,`publish/${name}`);
 }
}
console.log('Selected one DMG and ZIP from each matching architecture artifact');

for(const name of ['Personal-Memory-browser-extension.zip','Tracelet-browser-extension.zip']){const file='artifacts/mac-arm64/'+name;if(existsSync(file)){copyFileSync(file,'publish/'+name);break}}
