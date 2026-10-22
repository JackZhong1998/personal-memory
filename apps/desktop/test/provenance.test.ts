import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceStats,memoryProviders,fromPlatform} from '../src/provenance';
import {existing,prompt} from './fixtures';
import {builtins} from '../electron/platform';
import type {Trace} from '../electron/types';
test('Source statistics separate platforms even when conversation IDs or titles overlap',()=>{
 const traces:Trace[]=[{id:'codex:same',provider:'codex',title:'same',count:4,updatedAt:''},{id:'claude:same',provider:'claude',title:'same',count:3,updatedAt:''},{id:'codex:another',provider:'codex',title:'another',count:2,updatedAt:''}];
 assert.deepEqual(sourceStats(traces),builtins.map(provider=>({provider,conversations:traces.filter(t=>t.provider===provider).length,prompts:traces.filter(t=>t.provider===provider).reduce((n,t)=>n+t.count,0)})));
 assert.equal(sourceStats(traces).find(s=>s.provider==='doubao')?.prompts,0);
});
test('Cross-platform memories retain all distinct evidence sources and match either filter',()=>{
 const memory=existing({evidence:[prompt(),{...prompt(),provider:'claude'},{...prompt(),provider:'codex'}]});
 assert.deepEqual(memoryProviders(memory),['codex','claude']);assert.equal(fromPlatform(memory,'codex'),true);assert.equal(fromPlatform(memory,'claude'),true);assert.equal(fromPlatform(memory,'grok'),false);
});
test('Missing provenance is explicitly unknown; model or claim names do not establish origin',()=>{
 const memory=existing({evidence:undefined,model:'deepseek/deepseek-v4-flash',claim:'用户讨论 Claude 和 Codex'});
 assert.deepEqual(memoryProviders(memory),[]);assert.equal(fromPlatform(memory,'codex'),false);assert.equal(fromPlatform(memory,'claude'),false);assert.equal(fromPlatform(memory,'all'),true);
});
