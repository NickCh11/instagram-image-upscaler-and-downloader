import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(new URL('../public/', import.meta.url), dist, { recursive: true });
await cp(new URL('../node_modules/@websr/websr/LICENSE', import.meta.url), new URL('./WEBSR-LICENSE', dist));

for (const entry of ['content', 'background', 'options']) {
  await build({
    entryPoints: [fileURLToPath(new URL(`../src/${entry}.js`, import.meta.url))],
    outfile: fileURLToPath(new URL(`./${entry}.js`, dist)),
    bundle: true,
    format: 'iife',
    target: 'firefox120',
    legalComments: 'none',
    minify: true
  });
}

console.log(`Built Firefox add-on in ${dist.pathname}`);
