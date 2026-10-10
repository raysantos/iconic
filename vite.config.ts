import { defineConfig } from 'vite';

// GitHub Pages serves the app from /iconic/; local dev serves it from /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/iconic/' : '/',
}));
