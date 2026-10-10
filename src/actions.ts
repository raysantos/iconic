// Editing commands shared by keyboard shortcuts, menus and panels.
import { bbox, center, moveShape, rotate, scaleKeepingRotation, scaleShape, unionBox, worldBox } from './geometry';
import { BOOL_LABEL, ICON_STYLES, type Artboard, type BoolOp, type BooleanShape, type Box, type IconStyle, type Pt, type Shape, type Style } from './model';
import { activeArtboard, allShapes, artboardById, artboards, checkpoint, containerOf, commit, emit, inside, newArtboard, newId, nextArtboardName, savePrefs, selected, setActiveArtboard, shapes, state } from './store';
import { exportSvgString } from './svg';

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
    void navigator.clipboard?.writeText(exportSvgString(sel, unionBox(sel.map(worldBox)))).catch(() => {});
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
export function deleteArtboard(id = state.activeArtboard) {
  if (artboards().length < 2) return false;
  edit(() => {
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

export function setCornerRadius(r: number, opts: EditOpts = {}) {
  const rects = editable().filter((s) => s.type === 'rect');
  if (!rects.length || !Number.isFinite(r)) return;
  edit(() => rects.forEach((s) => s.type === 'rect' && (s.r = Math.max(0, r))), opts);
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
