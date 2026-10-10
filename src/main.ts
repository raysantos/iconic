// Roboto Flex, bundled (works offline): weight + optical-size axes.
import '@fontsource-variable/roboto-flex/opsz.css';
import './style.css';
import './canvas';
import { pathOpsReady } from './pathops';
import { emit, state } from './store';
import { initUI } from './ui';

initUI();

// Boolean groups render once Google's geometry engine (WebAssembly) has loaded.
void pathOpsReady.then(() => emit());

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { iconic: { state } });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
}
