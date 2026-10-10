// Figma-style color picker: saturation/value area, hue slider, Hex/RGB/HSL
// inputs, eyedropper, document colors and a Material palette.

type HSV = { h: number; s: number; v: number }; // h 0-360, s/v 0-1
type RGB = [number, number, number];

// Material icon colors plus Google / Material 3 essentials.
const MATERIAL: [string, string][] = [
  ['#000000', 'Icon black'],
  ['#1F1F1F', 'On surface'],
  ['#444746', 'On surface variant'],
  ['#5F6368', 'Grey 700'],
  ['#9AA0A6', 'Grey 500'],
  ['#FFFFFF', 'White'],
  ['#1A73E8', 'Google Blue'],
  ['#D93025', 'Google Red'],
  ['#F9AB00', 'Google Yellow'],
  ['#1E8E3E', 'Google Green'],
  ['#6750A4', 'M3 Primary'],
  ['#B3261E', 'M3 Error'],
];

// ---- Color math --------------------------------------------------------------

export function hexToRgb(hex: string): RGB | null {
  let s = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = [...s].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}

const rgbToHex = (rgb: RGB) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgbToHsv([r, g, b]: RGB): HSV {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const { h } = rgbToHsv([r * 255, g * 255, b * 255]);
  return [h, s * 100, l * 100];
}

function hslToRgb([h, s, l]: [number, number, number]): RGB {
  [s, l] = [s / 100, l / 100];
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- Picker ---------------------------------------------------------------------

export interface PickerOptions {
  title: string;
  color: string;
  documentColors: string[];
  onInput: (hex: string) => void; // live, while dragging or typing
  onClose: () => void; // commit
}

type Mode = 'hex' | 'rgb' | 'hsl';
let current: { close: () => void } | null = null;
let mode: Mode = 'hex';

export function closeColorPicker() {
  current?.close();
}

export function openColorPicker(anchor: HTMLElement, opts: PickerOptions) {
  closeColorPicker();
  let hsv = rgbToHsv(hexToRgb(opts.color) ?? [0, 0, 0]);
  const hex = () => rgbToHex(hsvToRgb(hsv));

  const root = document.createElement('div');
  root.className = 'color-picker';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `${opts.title} color`);
  root.innerHTML = `
    <div class="cp-head"><span>${opts.title}</span><button class="cp-close" aria-label="Close">×</button></div>
    <div class="cp-area" role="slider" tabindex="0" aria-label="Saturation and brightness"><div class="cp-thumb"></div></div>
    <div class="cp-row">
      <button class="cp-eyedropper" title="Pick a color from the screen" aria-label="Eyedropper">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m14 7 3 3M5 19l1-4 9-9a2.1 2.1 0 0 1 3 3l-9 9z"/><path d="M15 4l5 5"/></svg>
      </button>
      <div class="cp-hue" role="slider" tabindex="0" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"><div class="cp-thumb"></div></div>
    </div>
    <div class="cp-inputs">
      <select class="cp-mode" aria-label="Color format"><option value="hex">Hex</option><option value="rgb">RGB</option><option value="hsl">HSL</option></select>
      <div class="cp-fields"></div>
    </div>
    <div class="cp-swatches"></div>`;
  document.body.append(root);

  const area = root.querySelector<HTMLElement>('.cp-area')!;
  const areaThumb = area.querySelector<HTMLElement>('.cp-thumb')!;
  const hue = root.querySelector<HTMLElement>('.cp-hue')!;
  const hueThumb = hue.querySelector<HTMLElement>('.cp-thumb')!;
  const fields = root.querySelector<HTMLElement>('.cp-fields')!;
  const modeSel = root.querySelector<HTMLSelectElement>('.cp-mode')!;
  modeSel.value = mode;

  // ---- Rendering
  function paint(skipFields = false) {
    const pure = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
    area.style.setProperty('--hue', pure);
    areaThumb.style.left = `${hsv.s * 100}%`;
    areaThumb.style.top = `${(1 - hsv.v) * 100}%`;
    areaThumb.style.background = hex();
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    hueThumb.style.background = pure;
    area.setAttribute('aria-valuetext', `saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
    hue.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    if (!skipFields) renderFields();
    root.querySelectorAll<HTMLElement>('.cp-swatch').forEach((s) => s.classList.toggle('on', s.dataset.color === hex()));
  }

  function renderFields() {
    const rgb = hsvToRgb(hsv);
    if (mode === 'hex') {
      fields.innerHTML = `<input class="cp-field wide" value="${hex().slice(1)}" aria-label="Hex" spellcheck="false" maxlength="7">`;
    } else {
      const vals = mode === 'rgb' ? rgb.map(Math.round) : rgbToHsl(rgb).map(Math.round);
      const labels = mode === 'rgb' ? ['R', 'G', 'B'] : ['H', 'S', 'L'];
      fields.innerHTML = vals.map((v, i) => `<input class="cp-field" inputmode="numeric" value="${v}" aria-label="${labels[i]}" title="${labels[i]}">`).join('');
    }
  }

  function set(next: HSV, skipFields = false) {
    hsv = next;
    paint(skipFields);
    opts.onInput(hex());
  }

  // ---- Dragging (mouse, touch, pen)
  function drag(el: HTMLElement, onPoint: (x: number, y: number) => void) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone; dragging still works while over the control */
      }
      el.focus();
      const at = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        onPoint(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
      };
      at(e);
      const move = (ev: PointerEvent) => at(ev);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }
  drag(area, (x, y) => set({ ...hsv, s: x, v: 1 - y }));
  drag(hue, (x) => set({ ...hsv, h: x * 360 }));

  // ---- Keyboard: arrows nudge (Shift = bigger steps)
  area.addEventListener('keydown', (e) => {
    const k = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] }[e.key];
    if (!d) return;
    e.preventDefault();
    set({ ...hsv, s: clamp(hsv.s + d[0], 0, 1), v: clamp(hsv.v + d[1], 0, 1) });
  });
  hue.addEventListener('keydown', (e) => {
    const k = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: -k, ArrowRight: k, ArrowDown: -k, ArrowUp: k }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    set({ ...hsv, h: (hsv.h + d + 360) % 360 });
  });

  // ---- Inputs
  modeSel.addEventListener('change', () => {
    mode = modeSel.value as Mode;
    renderFields();
  });
  fields.addEventListener('change', () => {
    const inputs = [...fields.querySelectorAll<HTMLInputElement>('input')];
    let rgb: RGB | null = null;
    if (mode === 'hex') rgb = hexToRgb(inputs[0].value);
    else {
      const n = inputs.map((i) => Number(i.value));
      if (n.every(Number.isFinite)) {
        rgb = mode === 'rgb' ? (n.map((v) => clamp(v, 0, 255)) as RGB) : hslToRgb([clamp(n[0], 0, 360), clamp(n[1], 0, 100), clamp(n[2], 0, 100)]);
      }
    }
    if (rgb) set(rgbToHsv(rgb));
    else renderFields();
  });
  fields.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  });
  fields.addEventListener('focusin', (e) => (e.target as HTMLInputElement).select());

  // ---- Eyedropper (Chrome/Edge)
  const dropper = root.querySelector<HTMLButtonElement>('.cp-eyedropper')!;
  const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
  if (!EyeDropperCtor) dropper.hidden = true;
  dropper.addEventListener('click', async () => {
    try {
      const { sRGBHex } = await new EyeDropperCtor!().open();
      const rgb = hexToRgb(sRGBHex);
      if (rgb) set(rgbToHsv(rgb));
    } catch {
      /* cancelled */
    }
  });

  // ---- Swatches
  const sw = root.querySelector<HTMLElement>('.cp-swatches')!;
  const group = (label: string, colors: [string, string][]) => {
    if (!colors.length) return '';
    return `<div class="cp-sw-label">${label}</div><div class="cp-sw-grid">${colors
      .map(([c, name]) => `<button class="cp-swatch" data-color="${c}" style="--c:${c}" title="${name} ${c}" aria-label="${name} ${c}"></button>`)
      .join('')}</div>`;
  };
  const docColors = [...new Set(opts.documentColors.map((c) => c.toUpperCase()))].filter((c) => hexToRgb(c)).slice(0, 16);
  sw.innerHTML = group('On this page', docColors.map((c) => [c, 'Used'])) + group('Material', MATERIAL);
  sw.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.cp-swatch')?.dataset.color;
    const rgb = c && hexToRgb(c);
    if (rgb) set(rgbToHsv(rgb));
  });

  // ---- Placement: beside the Design panel (Figma), or a bottom sheet on phones
  const r = anchor.getBoundingClientRect();
  const panel = anchor.closest('.panel')?.getBoundingClientRect();
  if (innerWidth < 768) root.classList.add('sheet');
  else {
    const w = root.offsetWidth;
    const left = panel ? panel.left - w - 8 : r.left;
    root.style.left = `${clamp(left, 8, innerWidth - w - 8)}px`;
    root.style.top = `${clamp(r.top - 40, 56, innerHeight - root.offsetHeight - 8)}px`;
  }

  // ---- Closing
  const onDown = (e: PointerEvent) => {
    if (!root.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  function close() {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    current = null;
    opts.onClose();
  }
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  root.querySelector('.cp-close')!.addEventListener('click', close);
  current = { close };

  paint();
  area.focus({ preventScroll: true });
}
