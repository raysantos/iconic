// Editing commands shared by keyboard shortcuts, menus and panels.
import { bbox, center, moveShape, rotate, scaleKeepingRotation, scaleShape, toBezier, unionBox, worldBox } from './geometry';
import { auditShape } from './audit';
import { combos, fillIn, interpolate, locSuffix, mastersOf, scaleWhole, snapToGrid } from './masters';
import { BADGES, BADGE_BOX, resolveSource, type BadgeKey } from './components';
import { BOOL_LABEL, ICON_STYLES, TYPE_LABEL, type Artboard, type AxisTag, type BezierShape, type BoolOp, type BooleanShape, type Box, type InstanceShape, type IconStyle, type Pt, type Shape, type Style } from './model';
import { activeArtboard, allShapes, artboardById, artboards, checkpoint, containerOf, commit, emit, inside, newArtboard, newId, nextArtboardName, savePrefs, selected, setActiveArtboard, shapes, state } from './store';
import { exportSvgString } from './svg';
import { importSvg, svgSize } from './svgimport';

// Set by the canvas so paste lands in the middle of what you're looking at.
export const view = { center: (): Pt => center(activeArtboard()) };

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
  state.artboardSelected = false;
  commit();
}

export function deleteSelection() {
  if (!state.selection.length && state.artboardSelected) return void deleteArtboard();
  if (!state.selection.length) return;
  edit(() => {
    for (const id of state.selection) {
      const c = containerOf(id);
      if (c) c.list.splice(c.list.findIndex((s) => s.id === id), 1);
    }
    // A boolean group left with nothing inside goes too.
    state.doc.shapes = state.doc.shapes.filter((s) => s.type !== 'boolean' || s.children.length);
    state.selection = [];
  });
}

// A copy needs fresh ids all the way down (boolean groups contain shapes).
export function withNewIds<T extends Shape>(s: T): T {
  const c = { ...s, id: newId() };
  if (c.type === 'boolean') c.children = c.children.map(withNewIds);
  return c;
}

// ---- Boolean groups (non-destructive, like Figma) ---------------------------

// Two or more shapes -> a live boolean group; one selected group -> switch its
// operation. The shapes inside stay editable.
export function makeBoolean(op: BoolOp): string | null {
  const sel = editable();
  if (sel.length === 1 && sel[0].type === 'boolean') {
    const g = sel[0];
    if (g.op !== op) edit(() => ((g.op = op), (g.name = nextBoolName(op))));
    return null;
  }
  if (sel.length < 2) return 'Select two or more shapes';
  const c = containerOf(sel[0].id);
  if (!c || sel.some((s) => containerOf(s.id)?.list !== c.list)) return 'Shapes must be in the same group';
  const list = c.list;
  const inOrder = list.filter((s) => sel.includes(s)); // bottom to top
  const bottom = inOrder[0];
  const group: BooleanShape = {
    id: newId(),
    type: 'boolean',
    op,
    name: nextBoolName(op),
    children: inOrder,
    // Like Figma, the group takes the bottom shape's paint.
    fill: bottom.type === 'line' || bottom.fill === 'none' ? bottom.stroke : bottom.fill,
    stroke: bottom.stroke,
    strokeWidth: 0,
    cap: bottom.cap,
    join: bottom.join,
  };
  edit(() => {
    const at = list.indexOf(inOrder[inOrder.length - 1]);
    list.splice(at + 1, 0, group);
    for (const s of inOrder) list.splice(list.indexOf(s), 1);
    state.selection = [group.id];
  });
  return null;
}

// Fix for single-path export: white shapes drawn on top to fake holes become
// a Subtract group (everything else minus the white shapes), as Google does it.
export function whitesToSubtract(abId: string): boolean {
  const ab = artboardById(abId);
  if (!ab) return false;
  const on = shapesOn(ab).filter((s) => !s.hidden && !s.locked);
  const isWhite = (s: Shape) => (s.type !== 'line' && s.fill !== 'none' ? s.fill : s.strokeWidth > 0 ? s.stroke : '').toUpperCase() === '#FFFFFF';
  const whites = on.filter(isWhite);
  const rest = on.filter((s) => !isWhite(s));
  if (!whites.length || !rest.length) return false;
  const list = shapes();
  const base = rest.find((s) => s.type !== 'line' && s.fill !== 'none') ?? rest[0];
  const color = base.type !== 'line' && base.fill !== 'none' ? base.fill : base.stroke;
  const paint = { fill: color, stroke: base.stroke, strokeWidth: 0, cap: base.cap, join: base.join };
  const bottom: Shape = rest.length === 1 ? rest[0] : { id: newId(), type: 'boolean', op: 'union', name: nextBoolName('union'), children: rest, ...paint };
  const group: BooleanShape = { id: newId(), type: 'boolean', op: 'subtract', name: nextBoolName('subtract'), children: [bottom, ...whites], ...paint };
  edit(() => {
    const at = Math.max(...on.map((s) => list.indexOf(s)));
    list.splice(at + 1, 0, group);
    for (const s of on) list.splice(list.indexOf(s), 1);
    state.selection = [group.id];
  });
  return true;
}

function nextBoolName(op: BoolOp) {
  return `${BOOL_LABEL[op]} ${allShapes().filter((s) => s.type === 'boolean' && s.op === op).length + 1}`;
}

// Release (Ctrl+Shift+G): put the shapes back where the group was.
export function releaseBoolean(): boolean {
  const groups = editable().filter((s): s is BooleanShape => s.type === 'boolean');
  if (!groups.length) return false;
  edit(() => {
    const freed: string[] = [];
    for (const g of groups) {
      const c = containerOf(g.id);
      if (!c) continue;
      c.list.splice(c.list.indexOf(g), 1, ...g.children);
      freed.push(...g.children.map((x) => x.id));
    }
    state.selection = freed;
  });
  return true;
}

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
let lastCopiedSvg = '';
export const isOwnCopy = (svg: string) => !!lastCopiedSvg && svg.trim() === lastCopiedSvg.trim();

export function cut() {
  copy();
  deleteSelection();
}

type PasteMode = 'center' | 'inPlace' | 'front' | 'back';

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

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

// Fresh ids, and names like drawn shapes get (Path 3, Exclude 2…).
function adopt(list: Shape[]): Shape[] {
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

export function duplicateSelection(dx = 0, dy = 0): Shape[] {
  const clones: Shape[] = [];
  for (const s of editable()) {
    const list = containerOf(s.id)?.list ?? shapes();
    const c = withNewIds(structuredClone(s));
    moveShape(c, structuredClone(c), dx, dy);
    list.splice(list.indexOf(s) + 1, 0, c);
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
    // Arranges within the container of the first selected shape (top level or a group).
    const list = containerOf(state.selection[0])?.list ?? shapes();
    const sel = (s: Shape) => state.selection.includes(s.id);
    const reorder = (next: Shape[]) => list.splice(0, list.length, ...next);
    if (how === 'front') reorder([...list.filter((s) => !sel(s)), ...list.filter(sel)]);
    else if (how === 'back') reorder([...list.filter(sel), ...list.filter((s) => !sel(s))]);
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
  const locked = allShapes().filter((s) => s.locked);
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
  const hidden = allShapes().filter((s) => s.hidden);
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
  list.forEach((s, i) => scaleKeepingRotation(s, originals[i], from, to));
}

// Rotate shapes as a group around `pivot`.
export function rotateShapes(list: Shape[], originals: Shape[], deg: number, pivot: Pt) {
  list.forEach((s, i) => {
    const o = originals[i];
    // A boolean group rotates the shapes inside it, so they stay directly editable.
    if (s.type === 'boolean' && o.type === 'boolean') return rotateShapes(s.children, o.children, deg, pivot);
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

// One shape aligns to its artboard; several align to their combined bounds.
export function align(how: Align) {
  const list = editable();
  if (!list.length) return;
  const target = list.length === 1 ? artboardOf(list[0]) : unionBox(list.map(worldBox));
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

// ---- Artboards -----------------------------------------------------------

// The artboard a shape belongs to: the one its center sits on (else the active one).
export function artboardOf(s: Shape): Artboard {
  const c = center(worldBox(s));
  return artboards().find((a) => inside(a, c)) ?? activeArtboard();
}

// Shapes that move, scale and duplicate with an artboard.
export function shapesOn(ab: Artboard) {
  return shapes().filter((s) => inside(ab, center(worldBox(s))));
}

function moveArtboardBy(ab: Artboard, dx: number, dy: number, artwork = shapesOn(ab)) {
  ab.x += dx;
  ab.y += dy;
  for (const s of artwork) moveShape(s, structuredClone(s), dx, dy);
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Next free cell in the artboard grid (columns × gap from the prefs).
function freeSlot(w: number, h: number): Pt {
  const all = artboards();
  const o = all[0] ?? { x: 0, y: 0 };
  const { abColumns: cols, abGap: gap } = state.prefs;
  const px = Math.max(w, ...all.map((a) => a.w)) + gap;
  const py = Math.max(h, ...all.map((a) => a.h)) + gap;
  for (let i = 0; ; i++) {
    const box = { x: o.x + (i % cols) * px, y: o.y + Math.floor(i / cols) * py, w, h };
    if (!all.some((a) => overlaps(a, box))) return [box.x, box.y];
  }
}

export function addArtboard(): Artboard {
  const src = activeArtboard();
  const [x, y] = freeSlot(src.w, src.h);
  const ab = newArtboard(nextArtboardName(), x, y, src.w);
  ab.h = src.h;
  edit(() => {
    artboards().push(ab);
    setActiveArtboard(ab.id, true);
  });
  return ab;
}

// Artboard plus its artwork, placed in the next free grid cell.
export function duplicateArtboard(id = state.activeArtboard): Artboard | undefined {
  const src = artboardById(id);
  if (!src) return;
  const [x, y] = freeSlot(src.w, src.h);
  const ab = { ...src, id: newId(), name: `${src.name}_copy`, x, y };
  delete ab.variations; // a copy is a plain icon, not part of the master family
  delete ab.masterOf;
  delete ab.generated;
  edit(() => {
    const copies = structuredClone(shapesOn(src)).map(withNewIds);
    for (const s of copies) moveShape(s, structuredClone(s), x - src.x, y - src.y);
    shapes().push(...copies);
    artboards().splice(artboards().indexOf(src) + 1, 0, ab);
    setActiveArtboard(ab.id, true);
  });
  return ab;
}

// Removes the artboard only; its artwork stays on the canvas (as in Illustrator).
// Instances of it elsewhere are detached first so they keep their artwork.
export function deleteArtboard(id = state.activeArtboard) {
  if (artboards().length < 2) return false;
  edit(() => {
    for (const inst of allShapes().filter((x): x is InstanceShape => x.type === 'instance' && x.ref === id)) replaceWithDetached(inst);
    const i = artboards().findIndex((a) => a.id === id);
    artboards().splice(i, 1);
    setActiveArtboard(artboards()[Math.max(0, i - 1)].id);
  });
  return true;
}

export function renameArtboard(id: string, name: string) {
  const ab = artboardById(id);
  const clean = name.trim();
  if (!ab || !clean || clean === ab.name) return;
  edit(() => (ab.name = clean));
}

export function moveArtboardInList(id: string, to: number) {
  const list = artboards();
  const from = list.findIndex((a) => a.id === id);
  if (from < 0 || from === to) return;
  edit(() => {
    const [ab] = list.splice(from, 1);
    list.splice(to > from ? to - 1 : to, 0, ab);
  });
}

// X/Y move the artboard with its artwork; W/H resize it from the top-left.
export function setArtboardGeometry(field: 'x' | 'y' | 'w' | 'h', value: number, opts: EditOpts = {}) {
  const ab = activeArtboard();
  if (!Number.isFinite(value)) return;
  const v = field === 'w' || field === 'h' ? Math.max(1, Math.round(value)) : Math.round(value);
  edit(() => {
    if (field === 'x') moveArtboardBy(ab, v - ab.x, 0);
    else if (field === 'y') moveArtboardBy(ab, 0, v - ab.y);
    else ab[field] = v;
  }, opts);
}

// Icon size presets scale the artwork too (strokes included), so the icon looks the same.
export function setIconSize(next: number) {
  const ab = activeArtboard();
  const k = next / Math.max(ab.w, ab.h);
  if (k === 1) return;
  edit(() => {
    const from: Box = { ...ab };
    const to: Box = { x: ab.x, y: ab.y, w: Math.round(ab.w * k), h: Math.round(ab.h * k) };
    for (const s of shapesOn(ab)) {
      scaleShape(s, structuredClone(s), from, to);
      for (const x of allShapes([s])) x.strokeWidth *= k;
    }
    Object.assign(ab, { w: to.w, h: to.h });
  });
}

// Illustrator's "Rearrange All Artboards": lay them out in a grid, artwork included.
export function arrangeArtboards(columns = state.prefs.abColumns, gap = state.prefs.abGap) {
  state.prefs.abColumns = Math.max(1, Math.round(columns));
  state.prefs.abGap = Math.max(0, Math.round(gap));
  savePrefs();
  const all = artboards();
  const { abColumns: cols, abGap: g } = state.prefs;
  const o = { x: Math.min(...all.map((a) => a.x)), y: Math.min(...all.map((a) => a.y)) };
  // Uniform cells sized to the largest artboard keep the icons lined up.
  const cw = Math.max(...all.map((a) => a.w)) + g;
  const ch = Math.max(...all.map((a) => a.h)) + g;
  edit(() => {
    const artwork = all.map((ab) => shapesOn(ab)); // capture before anything moves
    all.forEach((ab, i) => {
      const x = o.x + (i % cols) * cw;
      const y = o.y + Math.floor(i / cols) * ch;
      moveArtboardBy(ab, x - ab.x, y - ab.y, artwork[i]);
    });
  });
}

// ---- Components & badges ------------------------------------------------------

// Elements: turn the selected shapes into a reusable component. They move to a
// new component artboard and a linked instance takes their place.
export function componentFromSelection(): Artboard | null {
  const sel = editable();
  if (!sel.length) return null;
  const list = shapes();
  const top = sel.filter((s) => list.includes(s)); // top level only
  if (top.length !== sel.length) return null;
  const b = unionBox(top.map(worldBox));
  const [x0, y0] = [Math.floor(b.x), Math.floor(b.y)];
  const [w, h] = [Math.max(1, Math.ceil(b.x + b.w) - x0), Math.max(1, Math.ceil(b.y + b.h) - y0)];
  const [ax, ay] = freeSlot(w, h);
  const name = top.length === 1 && top[0].name ? top[0].name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'element' : 'element';
  const ab: Artboard = { ...newArtboard(name, ax, ay, w), h, component: true };
  edit(() => {
    const at = Math.max(...top.map((s) => list.indexOf(s)));
    const inst = newInstance(ab.id, x0, y0, 1);
    list.splice(at + 1, 0, inst);
    for (const s of top) {
      list.splice(list.indexOf(s), 1);
      moveShape(s, structuredClone(s), ax - x0, ay - y0);
    }
    list.push(...top);
    artboards().push(ab);
    inst.name = ab.name;
    state.selection = [inst.id];
  });
  return ab;
}

export function setComponent(id: string, on: boolean) {
  const ab = artboardById(id);
  if (!ab || !!ab.component === on) return;
  edit(() => (ab.component = on));
}

function newInstance(ref: string, x: number, y: number, scale: number, knockout = 0): InstanceShape {
  const src = resolveSource(ref);
  return { id: newId(), type: 'instance', ref, x, y, scale, knockout, name: src?.name ?? 'Instance', fill: 'none', stroke: '#000000', strokeWidth: 0 };
}

// Place a component in the active artboard, scaled to fill it (aligned like a base icon).
export function placeComponent(ref: string): InstanceShape | null {
  const src = artboardById(ref);
  const ab = activeArtboard();
  if (!src || src.id === ab.id) return null;
  const k = Math.min(ab.w / src.w, ab.h / src.h);
  const inst = newInstance(ref, ab.x + (ab.w - src.w * k) / 2, ab.y + (ab.h - src.h * k) / 2, k);
  edit(() => {
    shapes().push(inst);
    state.selection = [inst.id];
  });
  return inst;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

// Badge slot: a corner of the artboard, 1dp in from the edge (scaled to the icon size).
function slot(ab: Artboard, size: number, corner: Corner): Pt {
  const k = Math.min(ab.w, ab.h) / 24;
  const pad = 1 * k;
  return [corner.includes('w') ? ab.x + pad : ab.x + ab.w - size - pad, corner.includes('n') ? ab.y + pad : ab.y + ab.h - size - pad];
}

// The color most of an artboard's shapes use (a badge matches its icon).
function iconColorOf(ab: Artboard): string {
  const counts = new Map<string, number>();
  for (const s of shapesOn(ab)) {
    if (s.hidden || s.type === 'instance') continue;
    const c = s.type !== 'line' && s.fill !== 'none' ? s.fill : s.strokeWidth > 0 ? s.stroke : null;
    if (c) counts.set(c.toUpperCase(), (counts.get(c.toUpperCase()) ?? 0) + 1);
  }
  return [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] ?? (state.prefs.style.fill !== 'none' ? state.prefs.style.fill : '#000000');
}

// Defaults for a 24dp icon: a 10dp badge with a 1.5dp knockout gap.
export const BADGE_SIZE = 10;
export const BADGE_GAP = 1.5;

export function placeBadge(key: BadgeKey, circle: boolean, corner: Corner = 'se'): InstanceShape {
  const ab = activeArtboard();
  const k = Math.min(ab.w, ab.h) / 24;
  const size = BADGE_SIZE * k;
  const [x, y] = slot(ab, size, corner);
  const inst = newInstance(`badge:${key}${circle ? '_circle' : ''}`, x, y, size / BADGE_BOX.w, BADGE_GAP * k);
  inst.fill = iconColorOf(ab);
  edit(() => {
    shapes().push(inst); // on top, so its knockout cuts the icon below
    state.selection = [inst.id];
  });
  return inst;
}

const selectedInstances = () => editable().filter((s): s is InstanceShape => s.type === 'instance');

export function moveBadgeTo(corner: Corner) {
  const list = selectedInstances();
  if (!list.length) return;
  edit(() => {
    for (const inst of list) {
      const ab = artboards().find((a) => inside(a, center(worldBox(inst)))) ?? activeArtboard();
      [inst.x, inst.y] = slot(ab, worldBox(inst).w, corner);
    }
  });
}

export function setKnockout(gap: number, opts: EditOpts = {}) {
  const list = selectedInstances();
  if (!list.length || !Number.isFinite(gap)) return;
  edit(() => list.forEach((i) => (i.knockout = Math.max(0, gap))), opts);
}

export function swapBadge(key: BadgeKey, circle: boolean) {
  const list = selectedInstances().filter((i) => i.ref.startsWith('badge:'));
  if (!list.length) return;
  const ref = `badge:${key}${circle ? '_circle' : ''}`;
  edit(() => list.forEach((i) => ((i.ref = ref), (i.name = resolveSource(ref)?.name ?? i.name))));
}

// The instance's artwork as ordinary, editable shapes in the same place.
function detachedShapes(inst: InstanceShape): Shape[] {
  const src = resolveSource(inst.ref);
  if (!src) return [];
  const to = { x: inst.x, y: inst.y, w: src.box.w * inst.scale, h: src.box.h * inst.scale };
  const clones = structuredClone(src.shapes).map(withNewIds);
  for (const c of clones) {
    scaleKeepingRotation(c, structuredClone(c), src.box, to);
    for (const x of allShapes([c])) {
      x.strokeWidth *= inst.scale;
      if (x.type === 'rect' && x.r) x.r *= inst.scale;
    }
  }
  if (inst.rotation) rotateShapes(clones, structuredClone(clones), inst.rotation, center(to));
  if (inst.fill !== 'none') {
    // Keep the instance's color override.
    for (const x of clones.flatMap((c) => allShapes([c]))) {
      if (x.fill !== 'none') x.fill = inst.fill;
      x.stroke = inst.fill;
    }
  }
  return clones;
}

function replaceWithDetached(inst: InstanceShape): Shape[] {
  const c = containerOf(inst.id);
  if (!c) return [];
  const clones = detachedShapes(inst);
  c.list.splice(c.list.indexOf(inst), 1, ...clones);
  return clones;
}

// Detach instance (Figma: Ctrl+Alt+B). Returns how many had a knockout, which
// detaching removes (use Subtract to keep that gap).
export function detachSelection(): number {
  const list = selectedInstances();
  if (!list.length) return 0;
  let lostKnockouts = 0;
  edit(() => {
    const freed: string[] = [];
    for (const inst of list) {
      if ((inst.knockout ?? 0) > 0) lostKnockouts++;
      freed.push(...replaceWithDetached(inst).map((x) => x.id));
    }
    state.selection = freed;
  });
  return lostKnockouts;
}

// Variant generator: every base x badge combination as a new artboard holding a
// linked instance of the base plus the badge (with knockout). Edit the base
// once and every variant follows.
export function generateVariants(baseIds: string[], keys: BadgeKey[], circle: boolean, gap = BADGE_GAP, corner: Corner = 'se'): Artboard[] {
  const bases = baseIds.map(artboardById).filter((a): a is Artboard => !!a);
  if (!bases.length || !keys.length) return [];
  const made: Artboard[] = [];
  edit(() => {
    for (const base of bases) {
      base.component = true;
      for (const key of keys) {
        const def = BADGES.find((b) => b.key === key)!;
        const [x, y] = freeSlot(base.w, base.h);
        const ab = newArtboard(`${base.name}_${def.suffix}${circle ? '_circle' : ''}`, x, y, base.w);
        ab.h = base.h;
        artboards().push(ab);
        const k = Math.min(ab.w, ab.h) / 24;
        const size = BADGE_SIZE * k;
        const [bx, by] = slot(ab, size, corner);
        const badge = newInstance(`badge:${key}${circle ? '_circle' : ''}`, bx, by, size / BADGE_BOX.w, gap * k);
        badge.fill = iconColorOf(base);
        shapes().push(newInstance(base.id, ab.x, ab.y, 1), badge);
        made.push(ab);
      }
    }
    if (made.length) setActiveArtboard(made[0].id, true);
  });
  return made;
}

// ---- Masters (weight, fill, optical size) ------------------------------------

const MASTER_NAME: Record<AxisTag, (v: number) => string> = { wght: (v) => `@${v}`, FILL: () => '@filled', GRAD: (v) => `@grad${v}`, opsz: (v) => `@${v}dp` };

// Copy the icon onto a new master artboard for one axis: bolder (to be drawn
// bolder), filled (holes shrunk to nothing), graded (to be drawn a touch
// heavier, same size), or at another optical size (scaled).
// Returns the master and how many filled shapes are only approximate.
export function addMaster(id: string, axis: AxisTag, size = 48): { master: Artboard; approx: number } | null {
  const base = artboardById(id);
  if (!base || base.generated || (base.masterOf && artboardById(base.masterOf))) return null;
  if (mastersOf(base).some((m) => m.axis === axis)) return null;
  const value = axis === 'wght' ? (base.variations?.wght === 700 ? 100 : 700) : axis === 'FILL' ? 1 : axis === 'GRAD' ? 200 : size;
  const k = axis === 'opsz' ? size / base.w : 1;
  const [w, h] = [Math.round(base.w * k), Math.round(base.h * k)];
  const [x, y] = freeSlot(w, h);
  const master: Artboard = { id: newId(), name: base.name + MASTER_NAME[axis](value), x, y, w, h, masterOf: base.id };
  let approx = 0;
  edit(() => {
    const copies = structuredClone(shapesOn(base)).map(withNewIds);
    for (const s of copies) {
      scaleWhole(s, base, { x, y, w, h });
      if (axis === 'FILL') approx += fillIn(s);
    }
    shapes().push(...copies);
    const after = [base, ...mastersOf(base).map((m) => m.ab)].reduce((i, a) => Math.max(i, artboards().indexOf(a)), 0);
    artboards().splice(after + 1, 0, master);
    base.variations ??= { wght: 400, FILL: 0, masters: [] };
    base.variations.masters = base.variations.masters.filter((m) => artboardById(m.id));
    base.variations.masters.push({ id: master.id, axis, value });
    delete base.masterOf;
    setActiveArtboard(master.id, true);
  });
  return { master, approx };
}

// Unlink a master; its artboard stays as a plain icon.
export function removeMaster(baseId: string, masterId: string) {
  const base = artboardById(baseId);
  if (!base?.variations) return;
  edit(() => {
    base.variations!.masters = base.variations!.masters.filter((m) => m.id !== masterId);
    if (!base.variations!.masters.length) delete base.variations;
    const m = artboardById(masterId);
    if (m) delete m.masterOf;
  });
}

// The weight or grade of the base (`master` = false) or of that axis's master.
export function setAxisValue(baseId: string, axis: 'wght' | 'GRAD', master: boolean, value: number) {
  const base = artboardById(baseId);
  const v = base?.variations;
  const m = v?.masters.find((x) => x.axis === axis);
  if (!v || !m || !Number.isFinite(value) || value === (master ? m.value : (v[axis] ?? 0))) return;
  edit(() => {
    if (master) {
      m.value = value;
      const ab = artboardById(m.id);
      if (ab) ab.name = ab.name.replace(axis === 'wght' ? /@\d+$/ : /@grad-?\d+$/, MASTER_NAME[axis](value));
    } else v[axis] = value;
  });
}

// Generate an artboard for every combination of the picked values
// (replacing earlier generated ones).
export function generateVariations(baseId: string, picks: Partial<Record<AxisTag, number[]>>): Artboard[] {
  const base = artboardById(baseId);
  if (!base?.variations) return [];
  const locs = combos(base, picks);
  const made: Artboard[] = [];
  edit(() => {
    // Drop the previous set (and its artwork).
    for (const old of artboards().filter((a) => a.generated?.from === base.id)) {
      const gone = new Set(shapesOn(old));
      state.doc.shapes = shapes().filter((s) => !gone.has(s));
      artboards().splice(artboards().indexOf(old), 1);
    }
    for (const loc of locs) {
      const list = interpolate(base, loc);
      if (!list) continue;
      const k = loc.opsz / base.w;
      const [w, h] = [Math.round(base.w * k), Math.round(base.h * k)];
      const [x, y] = freeSlot(w, h);
      const ab: Artboard = { ...newArtboard(`${base.name}_${locSuffix(loc)}`, x, y, w), h, generated: { from: base.id, loc } };
      artboards().push(ab);
      for (const s of list.map(withNewIds)) {
        scaleWhole(s, base, { x, y, w, h });
        snapToGrid(s);
        shapes().push(s);
      }
      made.push(ab);
    }
  });
  return made;
}

// ---- Audit fixes ------------------------------------------------------------

export function fixAuditIssue(sid: string, index: number) {
  const s = byIdAll(sid);
  if (!s || s.type !== 'bezier') return;
  const issue = auditShape(s)[index];
  if (issue) edit(() => issue.fix(s));
}

// Fix everything, re-checking after each fix (some fixes add or remove points).
export function fixAllAudit(sids: string[]) {
  edit(() => {
    for (const sid of sids) {
      const s = byIdAll(sid);
      if (!s || s.type !== 'bezier') continue;
      for (let guard = 0; guard < 100; guard++) {
        const next = auditShape(s)[0];
        if (!next) break;
        next.fix(s);
      }
    }
  });
}

// ---- Material icon style ------------------------------------------------

export const iconStyle = (): IconStyle => state.doc.iconStyle ?? 'outlined';

// Outlined / Rounded / Sharp: sets line ends, corners and rectangle corner
// radius for every shape and for new shapes.
export function setIconStyle(style: IconStyle) {
  if (style === iconStyle()) return;
  const { cap, join, radius } = ICON_STYLES[style];
  Object.assign(state.prefs.style, { cap, join });
  savePrefs();
  edit(() => {
    state.doc.iconStyle = style;
    for (const s of allShapes()) {
      Object.assign(s, { cap, join });
      if (s.type === 'rect') s.r = radius;
    }
  });
}

// A sharp point (no handles, not the end of an open path) can take a Smart Corner.
export const isCorner = (s: BezierShape, i: number) => !s.nodes[i].in && !s.nodes[i].out && (s.closed || (i > 0 && i < s.nodes.length - 1));

// Any shape as an editable path, in place (rotation baked in).
function asBezier(id: string): BezierShape | null {
  const s = byIdAll(id);
  if (!s) return null;
  if (s.type === 'bezier' && !s.rotation) return s;
  if (s.type === 'boolean' || s.type === 'instance') return null;
  const b = toBezier(s);
  const c = containerOf(id);
  if (c) c.list[c.list.indexOf(s)] = b;
  return b;
}
const byIdAll = (id: string) => allShapes().find((s) => s.id === id);

// Corner radius: picked points (Direct Selection), every sharp point of the
// selected paths, or rectangles' corners.
export function setCornerRadius(r: number, opts: EditOpts = {}) {
  if (!Number.isFinite(r)) return;
  const radius = Math.max(0, r);
  if (state.tool === 'direct' && state.anchors.length) {
    return edit(() => {
      for (const a of state.anchors) {
        const s = asBezier(a.sid);
        if (s && isCorner(s, a.i)) s.nodes[a.i].radius = radius;
      }
    }, opts);
  }
  const list = editable().filter((s) => s.type === 'rect' || s.type === 'bezier');
  if (!list.length) return;
  edit(() => {
    for (const s of list) {
      if (s.type === 'rect') s.r = radius;
      else if (s.type === 'bezier') s.nodes.forEach((n, i) => isCorner(s, i) && (n.radius = radius));
    }
  }, opts);
}

// ---- Document ----------------------------------------------------------

export function renameDoc(name: string) {
  const clean = name.trim() || 'Untitled';
  if (clean === state.doc.name) return;
  edit(() => (state.doc.name = clean));
}

export function newDoc() {
  if (shapes().length && !confirm('Start a new document? You can undo this.')) return;
  const size = activeArtboard().w;
  edit(() => {
    const ab = newArtboard('icon_1', 0, 0, size);
    state.doc = { name: 'Untitled', iconStyle: iconStyle(), artboards: [ab], shapes: [] };
    state.selection = [];
    setActiveArtboard(ab.id);
  });
}
