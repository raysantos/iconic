// Copy, cut and paste, and SVG import (files, drag-and-drop, pasted markup).
import { center, moveShape, unionBox, worldBox } from '../geometry';
import { BOOL_LABEL, TYPE_LABEL, type Artboard, type Shape } from '../model';
import { activeArtboard, allShapes, artboards, newArtboard, nextArtboardName, selected, setActiveArtboard, shapes, state } from '../store';
import { exportSvgString } from '../svg';
import { importSvg, svgSize } from '../svgimport';
import { view, edit } from './edit';
import { deleteSelection, withNewIds } from './selection';
import { shapesOn, freeSlot } from './artboards';

// ---- Clipboard ---------------------------------------------------------

export function copy() {
  const sel = selected();
  if (!sel.length) return;
  state.clipboard = structuredClone(sel);
  // Also put SVG on the system clipboard so it pastes into Figma, Illustrator, etc.
  try {
    lastCopiedSvg = exportSvgString(sel, unionBox(sel.map(worldBox)));
    void navigator.clipboard?.writeText(lastCopiedSvg).catch(() => {});
  } catch {
    /* clipboard unavailable */
  }
}

// The SVG we last put on the system clipboard: pasting it back uses the
// internal copy, which keeps boolean groups and instances intact.
export let lastCopiedSvg = '';
export const isOwnCopy = (svg: string) => !!lastCopiedSvg && svg.trim() === lastCopiedSvg.trim();

export function cut() {
  copy();
  deleteSelection();
}

export type PasteMode = 'center' | 'inPlace' | 'front' | 'back';

// Ctrl+V: centre of view · Ctrl+Shift+V: in place · Ctrl+F: in front · Ctrl+B: in back
export function paste(mode: PasteMode) {
  if (!state.clipboard.length) return;
  edit(() => {
    const clones = structuredClone(state.clipboard).map((s) => ({ ...withNewIds(s), locked: false, hidden: false }));
    if (mode === 'center') {
      const b = unionBox(clones.map(worldBox));
      const [vx, vy] = view.center();
      const [cx, cy] = center(b);
      const [dx, dy] = [Math.round(vx - cx), Math.round(vy - cy)];
      for (const s of clones) moveShape(s, structuredClone(s), dx, dy);
    }
    const list = shapes();
    const selIdx = list.map((s, i) => (state.selection.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    let at = list.length;
    if (mode === 'front' && selIdx.length) at = Math.max(...selIdx) + 1;
    if (mode === 'back') at = selIdx.length ? Math.min(...selIdx) : 0;
    list.splice(at, 0, ...clones);
    state.selection = clones.map((s) => s.id);
  });
}

// ---- SVG import ---------------------------------------------------------

export interface ImportReport {
  shapes: number;
  skipped: string[]; // text, images…
  failed: string[]; // files that weren't readable SVG
}

export const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

// Fresh ids, and names like drawn shapes get (Path 3, Exclude 2…).
export function adopt(list: Shape[]): Shape[] {
  const counts = new Map<string, number>();
  const label = (s: Shape) => (s.type === 'boolean' ? BOOL_LABEL[s.op] : TYPE_LABEL[s.type]);
  const named = (s: Shape) => {
    if (s.name) return;
    const key = label(s);
    const n = (counts.get(key) ?? allShapes().filter((x) => x.name?.startsWith(key + ' ')).length) + 1;
    counts.set(key, n);
    s.name = `${key} ${n}`;
  };
  const fresh = list.map(withNewIds);
  for (const s of allShapes(fresh)) named(s);
  return fresh;
}

// Paste SVG code (Figma "Copy as SVG", Illustrator, a web page). An SVG the size
// of the artboard (a whole icon) lines up with it; anything else lands in the
// middle of the view on whole pixels, scaled down if it is far too big.
export function pasteSvg(text: string, mode: PasteMode): ImportReport | null {
  const size = svgSize(text);
  if (!size) return null;
  const ab = activeArtboard();
  let [k, tx, ty] = [1, ab.x, ab.y];
  if (!(near(size.w, ab.w) && near(size.h, ab.h))) {
    if (Math.max(size.w, size.h) > 4 * Math.max(ab.w, ab.h)) k = Math.min(ab.w / size.w, ab.h / size.h);
    const [cx, cy] = mode === 'inPlace' ? center(ab) : view.center();
    [tx, ty] = [Math.round(cx - (size.w * k) / 2), Math.round(cy - (size.h * k) / 2)];
  }
  const r = importSvg(text, { k, tx, ty });
  if (!r) return null;
  if (r.shapes.length) {
    edit(() => {
      const list = adopt(r.shapes);
      const top = shapes();
      const selIdx = top.map((s, i) => (state.selection.includes(s.id) ? i : -1)).filter((i) => i >= 0);
      const at = mode === 'front' && selIdx.length ? Math.max(...selIdx) + 1 : mode === 'back' ? (selIdx.length ? Math.min(...selIdx) : 0) : top.length;
      top.splice(at, 0, ...list);
      state.selection = list.map((s) => s.id);
      state.artboardSelected = false;
    });
  }
  return { shapes: r.shapes.length, skipped: r.skipped, failed: [] };
}

// home_24dp_E8EAED_FILL0_wght400_GRAD0_opsz24.svg -> home
export function iconNameFromFile(file: string) {
  const base = file.replace(/\.svg$/i, '').replace(/_\d+(dp|px)(_.*)?$/i, '');
  return base.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || nextArtboardName();
}

// Import SVG files: each becomes its own artboard, named from the file. A single
// file goes onto the active artboard when that artboard is still empty.
export function importSvgFiles(files: { name: string; text: string }[]): ImportReport {
  const report: ImportReport = { shapes: 0, skipped: [], failed: [] };
  const ready = files.map((f) => ({ ...f, size: svgSize(f.text) })).filter((f) => f.size || void report.failed.push(f.name));
  if (!ready.length) return report;
  const active = activeArtboard();
  const max = Math.max(active.w, active.h);
  const reuse = ready.length === 1 && !shapesOn(active).length && !active.masterOf && !active.variations;
  edit(() => {
    const added: Shape[] = [];
    for (const f of ready) {
      const size = f.size!;
      // Huge viewBoxes (e.g. Material's 960 grid with no width/height) fit the icon size.
      const k = Math.max(size.w, size.h) > 4 * max ? max / Math.max(size.w, size.h) : 1;
      const [w, h] = [Math.max(1, Math.round(size.w * k)), Math.max(1, Math.round(size.h * k))];
      let ab: Artboard;
      if (reuse) {
        ab = active;
        Object.assign(ab, { w, h });
        if (/^icon_\d+$/.test(ab.name)) ab.name = iconNameFromFile(f.name);
      } else {
        const [x, y] = freeSlot(w, h);
        ab = { ...newArtboard(iconNameFromFile(f.name), x, y, w), h };
        artboards().push(ab);
      }
      const r = importSvg(f.text, { k, tx: ab.x + (w - size.w * k) / 2, ty: ab.y + (h - size.h * k) / 2 });
      if (!r) continue;
      const list = adopt(r.shapes);
      shapes().push(...list);
      added.push(...list);
      report.shapes += list.length;
      for (const s of r.skipped) if (!report.skipped.includes(s)) report.skipped.push(s);
      setActiveArtboard(ab.id);
    }
    state.selection = ready.length === 1 ? added.map((s) => s.id) : [];
  });
  return report;
}
