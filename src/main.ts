import './style.css';
import './canvas';
import { initUI } from './ui';

initUI();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
}
