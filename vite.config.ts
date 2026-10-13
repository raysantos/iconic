import { defineConfig } from 'vite';
import pkg from './package.json';

// GitHub Pages serves the app from /iconic/; local dev serves it from /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/iconic/' : '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
}));
