// Editing commands shared by keyboard shortcuts, menus and panels.
import { bbox, center, moveShape, rotate, scaleShape, unionBox, worldBox } from './geometry';
import type { Box, Pt, Shape, Style } from './model';
import { checkpoint, commit, emit, newId, savePrefs, selected, shapes, state } from './store';
import { exportSvgString } from './svg';

// Set by the canvas so paste lands in the middle of what you're looking at.
export const view = { center: (): Pt => [state.doc.size / 2, state.doc.size / 2] };

const editable = () => selected().filter((s) => !s.locked);

// Live edits (scrubbing a field, dragging the color picker) redraw without
// touching history; the caller checkpoints once at the start and commits at the end.
interface EditOpts {
  live?: boolean;
}

function edit(fn: () => void, opts: EditOpts = {}) {
  if (opts.live) {
    fn();
    return emit('live');
  }
  checkpoint();
  fn();
  commit();
}

// ---- Selection ---------------------------------------------------------

export function selectAll() {
  state.selection = shapes()
    .filter((s) => !s.hidden && !s.locked)
    .map((s) => s.id);
  commit();
}

export function deselect() {
  state.selection = [];
  commit();
}

export function deleteSelection() {
  if (!state.selection.length) return;
  edit(() => {
    state.doc.shapes = shapes().filter((s) => !state.selection.includes(s.id));
    state.selection = [];
  });
}

// ---- Clipboard ---------------------------------------------------------

export function copy() {
  const sel = selected();
  if (!sel.length) return;
  state.clipboard = structuredClone(sel);
  // Also put SVG on the system clipboard so it pastes into Figma, Illustrator, etc.
  try {
    void navigator.clipboard?.writeText(exportSvgString({ ...state.doc, shapes: sel })).catch(() => {});
  } catch {
    /* clipboard unavailable */
  }
}

export function cut() {
  copy();
  deleteSelection();
}

type PasteMode = 'center' | 'inPlace' | 'front' | 'back';

// Ctrl+V: centre of view · Ctrl+Shift+V: in place · Ctrl+F: in front · Ctrl+B: in back
export function paste(mode: PasteMode) {
  if (!state.clipboard.length) return;
  edit(() => {
    const clones = structuredClone(state.clipboard).map((s) => ({ ...s, id: newId(), locked: false, hidden: false }));
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

export function duplicateSelection(dx = 0, dy = 0): Shape[] {
  const list = shapes();
  const clones: Shape[] = [];
  for (const s of editable()) {
    const c = { ...structuredClone(s), id: newId() };
    moveShape(c, structuredClone(c), dx, dy);
    list.splice(list.indexOf(s) + 1 + clones.length, 0, c);
    clones.push(c);
  }
  return clones;
}

// Ctrl+D: repeat the last move (and copy, if it was an Alt-drag duplicate).
export function transformAgain() {
  const t = state.lastTransform;
  if (!t || !state.selection.length) return;
  edit(() => {
    if (t.copy) state.selection = duplicateSelection(t.dx, t.dy).map((s) => s.id);
    else for (const s of editable()) moveShape(s, structuredClone(s), t.dx, t.dy);
  });
}

export function nudge(dx: number, dy: number) {
  const sel = editable();
  if (!sel.length) return;
  edit(() => sel.forEach((s) => moveShape(s, structuredClone(s), dx, dy)));
  state.lastTransform = { dx, dy, copy: false };
}

// ---- Arrange -----------------------------------------------------------

export function arrange(how: 'forward' | 'backward' | 'front' | 'back') {
  if (!state.selection.length) return;
  edit(() => {
    const list = shapes();
    const sel = (s: Shape) => state.selection.includes(s.id);
    if (how === 'front') state.doc.shapes = [...list.filter((s) => !sel(s)), ...list.filter(sel)];
    else if (how === 'back') state.doc.shapes = [...list.filter(sel), ...list.filter((s) => !sel(s))];
    else if (how === 'forward') {
      for (let i = list.length - 2; i >= 0; i--) if (sel(list[i]) && !sel(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else {
      for (let i = 1; i < list.length; i++) if (sel(list[i]) && !sel(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
  });
}

// ---- Lock & hide (Ctrl+2 / Ctrl+3, with Alt to undo for everything) ----

export function lockSelection() {
  if (!state.selection.length) return;
  edit(() => {
    selected().forEach((s) => (s.locked = true));
    state.selection = [];
  });
}

export function unlockAll() {
  const locked = shapes().filter((s) => s.locked);
  if (!locked.length) return;
  edit(() => {
    locked.forEach((s) => (s.locked = false));
    state.selection = locked.map((s) => s.id);
  });
}

export function hideSelection() {
  if (!state.selection.length) return;
  edit(() => {
    selected().forEach((s) => (s.hidden = true));
    state.selection = [];
  });
}

export function showAll() {
  const hidden = shapes().filter((s) => s.hidden);
  if (!hidden.length) return;
  edit(() => {
    hidden.forEach((s) => (s.hidden = false));
    state.selection = hidden.map((s) => s.id);
  });
}

// ---- Color (Illustrator: D, X, Shift+X, /) -------------------------------

// Edits the current style and the selection together, so new shapes match.
export function setStyle(patch: Partial<Style>, opts: EditOpts = {}) {
  Object.assign(state.prefs.style, patch);
  savePrefs();
  const sel = editable();
  if (!sel.length) return opts.live ? emit('live') : commit();
  edit(() => sel.forEach((s) => Object.assign(s, patch)), opts);
}

export const defaultColors = () => setStyle({ fill: '#FFFFFF', stroke: '#000000', strokeWidth: 1 });

export function toggleFocus() {
  state.focus = state.focus === 'fill' ? 'stroke' : 'fill';
  commit();
}

export function swapFillStroke() {
  const s = editable()[0] ?? state.prefs.style;
  const fill = s.strokeWidth > 0 ? s.stroke : 'none';
  const stroke = s.fill;
  setStyle(stroke === 'none' ? { fill, strokeWidth: 0 } : { fill, stroke, strokeWidth: s.strokeWidth || 1 });
}

export function setNone() {
  setStyle(state.focus === 'fill' ? { fill: 'none' } : { strokeWidth: 0 });
}

// ---- Geometry (Design panel and resize handles) -------------------------

// Scale shapes from box `from` to box `to`. Rotated shapes keep their
// rotation: their center moves with the box and their own size scales.
export function scaleShapes(list: Shape[], originals: Shape[], from: Box, to: Box) {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  list.forEach((s, i) => {
    const o = originals[i];
    if (!o.rotation) return scaleShape(s, o, from, to);
    const b = bbox(o);
    const [cx, cy] = center(b);
    const [nx, ny] = [to.x + (cx - from.x) * sx, to.y + (cy - from.y) * sy];
    const [w, h] = [b.w * sx, b.h * sy];
    scaleShape(s, o, b, { x: nx - w / 2, y: ny - h / 2, w, h });
  });
}

// Rotate shapes as a group around `pivot`.
export function rotateShapes(list: Shape[], originals: Shape[], deg: number, pivot: Pt) {
  list.forEach((s, i) => {
    const o = originals[i];
    const c = center(bbox(o));
    const [nx, ny] = rotate(c, deg, pivot);
    moveShape(s, o, nx - c[0], ny - c[1]);
    s.rotation = (((o.rotation ?? 0) + deg) % 360 + 360) % 360;
  });
}

// Bounds shown in the Design panel: the shape's own box for a single
// selection (like Figma), otherwise the selection's bounds.
export function selectionBox(list = selected()): Box | null {
  if (!list.length) return null;
  return list.length === 1 ? bbox(list[0]) : unionBox(list.map(worldBox));
}

export type GeoField = 'x' | 'y' | 'w' | 'h' | 'rotation';

export function setGeometry(field: GeoField, value: number, opts: EditOpts = {}) {
  const list = editable();
  const box = selectionBox(list);
  if (!box || !Number.isFinite(value)) return;
  edit(() => {
    const originals = structuredClone(list);
    if (field === 'rotation') {
      const current = list.length === 1 ? (list[0].rotation ?? 0) : 0;
      rotateShapes(list, originals, value - current, center(box));
    } else if (field === 'x' || field === 'y') {
      const d = value - box[field];
      list.forEach((s, i) => moveShape(s, originals[i], field === 'x' ? d : 0, field === 'y' ? d : 0));
    } else {
      const to = { ...box, [field]: Math.max(0.01, value) };
      if (list.length === 1) scaleShape(list[0], originals[0], box, to);
      else scaleShapes(list, originals, box, to);
    }
  }, opts);
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

// One shape aligns to the artboard; several align to their combined bounds.
export function align(how: Align) {
  const list = editable();
  if (!list.length) return;
  const size = state.doc.size;
  const target = list.length === 1 ? { x: 0, y: 0, w: size, h: size } : unionBox(list.map(worldBox));
  edit(() => {
    for (const s of list) {
      const b = worldBox(s);
      let [dx, dy] = [0, 0];
      if (how === 'left') dx = target.x - b.x;
      if (how === 'hcenter') dx = target.x + target.w / 2 - (b.x + b.w / 2);
      if (how === 'right') dx = target.x + target.w - (b.x + b.w);
      if (how === 'top') dy = target.y - b.y;
      if (how === 'vcenter') dy = target.y + target.h / 2 - (b.y + b.h / 2);
      if (how === 'bottom') dy = target.y + target.h - (b.y + b.h);
      moveShape(s, structuredClone(s), dx, dy);
    }
  });
}

// ---- Document ----------------------------------------------------------

// Changing size scales the artwork (including strokes) so the icon looks the same.
export function setArtboardSize(next: number) {
  const size = state.doc.size;
  if (next === size) return;
  edit(() => {
    const from: Box = { x: 0, y: 0, w: size, h: size };
    const to: Box = { x: 0, y: 0, w: next, h: next };
    for (const s of shapes()) {
      scaleShape(s, structuredClone(s), from, to);
      s.strokeWidth *= next / size;
    }
    state.doc.size = next;
  });
}

export function renameDoc(name: string) {
  const clean = name.trim() || 'Untitled';
  if (clean === state.doc.name) return;
  edit(() => (state.doc.name = clean));
}

export function newDoc() {
  if (shapes().length && !confirm('Start a new icon? You can undo this.')) return;
  edit(() => {
    state.doc = { name: 'Untitled', size: state.doc.size, shapes: [] };
    state.selection = [];
  });
}
