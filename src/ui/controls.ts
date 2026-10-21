// Design panel building blocks: sections, segmented buttons, color rows, number fields.
import { openColorPicker } from '../colorpicker';
import { icon } from '../icons';
import { pretty } from '../shortcuts';
import { allShapes, checkpoint, commit, discardIfUnchanged } from '../store';
import { h } from './dom';

export function section(title: string, ...kids: Node[]) {
  return h('section', { class: 'd-section' }, h('h3', { class: 'd-title' }, title), ...kids);
}

export function segmented<T extends string | number>(opts: [T, string, string?][], current: T, pick: (v: T) => void) {
  const seg = h('div', { class: 'segmented', role: 'radiogroup' } as Partial<HTMLDivElement>);
  for (const [v, label, title] of opts) {
    const b = h('button', { class: v === current ? 'on' : '', textContent: label, title: title ?? label });
    b.addEventListener('click', () => pick(v));
    seg.append(b);
  }
  return seg;
}

// Segmented control with icons; the name stays available as tooltip and label.
export function iconSegmented<T extends string>(opts: [T, string, string][], current: T, pick: (v: T) => void) {
  const seg = h('div', { class: 'segmented icons', role: 'radiogroup' } as Partial<HTMLDivElement>);
  for (const [v, ic, name] of opts) {
    const b = h('button', { class: v === current ? 'on' : '', title: name, html: icon(ic, 18) });
    b.setAttribute('aria-label', name);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(v === current));
    b.addEventListener('click', () => pick(v));
    seg.append(b);
  }
  return seg;
}

export const labeled = (label: string, control: Node, title = '') => h('div', { class: 'd-row', title }, h('span', { class: 'd-label', textContent: label }), control);

export function toggleRow(label: string, keys: string, on: boolean, run: () => void) {
  const input = h('input', { type: 'checkbox', checked: on, class: 'switch' });
  input.addEventListener('change', run);
  return h('label', { class: 'd-row toggle', title: pretty(keys) }, h('span', { class: 'd-label', textContent: label }), input);
}

// The shared value, or a sentinel that matches no option when mixed.
export const common = <T,>(vals: T[]) => (new Set(vals).size === 1 ? vals[0] : ('' as T));

export function colorRow(value: string | null, apply: (c: string, live: boolean) => void, title = 'Color') {
  const color = value ?? '#888888';
  const swatch = h('button', { class: 'swatch' + (value ? '' : ' mixed'), title: `Edit ${title.toLowerCase()} color` });
  swatch.setAttribute('aria-label', `${title} color ${value ?? 'mixed'}`);
  swatch.style.setProperty('--c', color);
  const hex = h('input', { class: 'hex', value: value ? value.replace('#', '').toUpperCase() : 'Mixed', spellcheck: false, title: 'Hex color' });

  // The picker previews live; the whole visit is one undo step.
  swatch.addEventListener('click', () => {
    let started = false;
    openColorPicker(swatch, {
      title,
      color,
      documentColors: allShapes().flatMap((s) => [s.type !== 'line' ? s.fill : '', s.strokeWidth > 0 ? s.stroke : '']).filter((c) => c && c !== 'none'),
      onInput: (c) => {
        if (!started) {
          checkpoint();
          started = true;
        }
        swatch.style.setProperty('--c', c);
        swatch.classList.remove('mixed');
        hex.value = c.slice(1);
        apply(c, true);
      },
      onClose: () => {
        if (!started) return;
        discardIfUnchanged();
        commit();
      },
    });
  });
  hex.addEventListener('focus', () => hex.select());
  hex.addEventListener('change', () => {
    const c = normalizeHex(hex.value);
    if (c) apply(c, false);
    else hex.value = value ? value.slice(1).toUpperCase() : 'Mixed';
  });
  hex.addEventListener('keydown', (e) => e.key === 'Enter' && hex.blur());
  return h('div', { class: 'color-row' }, swatch, hex);
}

export function normalizeHex(v: string) {
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = [...s].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
}

// ---- Number fields ---------------------------------------------------------

export interface NumOpts {
  label: string; // text or icon HTML
  value: number | null; // null = mixed
  field?: string;
  suffix?: string;
  title?: string;
  min?: number;
  step?: number;
  wide?: boolean;
  onCommit: (v: number) => void;
  onScrub?: (v: number) => void;
}

export const fmt = (v: number, suffix = '') => `${Math.round(v * 100) / 100}${suffix}`;

// Figma-style: drag the label to scrub, arrows to step (Shift ×10), and
// simple math like "12+4" or "*2" in the box.
export function numField(o: NumOpts) {
  const step = o.step ?? 1;
  const input = h('input', { class: 'num-input', inputMode: 'decimal', value: o.value === null ? 'Mixed' : fmt(o.value, o.suffix), spellcheck: false });
  if (o.field) input.dataset.field = o.field;
  if (o.suffix) input.dataset.suffix = o.suffix;
  const label = h('span', { class: 'num-label', html: o.label, title: o.title ?? `Drag to adjust ${o.label}` });
  const wrap = h('label', { class: 'num' + (o.wide ? ' wide' : '') }, label, input);

  const current = () => parseFloat(input.value) || 0;
  const clamp = (v: number) => (o.min !== undefined ? Math.max(o.min, v) : v);
  const commitValue = (v: number) => o.onCommit(clamp(Math.round(v * 100) / 100));

  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => {
    const v = evaluate(input.value, o.value);
    if (v === null) input.value = o.value === null ? 'Mixed' : fmt(o.value, o.suffix);
    else commitValue(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = current() + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      input.value = fmt(clamp(v), o.suffix);
      commitValue(v);
      input.select();
    }
  });

  // Scrub by dragging the label.
  label.addEventListener('pointerdown', (e) => {
    if (o.value === null || !o.onScrub) return;
    e.preventDefault();
    label.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const v0 = o.value;
    checkpoint();
    document.body.classList.add('scrubbing');
    const move = (ev: PointerEvent) => {
      const v = clamp(Math.round((v0 + ((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1)) * 100) / 100);
      input.value = fmt(v, o.suffix);
      o.onScrub!(v);
    };
    const up = () => {
      label.removeEventListener('pointermove', move);
      label.removeEventListener('pointerup', up);
      label.removeEventListener('pointercancel', up);
      document.body.classList.remove('scrubbing');
      discardIfUnchanged();
      commit();
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
    label.addEventListener('pointercancel', up);
  });
  return wrap;
}

// "12", "12+4", "*2" (applies to the current value), "(8+4)/2".
export function evaluate(text: string, current: number | null): number | null {
  let s = text.replace(/[°px\s]/g, '');
  if (/^[*/+]/.test(s) && current !== null) s = current + s;
  if (!/^[\d.+\-*/()]+$/.test(s)) return null;
  try {
    const v = Function(`"use strict"; return (${s})`)();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
