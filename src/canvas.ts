// The editing surface: view (zoom/pan), rendering, and pointer tools.
import { duplicateSelection, rotateShapes, scaleShapes, selectionBox, shapesOn, view as actionsView, withNewIds } from './actions';
import {
  bbox,
  center,
  fromPoints,
  intersects,
  isEmpty,
  moveShape,
  nearestOnPath,
  rotate,
  scaleShape,
  splitSegment,
  toBezier,
  unionBox,
  worldBox,
} from './geometry';
import { ICON_STYLES, type Artboard, type BNode, type BezierShape, type BooleanShape, type Box, type Pt, type Shape } from './model';
import {
  activeArtboard,
  allShapes,
  containerOf,
  artboardById,
  artboards,
  byId,
  checkpoint,
  commit,
  discardIfUnchanged,
  dropCheckpoint,
  emit,
  inside,
  isSelected,
  newArtboard,
  newId,
  nextArtboardName,
  nextName,
  redo,
  selected,
  setActiveArtboard,
  shapes,
  state,
  subscribe,
  undo,
} from './store';
import { paintColor, visibleOn } from './export';
import { AUDIT_LABEL, auditShape } from './audit';
import { balanceTunni, dragTunni, powerAdjust, segmentAt } from './curvetools';
import { cubicsToNodes, fitCurve, removeAnchorSmooth, reverseNodes } from './fit';
import { collectTargets, smartOn, snapBox, snapPoint, type Guide } from './guides';
import { flattenArtboard, hasPathOps } from './pathops';
import { el, renderShapes, setAttrs, shapeGeometry } from './svg';
import { altOn, notify, openToolWheel, penSeen, shiftOn } from './tablet';

const svg = document.getElementById('canvas') as unknown as SVGSVGElement;
const world = el('g');
svg.append(world);

// ---- View ----------------------------------------------------------------

// screen = world * zoom + (x, y), in CSS px relative to the canvas element.
export const viewState = { zoom: 1, x: 0, y: 0 };
const viewListeners: (() => void)[] = [];
export const onViewChange = (fn: () => void) => viewListeners.push(fn);

const u = () => 1 / viewState.zoom; // world units per screen pixel

function applyView() {
  setAttrs(world, { transform: `translate(${viewState.x} ${viewState.y}) scale(${viewState.zoom})` });
  render();
  viewListeners.forEach((fn) => fn());
}

function screenSize() {
  const r = svg.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

export function zoomTo(box: Box, fill = 0.7) {
  const { w, h } = screenSize();
  if (!w || !h) return;
  const z = clampZoom(Math.min((w * fill) / Math.max(box.w, 1), (h * fill) / Math.max(box.h, 1)));
  viewState.zoom = z;
  viewState.x = w / 2 - (box.x + box.w / 2) * z;
  viewState.y = h / 2 - (box.y + box.h / 2) * z;
  applyView();
}

export const fitArtboard = () => zoomTo(activeArtboard());
export const fitAll = () => zoomTo(unionBox(artboards()), 0.85);

export function fitSelection() {
  const b = selectionBox();
  if (b) zoomTo(b.w || b.h ? b : { ...b, x: b.x - 1, y: b.y - 1, w: 2, h: 2 }, 0.6);
}

const clampZoom = (z: number) => Math.min(256, Math.max(0.5, z));

export function zoomAt(factor: number, sx?: number, sy?: number) {
  const { w, h } = screenSize();
  [sx, sy] = [sx ?? w / 2, sy ?? h / 2];
  const z = clampZoom(viewState.zoom * factor);
  viewState.x = sx - ((sx - viewState.x) * z) / viewState.zoom;
  viewState.y = sy - ((sy - viewState.y) * z) / viewState.zoom;
  viewState.zoom = z;
  applyView();
}

// 100% = one icon pixel per screen pixel (Illustrator's Actual Size).
export const actualSize = () => zoomAt(1 / viewState.zoom);

actionsView.center = () => {
  const { w, h } = screenSize();
  return toWorld(w / 2, h / 2);
};

function toWorld(sx: number, sy: number): Pt {
  return [(sx - viewState.x) / viewState.zoom, (sy - viewState.y) / viewState.zoom];
}

function eventPoint(e: PointerEvent | MouseEvent): Pt {
  const r = svg.getBoundingClientRect();
  return toWorld(e.clientX - r.left, e.clientY - r.top);
}

// Snap increment: ½ px, 1 px, or the major grid spacing.
function snapStep() {
  const p = state.prefs;
  return p.snapTo === 'half' ? 0.5 : p.snapTo === 'grid' ? p.gridSize : 1;
}
const snap = (v: number) => {
  if (!state.prefs.snap) return Math.round(v * 100) / 100;
  const k = snapStep();
  return Math.round(v / k) * k;
};
const snapPt = (p: Pt): Pt => [snap(p[0]), snap(p[1])];

// ---- Smart guides ----------------------------------------------------------

let guides: Guide[] = [];
let targetCache: ReturnType<typeof collectTargets> | null = null; // per gesture

function targets(exclude: Iterable<string> = [], skip?: { sid: string; i: number }) {
  return (targetCache ??= collectTargets(new Set(exclude), skip));
}

// Snap a point with smart guides; any axis they don't catch falls back to the
// grid (unless `grid` is false, e.g. for Bezier handles).
function smartPoint(p: Pt, exclude: Iterable<string> = [], skip?: { sid: string; i: number }, grid = true): Pt {
  if (!smartOn()) {
    guides = [];
    return grid ? snapPt(p) : p;
  }
  const r = snapPoint(p, targets(exclude, skip), viewState.zoom);
  guides = r.guides;
  return [r.x || !grid ? r.p[0] : snap(p[0]), r.y || !grid ? r.p[1] : snap(p[1])];
}

function guideOverlay(): SVGGElement {
  const g = el('g', {}, 'smart-guides');
  for (const gd of guides) {
    const [[x1, y1], [x2, y2]] = gd.line;
    if (x1 !== x2 || y1 !== y2) g.append(el('line', { x1, y1, x2, y2, 'stroke-width': u() }, 'smart-guide'));
    if (gd.label) {
      const [x, y] = gd.label.at;
      const w = (gd.label.text.length * 6 + 8) * u();
      const t = el('text', { x: x + 8 * u() + w / 2, y: y - 8 * u(), 'font-size': 10 * u(), 'text-anchor': 'middle' });
      t.textContent = gd.label.text;
      g.append(el('rect', { x: x + 8 * u(), y: y - 19 * u(), width: w, height: 15 * u(), rx: 2 * u() }, 'guide-label'), t);
      g.append(el('circle', { cx: x, cy: y, r: 2.5 * u() }, 'guide-dot'));
    }
  }
  return g;
}

// ---- Rendering -----------------------------------------------------------

let hoverId: string | null = null;
let marquee: Box | null = null;

// Hovering a row in the Layers panel outlines the shape here.
export function setHover(id: string | null) {
  if (id === hoverId) return;
  hoverId = id;
  render();
}

// Tools that edit points show anchors instead of the bounding box.
const pointTools = new Set(['direct', 'addAnchor', 'deleteAnchor', 'convertAnchor']);

export function render() {
  world.replaceChildren();

  for (const ab of artboards()) {
    const bg = el('rect', { x: ab.x, y: ab.y, width: ab.w, height: ab.h }, 'artboard' + (state.artboardSelected && ab.id === state.activeArtboard ? ' selected' : ''));
    bg.dataset.artboardBg = ab.id;
    world.append(bg);
    if (state.prefs.keylines && state.prefs.materialMode) world.append(keylineTemplate(ab));
    if (state.prefs.grid) world.append(...gridLines(ab));
  }

  // Merged preview (Ctrl+Y): each icon as the single path it exports to. The
  // real shapes stay on top, invisible, so they can still be picked and edited.
  const merged = state.prefs.mergedPreview && hasPathOps();
  if (merged) {
    for (const ab of artboards()) {
      const on = visibleOn(shapes(), ab);
      const flat = flattenArtboard(on, ab);
      if (!flat?.d) continue;
      const color = on.map(paintColor).find(Boolean) ?? '#000000';
      world.append(el('path', { d: flat.d, transform: `translate(${ab.x} ${ab.y})`, fill: color, 'fill-rule': flat.fillRule }, 'merged'));
    }
  }

  const drawn = renderShapes(shapes(), (e, s) => {
    e.dataset.id = s.id;
    if (s.locked) e.classList.add('locked');
    if (merged) e.classList.add('ghost');
  });
  world.append(...drawn);
  for (const s of shapes()) if (!s.hidden && s.type === 'boolean' && isOpen(s)) world.append(groupInterior(s));

  const overlay = el('g', {}, 'overlay');
  world.append(overlay);
  const sel = selected().filter((s) => !s.hidden);
  const busy = gesture && gesture.kind !== 'pan';

  const hovered = hoverId && !isSelected(hoverId) && !busy ? byId(hoverId) : null;
  if (hovered && !hovered.hidden) overlay.append(outline(hovered, 'hover-outline', 1.5));

  if (penPath) {
    overlay.append(nodeOverlay(penPath));
  } else if (pointTools.has(state.tool)) {
    for (const s of sel) {
      overlay.append(outline(s, 'sel-outline', 1));
      if (!s.locked) overlay.append(nodeOverlay(s.type === 'bezier' ? s : toBezier(s), s.id));
    }
  } else if (sel.length && gesture?.kind !== 'create') {
    if (sel.length > 1) for (const s of sel) overlay.append(outline(s, 'sel-outline', 1));
    overlay.append(transformBox(sel, state.tool === 'select'));
  }

  // Artboard labels sit above the artwork so they stay clickable.
  for (const ab of artboards()) world.insertBefore(artboardLabel(ab), overlay);
  const ab = activeArtboard();
  if (state.artboardSelected || state.tool === 'artboard') overlay.append(artboardBox(ab, state.tool === 'artboard' || state.tool === 'select'));

  // Audit markers: geometry problems, with the reason on hover.
  if (state.prefs.audit && !penPath) {
    for (const s of allShapes()) {
      if (s.hidden || s.locked) continue;
      for (const issue of auditShape(s)) {
        const m = el('circle', { cx: issue.at[0], cy: issue.at[1], r: 4 * u(), 'stroke-width': 1.5 * u() }, 'audit-mark');
        m.dataset.audit = s.id;
        const t = el('title');
        t.textContent = `${AUDIT_LABEL[issue.kind]}: ${issue.message}`;
        m.append(t);
        overlay.append(m);
      }
    }
  }
  if (guides.length) overlay.append(guideOverlay());
  if (marquee) overlay.append(el('rect', { x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h, 'stroke-width': u() }, 'marquee'));
}

// Pixel lines (when zoomed in enough) plus a stronger line every `gridSize` px.
function gridLines(ab: Artboard): SVGElement[] {
  const out: SVGElement[] = [];
  const lines = (step: number) => {
    let d = '';
    for (let x = step; x < ab.w; x += step) d += `M${ab.x + x} ${ab.y}v${ab.h}`;
    for (let y = step; y < ab.h; y += step) d += `M${ab.x} ${ab.y + y}h${ab.w}`;
    return d;
  };
  if (viewState.zoom >= 6) out.push(el('path', { d: lines(1), 'stroke-width': u() }, 'grid'));
  const g = state.prefs.gridSize;
  if (g > 1 && viewState.zoom * g >= 6) out.push(el('path', { d: lines(g), 'stroke-width': u() }, 'grid grid-major'));
  return out;
}

// Material Design system icon template, scaled to the artboard: 2dp padding
// (trim area), 20dp live area, and the four keyline shapes.
function keylineTemplate(ab: Artboard): SVGGElement {
  const k = Math.min(ab.w, ab.h) / 24;
  const [cx, cy] = center(ab);
  const g = el('g', { 'stroke-width': u() }, 'keylines');
  const pad = 2 * k;
  g.append(
    el('path', { d: `M${ab.x} ${ab.y}h${ab.w}v${ab.h}h${-ab.w}z M${ab.x + pad} ${ab.y + pad}v${ab.h - 2 * pad}h${ab.w - 2 * pad}v${-(ab.h - 2 * pad)}z`, 'fill-rule': 'evenodd' }, 'trim'),
    el('circle', { cx, cy, r: 10 * k }),
    el('rect', { x: cx - 9 * k, y: cy - 9 * k, width: 18 * k, height: 18 * k }),
    el('rect', { x: cx - 8 * k, y: cy - 10 * k, width: 16 * k, height: 20 * k }),
    el('rect', { x: cx - 10 * k, y: cy - 8 * k, width: 20 * k, height: 16 * k }),
    el('path', { d: `M${cx} ${ab.y}V${ab.y + ab.h}M${ab.x} ${cy}H${ab.x + ab.w}M${ab.x} ${ab.y}L${ab.x + ab.w} ${ab.y + ab.h}M${ab.x + ab.w} ${ab.y}L${ab.x} ${ab.y + ab.h}` }, 'axes'),
  );
  return g;
}

function artboardLabel(ab: Artboard): SVGGElement {
  const g = el('g', {}, 'artboard-label' + (ab.id === state.activeArtboard ? ' active' : ''));
  g.dataset.artboard = ab.id;
  const fs = 11 * u();
  const text = el('text', { x: ab.x, y: ab.y - 6 * u(), 'font-size': fs });
  // Like Figma, long names are cut short to fit (the active artboard shows its full name).
  const fits = Math.max(1, Math.floor((ab.w + state.prefs.abGap) / u() / 6.5));
  const short = ab.id !== state.activeArtboard && ab.name.length > fits;
  const shown = short ? ab.name.slice(0, Math.max(1, fits - 1)) + '…' : ab.name;
  text.textContent = shown;
  if (short) {
    const tip = el('title');
    tip.textContent = ab.name;
    text.append(tip);
  }
  // Generous invisible hit area: text alone is hard to click.
  g.append(el('rect', { x: ab.x, y: ab.y - 20 * u(), width: Math.max(ab.w, (shown.length * 6.5 + 8) * u()), height: 18 * u() }, 'label-hit'), text);
  return g;
}

type AbHandle = 'nw' | 'ne' | 'se' | 'sw';

function artboardBox(ab: Artboard, interactive: boolean): SVGGElement {
  const g = el('g');
  g.append(el('rect', { x: ab.x, y: ab.y, width: ab.w, height: ab.h, 'stroke-width': 1.5 * u() }, 'bounds artboard-bounds'));
  if (!interactive) return g;
  const pos: Record<AbHandle, Pt> = { nw: [ab.x, ab.y], ne: [ab.x + ab.w, ab.y], se: [ab.x + ab.w, ab.y + ab.h], sw: [ab.x, ab.y + ab.h] };
  for (const [h, [x, y]] of Object.entries(pos) as [AbHandle, Pt][]) {
    const r = 4 * u();
    g.append(el('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, 'stroke-width': u() }, 'handle-sq'));
    const hit = el('rect', { x: x - 3 * r, y: y - 3 * r, width: 6 * r, height: 6 * r }, `handle-hit h-${h}`);
    hit.dataset.abHandle = h;
    g.append(hit);
  }
  return g;
}

function outline(s: Shape, cls: string, px: number) {
  const g = shapeGeometry(s);
  g.setAttribute('class', cls);
  g.setAttribute('stroke-width', String(px * u()));
  return g;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const coarse = matchMedia('(pointer: coarse)');

// Figma-style bounding box: 8 square handles, rotate zones off the corners,
// and a size badge underneath. A single shape's box follows its rotation.
// Handles only respond to the Selection tool (as in Illustrator).
function transformBox(sel: Shape[], interactive: boolean): SVGGElement {
  const g = el('g');
  const single = sel.length === 1 ? sel[0] : null;
  const b = single ? bbox(single) : unionBox(sel.map(worldBox));
  const rot = single?.rotation ?? 0;
  const [cx, cy] = center(b);
  if (rot) g.setAttribute('transform', `rotate(${rot} ${cx} ${cy})`);
  const locked = sel.every((s) => s.locked);

  g.append(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, 'stroke-width': u() }, 'bounds'));
  if (locked || !interactive) return g;

  const pos: Record<Handle, Pt> = {
    nw: [b.x, b.y],
    n: [cx, b.y],
    ne: [b.x + b.w, b.y],
    e: [b.x + b.w, cy],
    se: [b.x + b.w, b.y + b.h],
    s: [cx, b.y + b.h],
    sw: [b.x, b.y + b.h],
    w: [b.x, cy],
  };
  const tiny = b.w * viewState.zoom < 24 || b.h * viewState.zoom < 24;

  for (const h of HANDLES) {
    if (h.length === 1 && tiny) continue; // edge handles crowd small boxes
    const [x, y] = pos[h];
    if (h.length === 2) {
      // Rotate zone just outside each corner (mouse).
      const ox = (h.includes('e') ? 1 : -1) * 10 * u();
      const oy = (h.includes('s') ? 1 : -1) * 10 * u();
      const zone = el('circle', { cx: x + ox, cy: y + oy, r: 10 * u() }, 'rot-zone');
      zone.dataset.rotate = '1';
      g.append(zone);
    }
    const r = 4 * u();
    const sq = el('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, 'stroke-width': u() }, 'handle-sq');
    const hit = el('rect', { x: x - 3 * r, y: y - 3 * r, width: r * 6, height: r * 6 }, `handle-hit h-${h}`);
    hit.dataset.handle = h;
    g.append(sq, hit);
  }

  // Touch has no hover, so give it a visible rotate handle.
  if (coarse.matches) {
    const ry = b.y - 28 * u();
    g.append(el('line', { x1: cx, y1: b.y, x2: cx, y2: ry, 'stroke-width': u() }, 'bounds'));
    g.append(el('circle', { cx, cy: ry, r: 5 * u(), 'stroke-width': u() }, 'handle-sq'));
    const hit = el('circle', { cx, cy: ry, r: 16 * u() }, 'handle-hit');
    hit.dataset.rotate = '1';
    g.append(hit);
  }

  // Size badge (always upright, below the box).
  const wb = single ? worldBox(single) : b;
  const text = `${fmt(b.w)} × ${fmt(b.h)}`;
  const fs = 11 * u();
  const bw = (text.length * 6.4 + 10) * u();
  const bx = wb.x + wb.w / 2 - bw / 2;
  const by = wb.y + wb.h + 8 * u();
  const badge = el('g', {}, 'size-badge');
  badge.append(el('rect', { x: bx, y: by, width: bw, height: 16 * u(), rx: 2 * u() }));
  const t = el('text', { x: bx + bw / 2, y: by + 11.5 * u(), 'font-size': fs, 'text-anchor': 'middle' });
  t.textContent = text;
  badge.append(t);
  const outer = el('g');
  outer.append(g, badge);
  return outer;
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

// ---- Bezier points overlay ---------------------------------------------

type NodePart = 'p' | 'in' | 'out';

let penPath: BezierShape | null = null; // path currently being drawn
let penHover: Pt | null = null;

function nodeOverlay(s: BezierShape, sid = s.id): SVGGElement {
  const g = el('g');
  if (s.rotation) {
    const [cx, cy] = center(bbox(s));
    g.setAttribute('transform', `rotate(${s.rotation} ${cx} ${cy})`);
  }
  if (s === penPath && penHover && !gesture) {
    const last = s.nodes[s.nodes.length - 1];
    const c = last.out ?? last.p;
    const d = `M${last.p[0]} ${last.p[1]} C${c[0]} ${c[1]} ${penHover[0]} ${penHover[1]} ${penHover[0]} ${penHover[1]}`;
    g.append(el('path', { d, 'stroke-width': u() }, 'pen-preview'));
  }
  // Tunni lines (Direct Selection): drag to tune both handles of a curve,
  // double-click to balance them.
  if (state.tool === 'direct' && s !== penPath) {
    const count = s.closed ? s.nodes.length : s.nodes.length - 1;
    for (let seg = 0; seg < count; seg++) {
      const { b, c } = segmentAt(s.nodes, seg);
      if (!b || !c) continue;
      g.append(el('line', { x1: b[0], y1: b[1], x2: c[0], y2: c[1], 'stroke-width': u(), 'stroke-dasharray': `${3 * u()} ${3 * u()}` }, 'tunni'));
      const hit = el('line', { x1: b[0], y1: b[1], x2: c[0], y2: c[1], 'stroke-width': 10 * u() }, 'tunni-hit');
      Object.assign(hit.dataset, { tunni: String(seg), sid });
      g.append(hit);
    }
  }
  s.nodes.forEach((n, i) => {
    for (const part of ['in', 'out'] as const) {
      const h = n[part];
      if (!h) continue;
      g.append(el('line', { x1: n.p[0], y1: n.p[1], x2: h[0], y2: h[1], 'stroke-width': u() }, 'node-arm'));
      g.append(nodeTarget(h, sid, i, part, 'node-handle'));
    }
  });
  s.nodes.forEach((n, i) => {
    const closeTarget = s === penPath && i === 0 && s.nodes.length > 1;
    const picked = isAnchorSel(sid, i) ? ' picked' : '';
    g.append(nodeTarget(n.p, sid, i, 'p', 'node-point' + (closeTarget ? ' close-target' : '') + picked));
  });
  return g;
}

function nodeTarget([x, y]: Pt, sid: string, i: number, part: NodePart, cls: string) {
  const g = el('g', {}, cls);
  Object.assign(g.dataset, { sid, node: String(i), part });
  const r = (part === 'p' ? 3.5 : 3) * u();
  g.append(
    part === 'p'
      ? el('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, 'stroke-width': u() })
      : el('circle', { cx: x, cy: y, r, 'stroke-width': u() }),
    el('circle', { cx: x, cy: y, r: 12 * u() }, 'hit'),
  );
  return g;
}

// Point editing needs a real path: rect/ellipse/line/pencil become one on first edit.
function ensureBezier(id: string): BezierShape {
  const s = byId(id)!;
  if (s.type === 'bezier' && !s.rotation) return s;
  const b = toBezier(s);
  const list = containerOf(id)?.list ?? shapes(); // may be inside a boolean group
  list[list.indexOf(s)] = b;
  return b;
}

// ---- Gestures ------------------------------------------------------------

type Gesture =
  | { kind: 'pan'; start: Pt; x0: number; y0: number; wheel?: [number, number] }
  | { kind: 'marquee'; start: Pt; base: string[] }
  | { kind: 'move'; start: Pt; list: Shape[]; originals: Shape[]; box0: Box; alt: boolean; copied: boolean; dx: number; dy: number }
  | { kind: 'resize'; handle: Handle; list: Shape[]; originals: Shape[]; box0: Box }
  | { kind: 'rotate'; pivot: Pt; a0: number; list: Shape[]; originals: Shape[] }
  | { kind: 'create'; start: Pt; shape: Shape }
  | { kind: 'pen'; keepIn?: boolean }
  | { kind: 'tunni'; shape: BezierShape; seg: number; orig: BNode[]; start: Pt }
  | { kind: 'nodes'; lead: { sid: string; i: number }; items: { shape: BezierShape; i: number; orig: BNode }[]; leadOrig: Pt; sids: string[]; before: Map<string, BNode[]> }
  | { kind: 'node'; shape: BezierShape; original: BezierShape; node: number; part: NodePart }
  | { kind: 'convert'; shape: BezierShape; node: number; moved: boolean }
  | { kind: 'abMove'; ab: Artboard; start: Pt; x0: number; y0: number; artwork: Shape[]; originals: Shape[]; alt: boolean; copied: boolean }
  | { kind: 'abResize'; ab: Artboard; handle: AbHandle; orig: Artboard }
  | { kind: 'abCreate'; ab: Artboard; start: Pt };

let gesture: Gesture | null = null;
let spaceHeld = false;
export function setSpaceHeld(on: boolean) {
  spaceHeld = on;
  svg.classList.toggle('panning', on);
}

const pointers = new Map<number, Pt>(); // active touch points, in screen px
let pinch: { dist: number; mid: Pt } | null = null;

function screenPt(e: PointerEvent): Pt {
  const r = svg.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

// ---- Tablet mode: the pen draws, fingers navigate ------------------------------
// One finger pans, two pinch-zoom; a quick two-finger tap undoes, three redoes.
// Touches are ignored while the pen is down, and big contacts (a palm) never count.

const tabletOn = () => !!state.prefs.tabletMode;
let penContact = false;
const fingers = new Map<number, { start: Pt; at: Pt }>();
let nav: { mid: Pt; dist: number } | null = null;
let tap: { t0: number; max: number; moved: boolean } | null = null;

function fingerSpread() {
  const pts = [...fingers.values()].map((f) => f.at);
  const mid: Pt = [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
  const dist = pts.length > 1 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) : 0;
  return { mid, dist };
}

function fingerDown(e: PointerEvent) {
  if (penContact || Math.max(e.width, e.height) > 44) return;
  svg.setPointerCapture(e.pointerId);
  const sp = screenPt(e);
  if (!fingers.size) tap = { t0: e.timeStamp, max: 0, moved: false };
  fingers.set(e.pointerId, { start: sp, at: sp });
  if (tap) tap.max = Math.max(tap.max, fingers.size);
  nav = fingerSpread();
}

function fingerMove(e: PointerEvent) {
  const f = fingers.get(e.pointerId);
  if (!f || !nav) return;
  f.at = screenPt(e);
  if (tap && Math.hypot(f.at[0] - f.start[0], f.at[1] - f.start[1]) > 10) tap.moved = true;
  const { mid, dist } = fingerSpread();
  viewState.x += mid[0] - nav.mid[0];
  viewState.y += mid[1] - nav.mid[1];
  if (dist && nav.dist) zoomAt(dist / nav.dist, mid[0], mid[1]);
  else applyView();
  nav = { mid, dist };
}

function fingerUp(e: PointerEvent) {
  if (!fingers.delete(e.pointerId)) return;
  if (fingers.size) return void (nav = fingerSpread());
  nav = null;
  const t = tap;
  tap = null;
  if (!t || t.moved || e.type === 'pointercancel' || e.timeStamp - t.t0 > 350) return;
  if (t.max === 2) {
    undo();
    notify('Undo');
  } else if (t.max === 3) {
    redo();
    notify('Redo');
  }
}

function dropFingers() {
  fingers.clear();
  nav = tap = null;
}

svg.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'pen') {
    penSeen();
    penContact = e.button === 0;
    dropFingers(); // a palm that landed first doesn't keep panning
  }
  if (e.pointerType === 'touch' && tabletOn()) return fingerDown(e);
  if (e.pointerType === 'touch') {
    pointers.set(e.pointerId, screenPt(e));
    if (pointers.size === 2) {
      // Second finger: abandon whatever the first started, then pinch/pan.
      cancelGesture();
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    if (pointers.size > 2) return;
  }
  svg.setPointerCapture(e.pointerId);
  const p = eventPoint(e);
  const target = e.target as Element;
  const tool = state.tool;
  targetCache = null;
  guides = [];

  if (e.button === 1 || spaceHeld || tool === 'hand') {
    gesture = { kind: 'pan', start: screenPt(e), x0: viewState.x, y0: viewState.y };
    svg.classList.add('panning-active');
    return;
  }
  // Pen side button: drag to pan, click to open the tool wheel.
  if (e.pointerType === 'pen' && e.button === 2) {
    gesture = { kind: 'pan', start: screenPt(e), x0: viewState.x, y0: viewState.y, wheel: [e.clientX, e.clientY] };
    svg.classList.add('panning-active');
    return;
  }
  if (e.button !== 0) return;

  if (tool === 'zoom') {
    const [sx, sy] = screenPt(e);
    return zoomAt(altOn(e) ? 0.5 : 2, sx, sy);
  }

  // Artboards: corner handles, name labels, and the Artboard tool.
  const abHandle = target.closest<SVGElement>('[data-ab-handle]');
  if (abHandle) {
    const ab = activeArtboard();
    checkpoint();
    gesture = { kind: 'abResize', ab, handle: abHandle.dataset.abHandle as AbHandle, orig: { ...ab } };
    return;
  }
  const labelId = target.closest<SVGElement>('[data-artboard]')?.dataset.artboard;
  const bgId = target.closest<SVGElement>('[data-artboard-bg]')?.dataset.artboardBg;
  // A selected artboard also drags by its empty area (like a Figma frame).
  const dragBg = bgId && (tool === 'artboard' || (tool === 'select' && state.artboardSelected && bgId === state.activeArtboard));
  if (labelId || dragBg) {
    const ab = artboardById((labelId ?? bgId)!)!;
    setActiveArtboard(ab.id, true);
    checkpoint();
    const artwork = shapesOn(ab).filter((s) => !s.locked);
    gesture = { kind: 'abMove', ab, start: p, x0: ab.x, y0: ab.y, artwork, originals: structuredClone(artwork), alt: altOn(e), copied: false };
    emit();
    return;
  }
  if (tool === 'artboard') {
    checkpoint();
    const sp: Pt = [Math.round(p[0]), Math.round(p[1])];
    const ab = newArtboard(nextArtboardName(), sp[0], sp[1], 0);
    artboards().push(ab);
    setActiveArtboard(ab.id, true);
    gesture = { kind: 'abCreate', ab, start: sp };
    emit('live');
    return;
  }
  // Clicking anywhere on an artboard makes it the active one.
  state.artboardSelected = false;
  if (bgId) state.activeArtboard = bgId;

  // Audit marker: select the path it belongs to.
  const auditEl = target.closest<SVGElement>('[data-audit]');
  if (auditEl?.dataset.audit) {
    state.selection = [auditEl.dataset.audit];
    return emit();
  }

  // Tunni line.
  const tunniEl = target.closest<SVGElement>('[data-tunni]');
  if (tunniEl?.dataset.sid && !penPath) {
    checkpoint();
    const s = ensureBezier(tunniEl.dataset.sid);
    gesture = { kind: 'tunni', shape: s, seg: Number(tunniEl.dataset.tunni), orig: structuredClone(s.nodes), start: p };
    return;
  }

  // Anchor points and handles.
  const nodeEl = target.closest<SVGElement>('[data-node]');
  if (nodeEl && !penPath && nodeEl.dataset.sid) {
    const sid = nodeEl.dataset.sid;
    const i = Number(nodeEl.dataset.node);
    const part = nodeEl.dataset.part as NodePart;
    if (tool === 'direct' && part === 'p') return startAnchorDrag(sid, i, p, shiftOn(e));
    checkpoint();
    const s = ensureBezier(sid);
    if (tool === 'deleteAnchor' && part === 'p') {
      // Like Illustrator: remove the point but keep the curve's shape.
      if (s.nodes.length > 2) removeAnchorSmooth(s, i);
      return finish();
    }
    if (tool === 'convertAnchor' && part === 'p') {
      gesture = { kind: 'convert', shape: s, node: i, moved: false };
      return;
    }
    gesture = { kind: 'node', shape: s, original: structuredClone(s), node: i, part };
    return;
  }

  if (tool === 'pen') return penDown(p, shiftOn(e));

  const shapeEl = target.closest<SVGElement>('[data-id]');
  const hitId = shapeEl?.dataset.id ?? null;

  if (tool === 'addAnchor') {
    const id = hitId ?? state.selection[0];
    if (!id) return;
    checkpoint();
    const s = ensureBezier(id);
    const near = nearestOnPath(s, p);
    if (near.dist < 10 * u()) splitSegment(s, near.seg, near.t);
    state.selection = [s.id];
    return finish();
  }

  // Bounding-box handles and rotate zones.
  const handleEl = target.closest<SVGElement>('[data-handle], [data-rotate]');
  if (handleEl && state.selection.length) {
    const list = selected().filter((s) => !s.locked);
    if (!list.length) return;
    checkpoint();
    const originals = structuredClone(list);
    if (handleEl.dataset.rotate) {
      const box = list.length === 1 ? bbox(list[0]) : unionBox(list.map(worldBox));
      const pivot = center(box);
      gesture = { kind: 'rotate', pivot, a0: angle(pivot, p), list, originals };
    } else {
      const box0 = list.length === 1 ? bbox(list[0]) : unionBox(list.map(worldBox));
      gesture = { kind: 'resize', handle: handleEl.dataset.handle as Handle, list, originals, box0 };
    }
    return;
  }

  if (tool === 'select' || pointTools.has(tool)) {
    if (hitId) {
      const c = center(worldBox(byId(hitId)!));
      const owner = artboards().find((a) => inside(a, c));
      if (owner) state.activeArtboard = owner.id;
      if (shiftOn(e)) {
        state.selection = isSelected(hitId) ? state.selection.filter((id) => id !== hitId) : [...state.selection, hitId];
        emit();
        if (!isSelected(hitId)) return;
      } else if (!isSelected(hitId)) {
        state.selection = [hitId];
      }
      if (!shiftOn(e)) state.anchors = [];
      const list = selected().filter((s) => !s.locked);
      checkpoint();
      gesture = { kind: 'move', start: p, list, originals: structuredClone(list), box0: unionBox(list.map(worldBox)), alt: altOn(e), copied: false, dx: 0, dy: 0 };
      emit();
    } else {
      gesture = { kind: 'marquee', start: p, base: shiftOn(e) ? [...state.selection] : [] };
      if (!shiftOn(e)) state.anchors = [];
      if (!shiftOn(e) && state.selection.length) {
        state.selection = [];
        emit();
      }
    }
    return;
  }

  // Shape tools.
  checkpoint();
  const sp = smartPoint(p);
  const style = { ...state.prefs.style };
  const id = newId();
  let shape: Shape;
  if (tool === 'rect') shape = { id, type: 'rect', x: sp[0], y: sp[1], w: 0, h: 0, r: state.prefs.materialMode ? ICON_STYLES[state.doc.iconStyle ?? 'outlined'].radius : 0, ...style };
  else if (tool === 'ellipse') shape = { id, type: 'ellipse', cx: sp[0], cy: sp[1], rx: 0, ry: 0, ...style };
  else if (tool === 'line') shape = { id, type: 'line', x1: sp[0], y1: sp[1], x2: sp[0], y2: sp[1], ...lineStyle(style) };
  else shape = { id, type: 'path', points: [p], ...lineStyle(style), fill: 'none' };
  shape.name = nextName(shape.type);
  shapes().push(shape);
  state.selection = [id];
  gesture = { kind: 'create', start: sp, shape };
  emit('live');
});

// Lines and pencil strokes need a visible stroke even if the current style has none.
function lineStyle(style: typeof state.prefs.style) {
  return style.strokeWidth > 0 ? style : { ...style, stroke: style.stroke === 'none' ? '#000000' : style.stroke, strokeWidth: 1 };
}

const angle = (c: Pt, p: Pt) => (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;

svg.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && tabletOn()) return fingerMove(e);
  if (e.pointerType === 'touch' && pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, screenPt(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      viewState.x += mid[0] - pinch.mid[0];
      viewState.y += mid[1] - pinch.mid[1];
      pinch.mid = mid;
      zoomAt(dist / pinch.dist, mid[0], mid[1]);
      pinch.dist = dist;
      return;
    }
  }

  const p = eventPoint(e);
  const g = gesture;
  if (!g) {
    // Hover feedback.
    const id = (e.target as Element).closest<SVGElement>('[data-id]')?.dataset.id ?? null;
    const showHover = state.tool === 'select' || pointTools.has(state.tool);
    const next = showHover ? id : null;
    if (penPath) {
      penHover = shiftOn(e) ? snapPt(constrain45(penPath.nodes[penPath.nodes.length - 1].p, p)) : smartPoint(p);
      render();
    } else if (next !== hoverId) {
      hoverId = next;
      render();
    }
    return;
  }

  switch (g.kind) {
    case 'abMove': {
      const dx = Math.round(p[0] - g.start[0]);
      const dy = Math.round(p[1] - g.start[1]);
      if (g.alt && !g.copied && (dx || dy)) {
        // Alt-drag: the original stays put and a copy (with its artwork) moves.
        g.artwork.forEach((s, i) => Object.assign(s, structuredClone(g.originals[i])));
        const copy: Artboard = { ...g.ab, x: g.x0, y: g.y0, id: newId(), name: `${g.ab.name}_copy` };
        Object.assign(g.ab, { x: g.x0, y: g.y0 });
        const copies = structuredClone(g.originals).map(withNewIds);
        shapes().push(...copies);
        artboards().splice(artboards().indexOf(g.ab) + 1, 0, copy);
        Object.assign(g, { ab: copy, artwork: copies, originals: structuredClone(copies), copied: true });
        setActiveArtboard(copy.id, true);
      }
      g.ab.x = g.x0 + dx;
      g.ab.y = g.y0 + dy;
      g.artwork.forEach((s, i) => moveShape(s, g.originals[i], dx, dy));
      break;
    }
    case 'abResize':
      resizeArtboard(g, p, shiftOn(e));
      break;
    case 'abCreate': {
      let [x, y] = [Math.round(p[0]), Math.round(p[1])];
      if (shiftOn(e)) {
        const m = Math.max(Math.abs(x - g.start[0]), Math.abs(y - g.start[1]));
        x = g.start[0] + Math.sign(x - g.start[0] || 1) * m;
        y = g.start[1] + Math.sign(y - g.start[1] || 1) * m;
      }
      Object.assign(g.ab, fromPoints([g.start, [x, y]]));
      break;
    }
    case 'pan': {
      const [sx, sy] = screenPt(e);
      viewState.x = g.x0 + sx - g.start[0];
      viewState.y = g.y0 + sy - g.start[1];
      applyView();
      return;
    }
    case 'marquee': {
      marquee = fromPoints([g.start, p]);
      const hits = shapes()
        .filter((s) => !s.hidden && !s.locked && intersects(worldBox(s), marquee!))
        .map((s) => s.id);
      state.selection = [...new Set([...g.base, ...hits])];
      if (state.tool === 'direct') {
        // Direct Selection marquee selects the anchor points inside it.
        state.anchors = [];
        for (const s of shapes()) {
          if (s.hidden || s.locked) continue;
          toBezier(s).nodes.forEach((n, i) => inside(marquee!, n.p) && state.anchors.push({ sid: s.id, i }));
        }
        state.selection = [...new Set([...g.base, ...state.anchors.map((a) => a.sid)])];
      }
      break;
    }
    case 'move': {
      let dx = p[0] - g.start[0];
      let dy = p[1] - g.start[1];
      if (shiftOn(e)) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      // Smart guides first; otherwise snap the selection's corner to the grid.
      const sg = smartOn() ? snapBox({ ...g.box0, x: g.box0.x + dx, y: g.box0.y + dy }, targets(g.list.map((x) => x.id)), viewState.zoom) : null;
      guides = sg?.guides ?? [];
      dx = sg?.dx != null ? dx + sg.dx : snap(g.box0.x + dx) - g.box0.x;
      dy = sg?.dy != null ? dy + sg.dy : snap(g.box0.y + dy) - g.box0.y;
      if (g.alt && !g.copied && (dx || dy)) {
        // Alt-drag: leave the originals in place and move copies.
        g.list.forEach((s, i) => Object.assign(s, structuredClone(g.originals[i])));
        const copies = duplicateSelection();
        state.selection = copies.map((s) => s.id);
        g.list = copies;
        g.copied = true;
      }
      g.list.forEach((s, i) => moveShape(s, g.originals[i], dx, dy));
      g.dx = dx;
      g.dy = dy;
      break;
    }
    case 'resize':
      resize(g, p, shiftOn(e), altOn(e));
      break;
    case 'rotate': {
      let delta = angle(g.pivot, p) - g.a0;
      const base = g.list.length === 1 ? (g.originals[0].rotation ?? 0) : 0;
      let abs = base + delta;
      const nearest = Math.round(abs / 15) * 15;
      // Shift locks to 15° steps; otherwise it gently snaps when close to one.
      abs = shiftOn(e) || Math.abs(abs - nearest) < 2 ? nearest : Math.round(abs);
      delta = abs - base;
      rotateShapes(g.list, g.originals, delta, g.pivot);
      break;
    }
    case 'create':
      if (g.shape.type === 'path') {
        // Every sample the pen reported, not just one per frame: smoother Pencil curves.
        for (const c of e.getCoalescedEvents?.() ?? [e]) g.shape.points.push(eventPoint(c));
        break;
      }
      drawShape(g, smartPoint(p, [g.shape.id]), shiftOn(e), altOn(e));
      break;
    case 'pen':
      penDrag(smartPoint(p, [], undefined, false), altOn(e), g.keepIn);
      break;
    case 'node':
      editNode(g, p, shiftOn(e), altOn(e));
      break;
    case 'nodes':
      moveAnchors(g, p, shiftOn(e));
      break;
    case 'tunni': {
      const { n0, n1 } = segmentAt(g.shape.nodes, g.seg);
      const o = segmentAt(g.orig, g.seg);
      dragTunni(n0, n1, o.n0, o.n1, [p[0] - g.start[0], p[1] - g.start[1]]);
      break;
    }
    case 'convert': {
      // Convert Anchor drag: pull out fresh symmetric handles.
      const n = g.shape.nodes[g.node];
      g.moved = true;
      n.out = p;
      n.in = [2 * n.p[0] - p[0], 2 * n.p[1] - p[1]];
      n.smooth = true;
      break;
    }
  }
  emit('live');
});

function endGesture(e: PointerEvent) {
  if (e.pointerType === 'pen') penContact = false;
  if (e.pointerType === 'touch' && tabletOn()) return fingerUp(e);
  if (e.pointerType === 'touch') {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
  }
  const g = gesture;
  gesture = null;
  guides = [];
  targetCache = null;
  svg.classList.remove('panning-active');
  if (!g) return;
  switch (g.kind) {
    case 'pan': {
      const [sx, sy] = screenPt(e);
      if (g.wheel && Math.hypot(sx - g.start[0], sy - g.start[1]) < 6) openToolWheel(...g.wheel);
      return;
    }
    case 'abCreate':
      if (g.ab.w < 1 || g.ab.h < 1) {
        // A click with the Artboard tool doesn't leave an empty artboard.
        artboards().splice(artboards().indexOf(g.ab), 1);
        setActiveArtboard(artboards()[0].id);
        dropCheckpoint();
        return finish(false);
      }
      break;
    case 'marquee':
      marquee = null;
      return finish(false);
    case 'move':
      if (g.dx || g.dy) state.lastTransform = { dx: g.dx, dy: g.dy, copy: g.copied };
      break;
    case 'create': {
      const s = g.shape;
      if (isEmpty(s)) {
        // A click without a drag doesn't leave an empty shape behind.
        state.doc.shapes = shapes().filter((x) => x !== s);
        state.selection = [];
        dropCheckpoint();
        return finish(false);
      }
      if (s.type === 'path') pencilToCurve(s);
      break;
    }
    case 'convert': {
      const n = g.shape.nodes[g.node];
      if (!g.moved) {
        // Click: make it a sharp corner.
        delete n.in;
        delete n.out;
        n.smooth = false;
      }
      break;
    }
    case 'pen':
      return finish(false);
  }
  finish();
}
svg.addEventListener('pointerup', endGesture);
// No browser menu on the canvas (right-click, pen side button, long press).
svg.addEventListener('contextmenu', (e) => e.preventDefault());
svg.addEventListener('pointercancel', endGesture);

function finish(save = true) {
  if (save) discardIfUnchanged();
  commit();
}

// Undo a half-finished gesture (e.g. a second finger lands for a pinch).
function cancelGesture() {
  const g = gesture;
  gesture = null;
  marquee = null;
  if (!g) return;
  if (g.kind === 'create') {
    state.doc.shapes = shapes().filter((s) => s !== g.shape);
    state.selection = [];
    dropCheckpoint();
  } else if (g.kind === 'abCreate' || (g.kind === 'abMove' && g.copied)) {
    artboards().splice(artboards().indexOf(g.ab), 1);
    if (g.kind === 'abMove') state.doc.shapes = shapes().filter((s) => !g.artwork.includes(s));
    setActiveArtboard(artboards()[0].id);
    dropCheckpoint();
  } else if (g.kind === 'abMove') {
    Object.assign(g.ab, { x: g.x0, y: g.y0 });
    g.artwork.forEach((s, i) => Object.assign(s, structuredClone(g.originals[i])));
    dropCheckpoint();
  } else if (g.kind === 'abResize') {
    Object.assign(g.ab, g.orig);
    dropCheckpoint();
  } else if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'rotate') {
    if (g.kind === 'move' && g.copied) state.doc.shapes = shapes().filter((s) => !g.list.includes(s));
    else g.list.forEach((s, i) => Object.assign(s, structuredClone(g.originals[i])));
    dropCheckpoint();
  }
  emit();
}

svg.addEventListener('pointerleave', () => {
  if (hoverId && !gesture) {
    hoverId = null;
    render();
  }
});

// Trackpad pinch / Ctrl+wheel / Alt+wheel zoom; plain wheel pans (like Figma).
svg.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [sx, sy] = screenPt(e as unknown as PointerEvent);
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const k = Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025;
      zoomAt(Math.exp(-e.deltaY * k), sx, sy);
    } else {
      viewState.x -= e.shiftKey ? e.deltaY : e.deltaX;
      viewState.y -= e.shiftKey ? 0 : e.deltaY;
      applyView();
    }
  },
  { passive: false },
);

// Double-click a point with the Direct Selection tool: corner <-> smooth.
// ---- Inside boolean groups ---------------------------------------------------

// A group is "open" while something inside it is selected (like Figma).
function isOpen(g: BooleanShape) {
  return allShapes(g.children).some((c) => state.selection.includes(c.id));
}

// Outlines and click targets for the shapes inside an open group.
function groupInterior(g: BooleanShape): SVGGElement {
  const out = el('g', {}, 'group-interior');
  for (const c of g.children) {
    if (c.hidden) continue;
    const line = shapeGeometry(c);
    line.setAttribute('class', 'child-outline');
    line.setAttribute('stroke-width', String(u()));
    const hit = shapeGeometry(c);
    hit.setAttribute('class', 'child-hit');
    hit.setAttribute('stroke-width', String(Math.max(c.strokeWidth, 8 * u())));
    hit.dataset.id = c.id;
    out.append(line, hit);
    if (c.type === 'boolean' && isOpen(c)) out.append(groupInterior(c));
  }
  return out;
}

// The innermost shape of a group under a point (tested against real geometry).
function childAt(g: BooleanShape, p: Pt): Shape | null {
  for (const c of [...g.children].reverse()) {
    if (c.hidden) continue;
    const probe = shapeGeometry(c) as SVGGeometryElement;
    probe.setAttribute('stroke-width', String(Math.max(c.strokeWidth, 6 * u())));
    world.append(probe);
    const pt = new DOMPoint(p[0], p[1]);
    const hit = probe.isPointInFill(pt) || probe.isPointInStroke(pt);
    probe.remove();
    if (hit) return c.type === 'boolean' ? (childAt(c, p) ?? c) : c;
  }
  return null;
}

svg.addEventListener('dblclick', (e) => {
  const tunniEl = (e.target as Element).closest<SVGElement>('[data-tunni]');
  if (tunniEl?.dataset.sid) {
    checkpoint();
    const s = ensureBezier(tunniEl.dataset.sid);
    const { n0, n1 } = segmentAt(s.nodes, Number(tunniEl.dataset.tunni));
    balanceTunni(n0, n1);
    return finish();
  }
  // Double-click a boolean group to select the shape inside it.
  const groupEl = (e.target as Element).closest<SVGElement>('[data-id]');
  const group = groupEl && byId(groupEl.dataset.id!);
  // Double-click an instance to jump to its component.
  if (group?.type === 'instance' && artboardById(group.ref)) {
    setActiveArtboard(group.ref, true);
    emit();
    return fitArtboard();
  }
  if (group?.type === 'boolean' && (state.tool === 'select' || pointTools.has(state.tool))) {
    const child = childAt(group, eventPoint(e));
    if (child) {
      state.selection = [child.id];
      return emit();
    }
  }
  const nodeEl = (e.target as Element).closest<SVGElement>('[data-node]');
  if (!nodeEl?.dataset.sid || nodeEl.dataset.part !== 'p') return;
  checkpoint();
  const s = ensureBezier(nodeEl.dataset.sid);
  toggleSmooth(s, Number(nodeEl.dataset.node));
  finish();
});

function toggleSmooth(s: BezierShape, i: number) {
  const n = s.nodes[i];
  if (n.in || n.out) {
    delete n.in;
    delete n.out;
    n.smooth = false;
    return;
  }
  // Handles parallel to the line between the neighbouring points.
  const prev = s.nodes[(i - 1 + s.nodes.length) % s.nodes.length].p;
  const next = s.nodes[(i + 1) % s.nodes.length].p;
  const [vx, vy] = [(next[0] - prev[0]) / 6, (next[1] - prev[1]) / 6];
  n.in = [n.p[0] - vx, n.p[1] - vy];
  n.out = [n.p[0] + vx, n.p[1] + vy];
  n.smooth = true;
}

// ---- Shape tools -----------------------------------------------------------

// Shift: square / circle / 45° line. Alt: draw from the center (Illustrator).
function drawShape(g: Extract<Gesture, { kind: 'create' }>, snapped: Pt, shift: boolean, alt: boolean) {
  const s = g.shape;
  const [x0, y0] = g.start;
  let [x, y] = snapped;
  if (s.type === 'line') {
    if (shift) [x, y] = snapPt(constrain45(g.start, [x, y]));
    if (alt) Object.assign(s, { x1: 2 * x0 - x, y1: 2 * y0 - y });
    Object.assign(s, { x2: x, y2: y });
    return;
  }
  let w = x - x0;
  let h = y - y0;
  if (shift) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    [w, h] = [Math.sign(w || 1) * m, Math.sign(h || 1) * m];
  }
  const box = alt ? { x: x0 - Math.abs(w), y: y0 - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 } : fromPoints([g.start, [x0 + w, y0 + h]]);
  if (s.type === 'rect') Object.assign(s, box);
  else if (s.type === 'ellipse') Object.assign(s, { cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2 });
}

function constrain45(from: Pt, p: Pt): Pt {
  const [dx, dy] = [p[0] - from[0], p[1] - from[1]];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const d = Math.hypot(dx, dy);
  return [from[0] + Math.cos(a) * d, from[1] + Math.sin(a) * d];
}

// ---- Resize -----------------------------------------------------------------

// Shift keeps proportions, Alt resizes from the center. The opposite edge or
// corner stays put on screen, even for a rotated shape.
function resize(g: Extract<Gesture, { kind: 'resize' }>, p: Pt, keepRatio: boolean, fromCenter: boolean) {
  const single = g.list.length === 1;
  if (single && g.list[0].type === 'instance') keepRatio = true; // components keep their proportions
  const rot = single ? (g.originals[0].rotation ?? 0) : 0;
  const b = g.box0;
  const c = center(b);
  let [px, py] = rotate(p, -rot, c);
  if (!rot) [px, py] = smartPoint([px, py], g.list.map((s) => s.id));
  const h = g.handle;
  const affX = h.includes('w') || h.includes('e');
  const affY = h.includes('n') || h.includes('s');
  const anchor: Pt = [
    fromCenter || !affX ? c[0] : h.includes('w') ? b.x + b.w : b.x,
    fromCenter || !affY ? c[1] : h.includes('n') ? b.y + b.h : b.y,
  ];
  const k = fromCenter ? 2 : 1;
  let w = b.w ? (affX ? Math.max(Math.abs(px - anchor[0]) * k, 0.5) : b.w) : 0;
  let hh = b.h ? (affY ? Math.max(Math.abs(py - anchor[1]) * k, 0.5) : b.h) : 0;
  if (keepRatio && b.w && b.h) {
    const r = affX && affY ? Math.max(w / b.w, hh / b.h) : affX ? w / b.w : hh / b.h;
    [w, hh] = [b.w * r, b.h * r];
  }
  const place = (aff: boolean, a: number, ptr: number, len: number) => (fromCenter || !aff ? a - len / 2 : ptr < a ? a - len : a);
  const nb: Box = { x: place(affX, anchor[0], px, w), y: place(affY, anchor[1], py, hh), w, h: hh };
  if (single) scaleShape(g.list[0], g.originals[0], b, nb);
  else scaleShapes(g.list, g.originals, b, nb);

  if (rot) {
    // Rotation pivots around the new center; shift so the anchor doesn't move.
    const before = rotate(anchor, rot, c);
    const after = rotate(anchor, rot, center(nb));
    const s = g.list[0];
    moveShape(s, structuredClone(s), before[0] - after[0], before[1] - after[1]);
  }
}

// Artboard corners resize from the opposite corner, in whole pixels (Shift keeps proportions).
function resizeArtboard(g: Extract<Gesture, { kind: 'abResize' }>, p: Pt, keepRatio: boolean) {
  const o = g.orig;
  const ax = g.handle.includes('w') ? o.x + o.w : o.x;
  const ay = g.handle.includes('n') ? o.y + o.h : o.y;
  const [px, py] = [Math.round(p[0]), Math.round(p[1])];
  let w = Math.max(1, Math.abs(px - ax));
  let h = Math.max(1, Math.abs(py - ay));
  if (keepRatio) {
    const k = Math.max(w / o.w, h / o.h);
    [w, h] = [Math.max(1, Math.round(o.w * k)), Math.max(1, Math.round(o.h * k))];
  }
  Object.assign(g.ab, { x: px < ax ? ax - w : ax, y: py < ay ? ay - h : ay, w, h });
}

// ---- Pen tool ---------------------------------------------------------------

const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 10 * u();

export function finishPen(closed = false) {
  const s = penPath;
  if (!s) return;
  penPath = null;
  penHover = null;
  gesture = null;
  if (s.nodes.length < 2) {
    state.doc.shapes = shapes().filter((x) => x !== s);
    state.selection = [];
    dropCheckpoint();
  } else {
    s.closed = closed;
    if (!closed) {
      // Open paths are line art.
      s.fill = 'none';
      Object.assign(s, lineStyle(s));
    }
  }
  commit();
}

export function penBackspace(): boolean {
  if (!penPath) return false;
  penPath.nodes.pop();
  if (!penPath.nodes.length) finishPen();
  else emit('live');
  return true;
}

export const isDrawingPath = () => !!penPath;

// Open-path endpoints under the pointer, for continuing or joining paths.
function openEndpointAt(p: Pt, skipId?: string): { sid: string; end: 'start' | 'end' } | null {
  for (const s of [...shapes()].reverse()) {
    if (s.hidden || s.locked || s.id === skipId) continue;
    const b = toBezier(s);
    if (b.closed || b.nodes.length < 2) continue;
    if (near(p, b.nodes[0].p)) return { sid: s.id, end: 'start' };
    if (near(p, b.nodes[b.nodes.length - 1].p)) return { sid: s.id, end: 'end' };
  }
  return null;
}

function penDown(raw: Pt, shift: boolean) {
  if (penPath) {
    const nodes = penPath.nodes;
    const last = nodes[nodes.length - 1];
    const p = shift ? snapPt(constrain45(last.p, raw)) : smartPoint(raw);
    // Click the first point to close; click the last point again to finish open.
    if (nodes.length > 1 && near(p, nodes[0].p)) return finishPen(true);
    if (near(p, last.p)) return finishPen(false);
    // Click another open path's endpoint to join onto it.
    const hit = openEndpointAt(p, penPath.id);
    if (hit) {
      const other = ensureBezier(hit.sid);
      nodes.push(...(hit.end === 'start' ? other.nodes : reverseNodes(other.nodes)));
      state.doc.shapes = shapes().filter((s) => s !== other);
      return finishPen(false);
    }
    nodes.push({ p });
    gesture = { kind: 'pen' };
  } else {
    checkpoint();
    const p = smartPoint(raw);
    const hit = openEndpointAt(p);
    if (hit) {
      // Click an open path's endpoint to keep drawing from it (Illustrator).
      const s = ensureBezier(hit.sid);
      if (hit.end === 'start') s.nodes = reverseNodes(s.nodes);
      penPath = s;
      gesture = { kind: 'pen', keepIn: true };
    } else {
      penPath = { id: newId(), type: 'bezier', nodes: [{ p }], closed: false, ...state.prefs.style };
      penPath.name = nextName('bezier');
      shapes().push(penPath);
      gesture = { kind: 'pen' };
    }
    state.selection = [penPath.id];
  }
  emit('live');
}

// Dragging while placing a point pulls out symmetric handles; Alt breaks them.
// When continuing an existing path, its incoming handle is kept.
function penDrag(p: Pt, alt: boolean, keepIn = false) {
  const n = penPath!.nodes[penPath!.nodes.length - 1];
  if (near(p, n.p)) {
    if (!keepIn) delete n.in;
    delete n.out;
    n.smooth = false;
    return;
  }
  n.out = p;
  if (keepIn && n.in) {
    n.smooth = false;
    return;
  }
  if (!alt || !n.in) n.in = [2 * n.p[0] - p[0], 2 * n.p[1] - p[1]];
  n.smooth = !alt;
}

// ---- Direct Selection: anchor points ----------------------------------------

const isAnchorSel = (sid: string, i: number) => state.anchors.some((a) => a.sid === sid && a.i === i);

// Click selects one point (Shift toggles); dragging moves every selected point.
function startAnchorDrag(sid: string, i: number, p: Pt, shift: boolean) {
  if (shift) {
    state.anchors = isAnchorSel(sid, i) ? state.anchors.filter((a) => !(a.sid === sid && a.i === i)) : [...state.anchors, { sid, i }];
    if (!isAnchorSel(sid, i)) return emit();
  } else if (!isAnchorSel(sid, i)) {
    state.anchors = [{ sid, i }];
  }
  checkpoint();
  const sids = [...new Set(state.anchors.map((a) => a.sid))];
  const bez = new Map(sids.map((id) => [id, ensureBezier(id)]));
  const items = state.anchors.map((a) => ({ shape: bez.get(a.sid)!, i: a.i, orig: structuredClone(bez.get(a.sid)!.nodes[a.i]) }));
  state.selection = [...new Set([...state.selection, ...sids])];
  const before = new Map(sids.map((id) => [id, structuredClone(bez.get(id)!.nodes)]));
  gesture = { kind: 'nodes', lead: { sid, i }, items, leadOrig: [...bez.get(sid)!.nodes[i].p] as Pt, sids, before };
  emit();
}

function moveAnchors(g: Extract<Gesture, { kind: 'nodes' }>, p: Pt, shift: boolean) {
  const q = shift ? snapPt(constrain45(g.leadOrig, p)) : smartPoint(p, g.sids, g.lead);
  const [dx, dy] = [q[0] - g.leadOrig[0], q[1] - g.leadOrig[1]];
  const off = (v?: Pt): Pt | undefined => v && [v[0] + dx, v[1] + dy];
  for (const it of g.items) Object.assign(it.shape.nodes[it.i], { p: off(it.orig.p), in: off(it.orig.in), out: off(it.orig.out) });
  if (state.prefs.powerNudge) {
    for (const sid of g.sids) {
      const s = g.items.find((it) => it.shape.id === sid)!.shape;
      const moved = new Set(g.items.filter((it) => it.shape.id === sid).map((it) => it.i));
      powerAdjust(s.nodes, g.before.get(sid)!, moved, s.closed);
    }
  }
}

export function nudgeAnchors(dx: number, dy: number): boolean {
  if (state.tool !== 'direct' || !state.anchors.length) return false;
  checkpoint();
  const off = (v?: Pt): Pt | undefined => v && [v[0] + dx, v[1] + dy];
  for (const sid of new Set(state.anchors.map((a) => a.sid))) {
    const s = ensureBezier(sid);
    const before = structuredClone(s.nodes);
    const moved = new Set(state.anchors.filter((a) => a.sid === sid).map((a) => a.i));
    for (const i of moved) Object.assign(s.nodes[i], { p: off(s.nodes[i].p), in: off(s.nodes[i].in), out: off(s.nodes[i].out) });
    // Power Nudge: neighbouring curves keep their proportions.
    if (state.prefs.powerNudge) powerAdjust(s.nodes, before, moved, s.closed);
  }
  commit();
  return true;
}

// Delete selected points, keeping each curve's shape; a path left with fewer
// than two points is removed.
export function deleteAnchors(): boolean {
  if (state.tool !== 'direct' || !state.anchors.length) return false;
  checkpoint();
  const bySid = new Map<string, number[]>();
  for (const a of state.anchors) bySid.set(a.sid, [...(bySid.get(a.sid) ?? []), a.i]);
  for (const [sid, idx] of bySid) {
    const s = ensureBezier(sid);
    if (s.nodes.length - idx.length < 2) {
      state.doc.shapes = shapes().filter((x) => x !== s);
      continue;
    }
    for (const i of idx.sort((a, b) => b - a)) removeAnchorSmooth(s, i);
  }
  state.anchors = [];
  commit();
  return true;
}

// Object > Path > Join (Ctrl+J): one open path closes; two open paths join
// at their nearest endpoints.
export function joinPaths(): string | null {
  const sel = selected().filter((s) => !s.locked);
  const open = sel.filter((s) => {
    const b = toBezier(s);
    return !b.closed && b.nodes.length > 1;
  });
  if (open.length === 1 && sel.length === 1) {
    checkpoint();
    const s = ensureBezier(open[0].id);
    const [first, last] = [s.nodes[0], s.nodes[s.nodes.length - 1]];
    if (s.nodes.length > 2 && Math.hypot(first.p[0] - last.p[0], first.p[1] - last.p[1]) < 0.01) {
      first.in = last.in; // ends overlap: merge them
      s.nodes.pop();
    }
    s.closed = true;
    commit();
    return null;
  }
  if (open.length !== 2) return 'Select one or two open paths to join';
  checkpoint();
  const a = ensureBezier(open[0].id);
  const b = ensureBezier(open[1].id);
  // Pick the closest pair of endpoints, then orient a→b.
  const ends = (s: BezierShape) => [s.nodes[0].p, s.nodes[s.nodes.length - 1].p];
  const [a0, a1] = ends(a);
  const [b0, b1] = ends(b);
  const d = (u: Pt, v: Pt) => Math.hypot(u[0] - v[0], u[1] - v[1]);
  const options: [number, boolean, boolean][] = [
    [d(a1, b0), false, false],
    [d(a1, b1), false, true],
    [d(a0, b0), true, false],
    [d(a0, b1), true, true],
  ];
  const [dist, revA, revB] = options.sort((x, y) => x[0] - y[0])[0];
  if (revA) a.nodes = reverseNodes(a.nodes);
  const bn = revB ? reverseNodes(b.nodes) : b.nodes;
  if (dist < 0.01) {
    a.nodes[a.nodes.length - 1].out = bn[0].out;
    a.nodes.push(...bn.slice(1));
  } else a.nodes.push(...bn);
  state.doc.shapes = shapes().filter((s) => s !== b);
  state.selection = [a.id];
  commit();
  return null;
}

// Pencil strokes become smooth, editable curves.
function pencilToCurve(s: Extract<Shape, { type: 'path' }>) {
  const nodes = cubicsToNodes(fitCurve(s.points, 0.3));
  if (nodes.length < 2) return;
  const list = shapes();
  const { points: _pts, ...rest } = s;
  list[list.indexOf(s)] = { ...rest, type: 'bezier', nodes, closed: false };
}

function editNode(g: Extract<Gesture, { kind: 'node' }>, p: Pt, shift: boolean, alt: boolean) {
  const n: BNode = g.shape.nodes[g.node];
  const on = g.original.nodes[g.node];
  if (g.part === 'p') {
    // Move the point and carry its handles along.
    const q = shift ? snapPt(constrain45(on.p, p)) : smartPoint(p, [g.shape.id], { sid: g.shape.id, i: g.node });
    const [dx, dy] = [q[0] - on.p[0], q[1] - on.p[1]];
    n.p = q;
    n.in = on.in && [on.in[0] + dx, on.in[1] + dy];
    n.out = on.out && [on.out[0] + dx, on.out[1] + dy];
    return;
  }
  // Handles: Shift constrains to 45°, smart guides snap them to points.
  const h = shift ? constrain45(n.p, p) : smartPoint(p, [g.shape.id], { sid: g.shape.id, i: g.node }, false);
  n[g.part] = h;
  if (alt) {
    n.smooth = false; // Alt-drag breaks the handles apart (Illustrator)
    return;
  }
  const other: NodePart = g.part === 'in' ? 'out' : 'in';
  const o2 = on[other];
  if (n.smooth && o2) {
    // Keep the opposite handle pointing the other way, at its own length.
    const len = Math.hypot(o2[0] - on.p[0], o2[1] - on.p[1]);
    const [vx, vy] = [h[0] - n.p[0], h[1] - n.p[1]];
    const d = Math.hypot(vx, vy) || 1;
    n[other] = [n.p[0] - (vx / d) * len, n.p[1] - (vy / d) * len];
  }
}

// ---- Boot -------------------------------------------------------------------

export function setCursor() {
  svg.dataset.tool = state.tool;
}

subscribe(() => render());

// Fit the artboard the first time the canvas has a real size (it can start
// at 0×0 in a background tab), then just redraw on resizes.
let fitted = false;
let lastSize = screenSize();
if (lastSize.w) {
  fitted = true;
  fitArtboard();
}
new ResizeObserver(() => {
  const size = screenSize();
  if (!fitted && size.w && size.h) {
    fitted = true;
    fitArtboard();
  } else if (size.w && size.h && lastSize.w && lastSize.h) {
    // Keep whatever is in the middle of the view in the middle when the
    // window resizes, panels toggle (Tab) or a phone rotates.
    viewState.x += (size.w - lastSize.w) / 2;
    viewState.y += (size.h - lastSize.h) / 2;
    applyView();
  } else render();
  lastSize = size;
}).observe(svg);
