// Node has no web server for the PathKit wasm, so serve it from node_modules.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const wasm = createRequire(import.meta.url).resolve('pathkit-wasm/bin/pathkit.wasm');
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
  String(input).endsWith('pathkit.wasm')
    ? Promise.resolve(new Response(readFileSync(wasm), { headers: { 'Content-Type': 'application/wasm' } }))
    : realFetch(input, init);
