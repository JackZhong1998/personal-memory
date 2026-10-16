import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
for(const file of ['index.html','privacy.html']){const html=readFileSync(`site/${file}`,'utf8');assert.match(html,/<html lang="zh-CN">/);assert.match(html,/name="viewport"/);for(const [,href] of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)){if(/^(https?:|data:)/.test(href))continue;assert.ok(existsSync(`site/${href}`),`Missing ${href}`)}}
const html=readFileSync('site/index.html','utf8');for(const id of ['main','why','how','privacy','download','release-status'])assert.ok(html.includes(`id="${id}"`));
assert.equal((html.match(/class="button (primary|secondary) download-link"/g)||[]).length,2);
const manifest=JSON.parse(readFileSync('site/release.json','utf8'));assert.equal(typeof manifest.available,'boolean');
for(const file of ['site/index.html','site/app.js','site/privacy.html'])assert.ok(!/sk-or-v1-[a-z0-9]{20}/i.test(readFileSync(file,'utf8')),'Secret accidentally embedded');
console.log('Website checks passed: local links, sections, privacy page, release manifest, no embedded key');
