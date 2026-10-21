import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json';

// Stamps public/sw.js with a content hash and the list of built files, so each
// deploy gets its own offline cache and the app works offline from the first visit.
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sw-manifest',
    apply: 'build',
    configResolved: (c) => void (outDir = c.build.outDir),
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
      const files = walk(outDir)
        .map((f) => relative(outDir, f).replaceAll('\\', '/'))
        .filter((f) => f !== 'sw.js' && f !== 'index.html') // the page is cached as './'
        .sort();
      const hash = createHash('sha256');
      for (const f of [...files, 'index.html']) hash.update(f).update(readFileSync(join(outDir, f)));
      const sw = join(outDir, 'sw.js');
      writeFileSync(
        sw,
        readFileSync(sw, 'utf8')
          .replace("const VERSION = 'dev';", `const VERSION = '${hash.digest('hex').slice(0, 12)}';`)
          .replace('const FILES = [];', `const FILES = ${JSON.stringify(files)};`),
      );
    },
  };
}

// GitHub Pages serves the app from /iconic/ (and so does `vite preview`); local dev serves it from /.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/iconic/' : '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [serviceWorkerManifest()],
}));
