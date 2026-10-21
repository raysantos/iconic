// Tablet mode, for pen displays without a keyboard (e.g. Wacom Movink Pad):
// on-screen Shift / Alt / Hand keys, Undo / Redo buttons, and a tool wheel
// that the pen's side button opens. The canvas handles pen-vs-finger input.
import { icon } from './icons';
import type { Tool } from './model';
import { redo, savePrefs, state, subscribe, undo } from './store';

// On-screen modifiers: tap to latch on (tap again for off), or hold while you
// drag with the pen. They count as if the key were held down.
export const mods = { shift: false, alt: false, hand: false };
export const shiftOn = (e: { shiftKey: boolean }) => e.shiftKey || mods.shift;
export const altOn = (e: { altKey: boolean }) => e.altKey || mods.alt;

interface Hooks {
  setTool: (t: Tool) => void;
  setHand: (on: boolean) => void;
  toast: (msg: string) => void;
}
let hooks: Hooks;

const bar = document.createElement('div');
bar.className = 'tablet-bar';
bar.setAttribute('role', 'toolbar');
bar.setAttribute('aria-label', 'Tablet keys');

const KEYS: { key: 'shift' | 'alt' | 'hand'; label: string; title: string }[] = [
  { key: 'shift', label: 'Shift', title: 'Shift: straight lines, 45°, squares, keep proportions' },
  { key: 'alt', label: 'Alt', title: 'Alt: duplicate while moving, draw from center, break handles' },
  { key: 'hand', label: icon('hand', 20), title: 'Hand: drag with the pen to pan' },
];

function buildBar() {
  bar.innerHTML = `
    <button class="tk" data-act="undo" title="Undo">${icon('undo', 20)}</button>
    <button class="tk" data-act="redo" title="Redo">${icon('redo', 20)}</button>
    <span class="tk-sep"></span>
    ${KEYS.map((k) => `<button class="tk tk-mod" data-mod="${k.key}" title="${k.title}" aria-pressed="false">${k.label}</button>`).join('')}`;

  bar.querySelector('[data-act="undo"]')!.addEventListener('click', undo);
  bar.querySelector('[data-act="redo"]')!.addEventListener('click', redo);

  for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-mod]')) {
    const key = b.dataset.mod as keyof typeof mods;
    let downAt = 0;
    let wasOn = false;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      downAt = e.timeStamp;
      wasOn = mods[key];
      setMod(key, true);
    });
    const up = (e: PointerEvent) => {
      if (!downAt) return;
      const held = e.timeStamp - downAt > 350;
      downAt = 0;
      // A quick tap toggles; a long hold was momentary.
      setMod(key, held ? false : !wasOn);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
}

function setMod(key: keyof typeof mods, on: boolean) {
  mods[key] = on;
  if (key === 'hand') hooks.setHand(on);
  bar.querySelector(`[data-mod="${key}"]`)?.setAttribute('aria-pressed', String(on));
}

export function releaseMods() {
  (Object.keys(mods) as (keyof typeof mods)[]).forEach((k) => mods[k] && setMod(k, false));
}

function sync() {
  const on = !!state.prefs.tabletMode;
  document.body.classList.toggle('tablet', on);
  if (!on) releaseMods();
}

export function setTabletMode(on: boolean, announce = true) {
  state.prefs.tabletMode = on;
  savePrefs();
  sync();
  if (announce) hooks.toast(on ? 'Tablet mode on — the pen draws, fingers pan and zoom' : 'Tablet mode off');
}

export const notify = (msg: string) => hooks?.toast(msg);

// The first time a pen touches the canvas, switch tablet mode on (once).
export function penSeen() {
  if (state.prefs.tabletMode === null) setTabletMode(true);
}

// ---- Tool wheel (pen side button) --------------------------------------------

const WHEEL: Tool[] = ['select', 'direct', 'pen', 'pencil', 'rect', 'ellipse', 'line', 'artboard'];
const WHEEL_LABEL: Partial<Record<Tool, string>> = {
  select: 'Selection',
  direct: 'Direct Selection',
  pen: 'Pen',
  pencil: 'Pencil',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  artboard: 'Artboard',
};
const wheel = document.createElement('div');
wheel.className = 'tool-wheel';
wheel.setAttribute('role', 'menu');
const R = 66; // ring radius, px

export function openToolWheel(x: number, y: number) {
  // Keep the whole wheel on screen near the edges.
  const pad = R + 30;
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  if (w > pad * 2) x = Math.min(w - pad, Math.max(pad, x));
  if (h > pad * 2) y = Math.min(h - pad, Math.max(pad, y));
  wheel.style.left = `${x}px`;
  wheel.style.top = `${y}px`;
  wheel.innerHTML =
    WHEEL.map((t, i) => {
      const a = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2;
      return `<button class="tw-btn" role="menuitem" data-tool="${t}" title="${WHEEL_LABEL[t]}" aria-pressed="${state.tool === t}"
        style="left:${Math.cos(a) * R}px;top:${Math.sin(a) * R}px">${icon(t, 20)}</button>`;
    }).join('') + `<button class="tw-btn tw-close" title="Close">${icon('close', 16)}</button>`;
  wheel.classList.add('show');
}

export const wheelOpen = () => wheel.classList.contains('show');
export const closeToolWheel = () => wheel.classList.remove('show');

wheel.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const t = (e.target as Element).closest<HTMLElement>('[data-tool]')?.dataset.tool as Tool | undefined;
  if (t) hooks.setTool(t);
  closeToolWheel();
});
document.addEventListener('pointerdown', (e) => wheelOpen() && !wheel.contains(e.target as Node) && closeToolWheel(), true);
// Esc closes the wheel and stops there (it doesn't also deselect).
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !wheelOpen()) return;
    closeToolWheel();
    e.stopPropagation();
  },
  true,
);

export function installTablet(h: Hooks) {
  hooks = h;
  buildBar();
  document.querySelector('.viewport')!.append(bar);
  document.body.append(wheel);
  sync();
  subscribe(() => sync());
}
