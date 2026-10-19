import {writeFileSync} from 'node:fs';
const repo='JackZhong1998/personal-memory';
const r=await fetch(`https://api.github.com/repos/${repo}/releases/latest`,{headers:{Accept:'application/vnd.github+json',...(process.env.GH_TOKEN?{Authorization:`Bearer ${process.env.GH_TOKEN}`}:{})}});
let manifest={available:false,tag:null,signed:false,assets:[]};
if(r.status!==404){if(!r.ok)throw new Error(`Release lookup failed (${r.status}); refusing to publish stale download status`);const release=await r.json();
 if(!release.draft&&!release.prerelease&&/^v\d+\.\d+\.\d+$/.test(release.tag_name)){
  const assets=release.assets.filter(a=>['Tracelet-mac-arm64.dmg','Tracelet-mac-x64.dmg','SHA256SUMS.txt','Tracelet-browser-extension.zip'].includes(a.name)&&a.size>0).map(a=>({name:a.name,url:a.browser_download_url}));
  manifest={available:['Tracelet-mac-arm64.dmg','Tracelet-mac-x64.dmg','SHA256SUMS.txt'].every(name=>assets.some(a=>a.name===name)),tag:release.tag_name,signed:release.body.includes('SIGNING_STATUS: signed-and-notarized'),assets};
 }
}
writeFileSync('site/release.json',JSON.stringify(manifest,null,2)+'\n');
console.log(manifest.available?`Published download manifest for ${manifest.tag}`:'No complete release yet; downloads stay disabled');
