import { build } from 'esbuild';
await build({entryPoints:['apps/desktop/electron/main.ts'],outfile:'dist-electron/main.cjs',bundle:true,platform:'node',format:'cjs',external:['electron','sql.js','chokidar'],target:'node22'});
await build({entryPoints:['apps/desktop/electron/preload.ts'],outfile:'dist-electron/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node22'});

await build({entryPoints:['apps/desktop/electron/browser-host.ts'],outfile:'dist-electron/browser-host.cjs',bundle:true,platform:'node',format:'cjs',target:'node22'});
