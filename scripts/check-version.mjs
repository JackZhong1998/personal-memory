import {readFileSync} from 'node:fs';
const {version}=JSON.parse(readFileSync('package.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Version must be stable semver');
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!==`v${version}`)throw new Error('Git tag does not match package.json');
