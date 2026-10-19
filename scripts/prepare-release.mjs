import {copyFileSync,existsSync,mkdirSync,readFileSync,statSync} from 'node:fs';
mkdirSync('publish',{recursive:true});
for(const arch of ['arm64','x64']){
 const status=readFileSync(`artifacts/mac-${arch}/signing-status.txt`,'utf8').trim();
 if(!['signed','unsigned'].includes(status))throw new Error(`Invalid signing status for ${arch}`);
 for(const extension of ['dmg','zip']){
  const name=`Tracelet-mac-${arch}.${extension}`;const source=`artifacts/mac-${arch}/${name}`;
  if(statSync(source).size===0)throw new Error(`Empty release asset: ${name}`);
  copyFileSync(source,`publish/${name}`);
 }
}
console.log('Selected one DMG and ZIP from each matching architecture artifact');

const extension='artifacts/mac-arm64/Tracelet-browser-extension.zip';if(existsSync(extension))copyFileSync(extension,'publish/Tracelet-browser-extension.zip');
