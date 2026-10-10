import './style.css';

// ---- Document model ----------------------------------------------------

type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'bezier' | 'freehand';

interface Style {
  fill: string; // 'none' or a color
  stroke: string;
  strokeWidth: number;
}

interface Base extends Style {
  id: string;
  name?: string;
  hidden?: boolean;
  rotation?: number; // degrees, around the shape's bounding-box center
}

type Shape =
  | (Base & { type: 'rect'; x: number; y: number; w: number; h: number })
  | (Base & { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
  | (Base & { type: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (Base & { type: 'path'; points: [number, number][] }) // freehand
  | (Base & { type: 'bezier'; nodes: BNode[]; closed: boolean });

type Pt = [number, number];

// A Bezier anchor point with optional absolute-position control handles.
interface BNode {
  p: Pt;
  in?: Pt;
  out?: Pt;
  smooth?: boolean; // handles stay collinear when one is dragged
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'rot';

const SIZES = [16, 24, 32, 48]; // artboard sizes in px (viewBox 0 0 size size)
const STORAGE_KEY = 'iconic:doc';
const SVG_NS = 'http://www.w3.org/2000/svg';

let { size, shapes } = load();
let selectedId: string | null = null;
let tool: Tool = 'rect';
const undoStack: string[] = [];
const redoStack: string[] = [];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = document.getElementById('canvas') as unknown as SVGSVGElement;
const fillInput = $<HTMLInputElement>('fill');
const strokeInput = $<HTMLInputElement>('stroke');
const strokeWidthInput = $<HTMLInputElement>('strokeWidth');
const noFillBtn = $<HTMLButtonElement>('noFill');
let noFill = false;

// ---- Persistence & history ---------------------------------------------

interface Doc {
  size: number;
  shapes: Shape[];
}

function load(): Doc {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(data)) return { size: 24, shapes: data }; // v0.1 format
    if (data && SIZES.includes(data.size)) return data;
  } catch {
    /* fall through to a blank doc */
  }
  return { size: 24, shapes: [] };
}

const snapshot = () => JSON.stringify({ size, shapes } satisfies Doc);

function restore(json: string) {
  ({ size, shapes } = JSON.parse(json) as Doc);
  selectedId = null;
  penPath = null;
  penHover = null;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, snapshot());
  } catch {
    /* storage unavailable; ignore */
  }
}

function checkpoint() {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(snapshot());
  restore(prev);
  commit();
}

function redo() {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(snapshot());
  restore(next);
  commit();
}

function commit() {
  save();
  render();
}

// ---- Rendering ---------------------------------------------------------

function shapeToElement(s: Shape): SVGElement {
  let el: SVGElement;
  switch (s.type) {
    case 'rect':
      el = document.createElementNS(SVG_NS, 'rect');
      setAttrs(el, { x: s.x, y: s.y, width: s.w, height: s.h });
      break;
    case 'ellipse':
      el = document.createElementNS(SVG_NS, 'ellipse');
      setAttrs(el, { cx: s.cx, cy: s.cy, rx: s.rx, ry: s.ry });
      break;
    case 'line':
      el = document.createElementNS(SVG_NS, 'line');
      setAttrs(el, { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
      break;
    case 'path':
      el = document.createElementNS(SVG_NS, 'path');
      setAttrs(el, { d: pointsToPath(s.points) });
      break;
    case 'bezier':
      el = document.createElementNS(SVG_NS, 'path');
      setAttrs(el, { d: bezierToPath(s.nodes, s.closed) });
      break;
  }
  setAttrs(el, {
    fill: s.type === 'line' ? 'none' : s.fill,
    stroke: s.strokeWidth > 0 ? s.stroke : 'none',
    'stroke-width': s.strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  if (s.rotation) {
    const [cx, cy] = center(bbox(s));
    setAttrs(el, { transform: `rotate(${round(s.rotation)} ${round(cx)} ${round(cy)})` });
  }
  el.dataset.id = s.id;
  return el;
}

// Bounding box in the shape's own (unrotated) frame.
function bbox(s: Shape): Box {
  switch (s.type) {
    case 'rect':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'ellipse':
      return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    case 'line':
      return fromPoints([[s.x1, s.y1], [s.x2, s.y2]]);
    case 'path':
      return fromPoints(s.points);
    case 'bezier':
      return bezierBox(s.nodes, s.closed);
  }
}

function fromPoints(pts: Pt[]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const center = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];

function rotate([x, y]: Pt, deg: number, [cx, cy]: Pt): Pt {
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

// Map shape geometry from box `a` onto box `b` (stroke width is unchanged).
function scaleShape(s: Shape, o: Shape, a: Box, b: Box) {
  const sx = a.w ? b.w / a.w : 1;
  const sy = a.h ? b.h / a.h : 1;
  const mx = (x: number) => b.x + (x - a.x) * sx;
  const my = (y: number) => b.y + (y - a.y) * sy;
  if (s.type === 'rect' && o.type === 'rect') Object.assign(s, { x: mx(o.x), y: my(o.y), w: o.w * sx, h: o.h * sy });
  else if (s.type === 'ellipse' && o.type === 'ellipse') Object.assign(s, { cx: mx(o.cx), cy: my(o.cy), rx: o.rx * sx, ry: o.ry * sy });
  else if (s.type === 'line' && o.type === 'line') Object.assign(s, { x1: mx(o.x1), y1: my(o.y1), x2: mx(o.x2), y2: my(o.y2) });
  else if (s.type === 'path' && o.type === 'path') s.points = o.points.map(([x, y]) => [mx(x), my(y)]);
  else if (s.type === 'bezier' && o.type === 'bezier') s.nodes = mapNodes(o.nodes, ([x, y]) => [mx(x), my(y)]);
}

// ---- Bezier geometry ---------------------------------------------------

function mapNodes(nodes: BNode[], f: (p: Pt) => Pt): BNode[] {
  return nodes.map((n) => ({ ...n, p: f(n.p), in: n.in && f(n.in), out: n.out && f(n.out) }));
}

// Each segment as [start, control1, control2, end].
function segments(nodes: BNode[], closed: boolean): [Pt, Pt, Pt, Pt][] {
  const segs: [Pt, Pt, Pt, Pt][] = [];
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    segs.push([a.p, a.out ?? a.p, b.in ?? b.p, b.p]);
  }
  return segs;
}

function bezierToPath(nodes: BNode[], closed: boolean) {
  if (!nodes.length) return '';
  const f = ([x, y]: Pt) => `${round(x)} ${round(y)}`;
  let d = `M${f(nodes[0].p)}`;
  for (const [, c1, c2, e] of segments(nodes, closed)) d += ` C${f(c1)} ${f(c2)} ${f(e)}`;
  return closed ? d + ' Z' : d;
}

// Exact bounds: anchor points plus each segment's extrema (where dx/dt or dy/dt = 0).
function bezierBox(nodes: BNode[], closed: boolean): Box {
  const pts: Pt[] = nodes.map((n) => n.p);
  for (const [a, b, c, d] of segments(nodes, closed)) {
    for (const axis of [0, 1]) {
      const A = -a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis];
      const B = 2 * (a[axis] - 2 * b[axis] + c[axis]);
      const C = b[axis] - a[axis];
      const roots = Math.abs(A) < 1e-9 ? (B ? [-C / B] : []) : quadRoots(A, B, C);
      for (const t of roots) if (t > 0 && t < 1) pts.push(cubicAt(a, b, c, d, t));
    }
  }
  return fromPoints(pts);
}

function quadRoots(a: number, b: number, c: number) {
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)];
}

function cubicAt(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((i) => w[0] * a[i] + w[1] * b[i] + w[2] * c[i] + w[3] * d[i]) as Pt;
}

// Node editing works in plain canvas coordinates, so fold any rotation into the points.
function bakeRotation(s: Shape) {
  if (s.type !== 'bezier' || !s.rotation) return;
  const c = center(bbox(s));
  const rot = s.rotation;
  s.nodes = mapNodes(s.nodes, (p) => rotate(p, rot, c));
  s.rotation = 0;
}

function setAttrs(el: Element, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(round(v)));
}

function round(v: string | number) {
  return typeof v === 'number' ? Math.round(v * 100) / 100 : v;
}

function pointsToPath(pts: [number, number][]) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join(' ');
}

function render() {
  canvas.replaceChildren();
  canvas.setAttribute('viewBox', `0 0 ${size} ${size}`);
  sizeSelect.value = String(size);
  // pixel grid (editor only, not exported)
  const grid = document.createElementNS(SVG_NS, 'g');
  grid.setAttribute('class', 'grid');
  for (let i = 1; i < size; i++) {
    const v = document.createElementNS(SVG_NS, 'line');
    setAttrs(v, { x1: i, y1: 0, x2: i, y2: size });
    const h = document.createElementNS(SVG_NS, 'line');
    setAttrs(h, { x1: 0, y1: i, x2: size, y2: i });
    grid.append(v, h);
  }
  canvas.append(grid);

  for (const s of shapes) if (!s.hidden) canvas.append(shapeToElement(s));

  const sel = shapes.find((s) => s.id === selectedId);
  if (penPath) canvas.append(nodeOverlay(penPath));
  else if (sel && !sel.hidden && drag?.mode !== 'create') {
    canvas.append(selectionOverlay(sel));
    if (sel.type === 'bezier' && tool === 'select') canvas.append(nodeOverlay(sel));
  }

  // Moving/resizing doesn't change the list, so skip rebuilding it mid-drag.
  if (!drag || drag.mode === 'create') renderLayers();
}

// Canvas units per screen pixel, so handles stay a constant on-screen size.
const unitsPerPx = () => size / canvas.getBoundingClientRect().width;

function selectionOverlay(s: Shape): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  const b = bbox(s);
  const [cx, cy] = center(b);
  if (s.rotation) g.setAttribute('transform', `rotate(${s.rotation} ${cx} ${cy})`);

  const u = unitsPerPx();
  const pad = s.strokeWidth / 2 + 6 * u; // sit just outside the stroke
  const box = document.createElementNS(SVG_NS, 'rect');
  setAttrs(box, { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, 'stroke-width': 1.5 * u });
  box.setAttribute('stroke-dasharray', `${6 * u} ${4 * u}`);
  box.setAttribute('class', 'selection');
  g.append(box);

  const rotY = b.y - pad - 24 * u;
  const stem = document.createElementNS(SVG_NS, 'line');
  setAttrs(stem, { x1: cx, y1: b.y - pad, x2: cx, y2: rotY, 'stroke-width': 1.5 * u });
  stem.setAttribute('class', 'selection');
  g.append(stem);

  const handles: [Handle, number, number][] = [
    ['nw', b.x - pad, b.y - pad],
    ['ne', b.x + b.w + pad, b.y - pad],
    ['sw', b.x - pad, b.y + b.h + pad],
    ['se', b.x + b.w + pad, b.y + b.h + pad],
    ['rot', cx, rotY],
  ];
  for (const [name, x, y] of handles) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    setAttrs(dot, { cx: x, cy: y, r: 6 * u, 'stroke-width': 2 * u });
    dot.setAttribute('class', 'handle-dot');
    // Invisible, larger circle on top: a ~32px touch target.
    const hit = document.createElementNS(SVG_NS, 'circle');
    setAttrs(hit, { cx: x, cy: y, r: 16 * u });
    hit.setAttribute('class', `handle handle-${name}`);
    hit.dataset.handle = name;
    g.append(dot, hit);
  }
  return g;
}

// ---- Pointer interaction (mouse, touch, pen) ---------------------------

function toCanvas(e: PointerEvent): [number, number] {
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(canvas.getScreenCTM()!.inverse());
  return [pt.x, pt.y];
}

const snap = (v: number) => Math.round(v * 2) / 2; // half-pixel snapping

function currentStyle(): Style {
  return {
    fill: noFill ? 'none' : fillInput.value,
    stroke: strokeInput.value,
    strokeWidth: Number(strokeWidthInput.value),
  };
}

interface Drag {
  mode: 'create' | 'move' | 'resize' | 'rotate' | 'pen' | 'node';
  start: Pt;
  shape: Shape;
  original: Shape; // snapshot at drag start
  handle?: Handle;
  node?: number; // node index for pen / node edits
  part?: NodePart;
}
let drag: Drag | null = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toCanvas(e);
  const [sx, sy] = [snap(p[0]), snap(p[1])];
  const selected = shapes.find((s) => s.id === selectedId);

  // Bezier points and control handles.
  const nodeEl = (e.target as Element).closest('[data-node]') as SVGElement | null;
  if (nodeEl && selected?.type === 'bezier' && !penPath) {
    checkpoint();
    bakeRotation(selected);
    const node = Number(nodeEl.dataset.node);
    const part = nodeEl.dataset.part as NodePart;
    if (part === 'p' && isDoubleTap(e, node)) {
      undoStack.pop();
      toggleSmooth(selected, node);
      return;
    }
    drag = { mode: 'node', node, part, start: p, shape: selected, original: structuredClone(selected) };
    return;
  }

  if (tool === 'bezier') {
    penDown([sx, sy]);
    return;
  }

  // Handles work with any tool, so a shape can be adjusted right after drawing it.
  const handle = (e.target as Element).closest('[data-handle]') as SVGElement | null;
  if (handle && selected) {
    checkpoint();
    const h = handle.dataset.handle as Handle;
    drag = { mode: h === 'rot' ? 'rotate' : 'resize', handle: h, start: p, shape: selected, original: structuredClone(selected) };
    return;
  }

  if (tool === 'select') {
    const target = (e.target as Element).closest('[data-id]') as SVGElement | null;
    selectedId = target?.dataset.id ?? null;
    const shape = shapes.find((s) => s.id === selectedId);
    if (shape) {
      checkpoint();
      drag = { mode: 'move', start: p, shape, original: structuredClone(shape) };
    }
    render();
    return;
  }

  checkpoint();
  const id = crypto.randomUUID();
  const style = currentStyle();
  let shape: Shape;
  if (tool === 'rect') shape = { id, type: 'rect', x: sx, y: sy, w: 0, h: 0, ...style };
  else if (tool === 'ellipse') shape = { id, type: 'ellipse', cx: sx, cy: sy, rx: 0, ry: 0, ...style };
  else if (tool === 'line') shape = { id, type: 'line', x1: sx, y1: sy, x2: sx, y2: sy, ...style };
  else shape = { id, type: 'path', points: [p], ...style, fill: 'none', strokeWidth: style.strokeWidth || 1 };
  shape.name = nextName(shape.type);
  shapes.push(shape);
  selectedId = id;
  drag = { mode: 'create', start: [sx, sy], shape, original: structuredClone(shape) };
  render();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (penPath) {
      penHover = toCanvas(e).map(snap) as Pt;
      render();
    }
    return;
  }
  const p = toCanvas(e);
  const { shape: s, original: o } = drag;

  if (drag.mode === 'pen') {
    penDrag(p);
  } else if (drag.mode === 'node') {
    editNode(s, o, drag.node!, drag.part!, p);
  } else if (drag.mode === 'move') {
    moveShape(s, o, snap(p[0] - drag.start[0]), snap(p[1] - drag.start[1]));
  } else if (drag.mode === 'resize') {
    resize(s, o, drag.handle!, p, e.shiftKey);
  } else if (drag.mode === 'rotate') {
    const [cx, cy] = center(bbox(o));
    let deg = (Math.atan2(p[1] - cy, p[0] - cx) * 180) / Math.PI + 90;
    const nearest = Math.round(deg / 15) * 15;
    // Shift locks to 15° steps; otherwise it gently snaps when close to one.
    deg = e.shiftKey || Math.abs(deg - nearest) < 3 ? nearest : Math.round(deg);
    s.rotation = ((deg % 360) + 360) % 360;
  } else {
    const [x, y] = [snap(p[0]), snap(p[1])];
    const [x0, y0] = drag.start;
    if (s.type === 'rect') Object.assign(s, { x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) });
    else if (s.type === 'ellipse') Object.assign(s, { cx: (x0 + x) / 2, cy: (y0 + y) / 2, rx: Math.abs(x - x0) / 2, ry: Math.abs(y - y0) / 2 });
    else if (s.type === 'line') Object.assign(s, { x2: x, y2: y });
    else if (s.type === 'path') s.points.push(p);
  }
  render();
});

// Resize by dragging a corner; the opposite corner stays fixed on screen,
// even when the shape is rotated.
function resize(s: Shape, o: Shape, h: Handle, p: Pt, keepRatio: boolean) {
  const b = bbox(o);
  const rot = o.rotation ?? 0;
  const c = center(b);
  let [px, py] = rotate(p, -rot, c); // pointer in the shape's local frame
  if (!rot) [px, py] = [snap(px), snap(py)];

  const anchor: Pt = [h.includes('w') ? b.x + b.w : b.x, h.includes('n') ? b.y + b.h : b.y];
  // Zero-width/height boxes (straight lines) only scale along their length.
  let w = b.w ? Math.max(Math.abs(px - anchor[0]), 0.5) : 0;
  let hgt = b.h ? Math.max(Math.abs(py - anchor[1]), 0.5) : 0;
  if (keepRatio && b.w && b.h) {
    const k = Math.max(w / b.w, hgt / b.h);
    [w, hgt] = [b.w * k, b.h * k];
  }
  const nb: Box = {
    x: b.w && px < anchor[0] ? anchor[0] - w : b.w ? anchor[0] : b.x,
    y: b.h && py < anchor[1] ? anchor[1] - hgt : b.h ? anchor[1] : b.y,
    w,
    h: hgt,
  };
  scaleShape(s, o, b, nb);

  if (rot) {
    // Rotation pivots around the new center; shift so the anchor doesn't move.
    const before = rotate(anchor, rot, c);
    const after = rotate(anchor, rot, center(nb));
    moveShape(s, structuredClone(s), before[0] - after[0], before[1] - after[1]);
  }
}

// ---- Bezier pen & node editing -----------------------------------------

type NodePart = 'p' | 'in' | 'out';
type BezierShape = Extract<Shape, { type: 'bezier' }>;

let penPath: BezierShape | null = null; // path currently being drawn
let penHover: Pt | null = null; // pointer position for the preview segment

const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 14 * unitsPerPx();

function penDown(p: Pt) {
  if (penPath) {
    const nodes = penPath.nodes;
    // Tap the first point to close, or the last point again to finish open.
    if (nodes.length > 1 && near(p, nodes[0].p)) return finishPen(true);
    if (near(p, nodes[nodes.length - 1].p)) return finishPen(false);
    nodes.push({ p });
  } else {
    checkpoint();
    penPath = { id: crypto.randomUUID(), type: 'bezier', nodes: [{ p }], closed: false, ...currentStyle() };
    penPath.name = nextName('bezier');
    shapes.push(penPath);
    selectedId = penPath.id;
  }
  drag = { mode: 'pen', start: p, shape: penPath, original: penPath };
  render();
}

// Dragging while placing a point pulls out symmetric handles (a smooth point).
function penDrag(p: Pt) {
  const n = penPath!.nodes[penPath!.nodes.length - 1];
  if (near(p, n.p)) {
    delete n.in;
    delete n.out;
    n.smooth = false;
    return;
  }
  n.out = p;
  n.in = [2 * n.p[0] - p[0], 2 * n.p[1] - p[1]];
  n.smooth = true;
}

function finishPen(closed: boolean) {
  const s = penPath;
  if (!s) return;
  penPath = null;
  penHover = null;
  if (s.nodes.length < 2) {
    shapes = shapes.filter((x) => x.id !== s.id);
    undoStack.pop();
    selectedId = null;
  } else {
    s.closed = closed;
    if (!closed) s.fill = 'none'; // open paths are line art
  }
  drag = null;
  commit();
}

function editNode(s: Shape, o: Shape, i: number, part: NodePart, p: Pt) {
  if (s.type !== 'bezier' || o.type !== 'bezier') return;
  const n = s.nodes[i];
  const on = o.nodes[i];
  if (part === 'p') {
    // Move the point and carry its handles along.
    const q: Pt = [snap(p[0]), snap(p[1])];
    const [dx, dy] = [q[0] - on.p[0], q[1] - on.p[1]];
    n.p = q;
    n.in = on.in && [on.in[0] + dx, on.in[1] + dy];
    n.out = on.out && [on.out[0] + dx, on.out[1] + dy];
    return;
  }
  n[part] = p;
  const other: NodePart = part === 'in' ? 'out' : 'in';
  const o2 = on[other];
  if (n.smooth && o2) {
    // Keep the opposite handle pointing the other way, at its own length.
    const len = Math.hypot(o2[0] - on.p[0], o2[1] - on.p[1]);
    const [vx, vy] = [p[0] - n.p[0], p[1] - n.p[1]];
    const d = Math.hypot(vx, vy) || 1;
    n[other] = [n.p[0] - (vx / d) * len, n.p[1] - (vy / d) * len];
  }
}

// Double-click (mouse) or double-tap (touch) a point: corner <-> smooth.
canvas.addEventListener('dblclick', (e) => {
  const el = (e.target as Element).closest('[data-node]') as SVGElement | null;
  const s = shapes.find((x) => x.id === selectedId);
  if (el?.dataset.part === 'p' && s?.type === 'bezier') toggleSmooth(s, Number(el.dataset.node));
});

let lastTap = { node: -1, time: 0 };
let lastToggle = 0;

function isDoubleTap(e: PointerEvent, node: number) {
  if (e.pointerType === 'mouse') return false; // mice get real dblclick events
  const double = lastTap.node === node && e.timeStamp - lastTap.time < 350;
  lastTap = { node, time: e.timeStamp };
  return double;
}

function toggleSmooth(s: BezierShape, i: number) {
  // Some touch browsers also fire dblclick after our own double-tap check.
  if (performance.now() - lastToggle < 500) return;
  lastToggle = performance.now();
  checkpoint();
  bakeRotation(s);
  const n = s.nodes[i];
  if (n.in || n.out) {
    delete n.in;
    delete n.out;
    n.smooth = false;
  } else {
    // Handles parallel to the line between the neighbouring points.
    const prev = s.nodes[(i - 1 + s.nodes.length) % s.nodes.length].p;
    const next = s.nodes[(i + 1) % s.nodes.length].p;
    const [vx, vy] = [(next[0] - prev[0]) / 6, (next[1] - prev[1]) / 6];
    n.in = [n.p[0] - vx, n.p[1] - vy];
    n.out = [n.p[0] + vx, n.p[1] + vy];
    n.smooth = true;
  }
  commit();
}

function nodeOverlay(s: BezierShape): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  const u = unitsPerPx();
  if (s.rotation) {
    const [cx, cy] = center(bbox(s));
    g.setAttribute('transform', `rotate(${s.rotation} ${cx} ${cy})`);
  }

  // Preview of the next segment while drawing.
  if (s === penPath && penHover && !drag) {
    const last = s.nodes[s.nodes.length - 1];
    const preview = document.createElementNS(SVG_NS, 'path');
    const c = last.out ?? last.p;
    setAttrs(preview, { d: `M${last.p[0]} ${last.p[1]} C${c[0]} ${c[1]} ${penHover[0]} ${penHover[1]} ${penHover[0]} ${penHover[1]}`, 'stroke-width': 1.5 * u });
    preview.setAttribute('class', 'pen-preview');
    g.append(preview);
  }

  s.nodes.forEach((n, i) => {
    for (const part of ['in', 'out'] as const) {
      const h = n[part];
      if (!h) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      setAttrs(line, { x1: n.p[0], y1: n.p[1], x2: h[0], y2: h[1], 'stroke-width': 1.5 * u });
      line.setAttribute('class', 'node-arm');
      g.append(line, nodeTarget(h, i, part, u, 'node-handle'));
    }
  });
  // Anchor points on top of the handles.
  s.nodes.forEach((n, i) => {
    const closeTarget = s === penPath && i === 0 && s.nodes.length > 1;
    g.append(nodeTarget(n.p, i, 'p', u, 'node-point' + (closeTarget ? ' close-target' : '')));
  });
  return g;
}

function nodeTarget([x, y]: Pt, i: number, part: NodePart, u: number, cls: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.dataset.node = String(i);
  g.dataset.part = part;
  g.setAttribute('class', cls);
  const dot = document.createElementNS(SVG_NS, part === 'p' ? 'rect' : 'circle');
  const r = (part === 'p' ? 5 : 4) * u;
  if (part === 'p') setAttrs(dot, { x: x - r, y: y - r, width: r * 2, height: r * 2, 'stroke-width': 1.5 * u });
  else setAttrs(dot, { cx: x, cy: y, r, 'stroke-width': 1.5 * u });
  const hit = document.createElementNS(SVG_NS, 'circle');
  setAttrs(hit, { cx: x, cy: y, r: 14 * u });
  hit.setAttribute('class', 'hit');
  g.append(dot, hit);
  return g;
}

function endDrag() {
  if (!drag) return;
  const s = drag.shape;
  if (drag.mode === 'create') {
    // Discard zero-size shapes from accidental taps.
    if (isEmpty(s)) {
      shapes = shapes.filter((x) => x.id !== s.id);
      undoStack.pop();
      selectedId = null;
    } else if (s.type === 'path') s.points = simplify(s.points, 0.15);
  }
  drag = null;
  // A click that changed nothing shouldn't cost an undo step.
  if (undoStack.at(-1) === snapshot()) undoStack.pop();
  commit();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function isEmpty(s: Shape) {
  if (s.type === 'rect') return s.w === 0 || s.h === 0;
  if (s.type === 'ellipse') return s.rx === 0 || s.ry === 0;
  if (s.type === 'line') return s.x1 === s.x2 && s.y1 === s.y2;
  if (s.type === 'bezier') return s.nodes.length < 2;
  return s.points.length < 2;
}

function moveShape(s: Shape, o: Shape, dx: number, dy: number) {
  if (s.type === 'rect' && o.type === 'rect') Object.assign(s, { x: o.x + dx, y: o.y + dy });
  else if (s.type === 'ellipse' && o.type === 'ellipse') Object.assign(s, { cx: o.cx + dx, cy: o.cy + dy });
  else if (s.type === 'line' && o.type === 'line') Object.assign(s, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
  else if (s.type === 'path' && o.type === 'path') s.points = o.points.map(([x, y]) => [x + dx, y + dy]);
  else if (s.type === 'bezier' && o.type === 'bezier') s.nodes = mapNodes(o.nodes, ([x, y]) => [x + dx, y + dy]);
}

// Ramer–Douglas–Peucker: thin out freehand points.
function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], a, b);
    if (d > maxD) [maxD, idx] = [d, i];
  }
  if (maxD <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

function distToSegment([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const [dx, dy] = [bx - ax, by - ay];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---- Toolbar -----------------------------------------------------------

function setTool(t: Tool) {
  if (t !== 'bezier') finishPen(false);
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  if (t !== 'select') selectedId = null;
  render();
}

document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));

// Style controls also restyle the selected shape.
function applyStyleToSelection() {
  const s = shapes.find((x) => x.id === selectedId);
  if (!s) return;
  checkpoint();
  Object.assign(s, currentStyle());
  if (s.type === 'path') s.fill = 'none';
  commit();
}
fillInput.addEventListener('change', applyStyleToSelection);
strokeInput.addEventListener('change', applyStyleToSelection);
strokeWidthInput.addEventListener('change', applyStyleToSelection);
noFillBtn.addEventListener('click', () => {
  noFill = !noFill;
  noFillBtn.classList.toggle('active', noFill);
  applyStyleToSelection();
});

function deleteSelected() {
  if (!selectedId) return;
  checkpoint();
  shapes = shapes.filter((s) => s.id !== selectedId);
  selectedId = null;
  commit();
}

$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('delete').addEventListener('click', deleteSelected);
$('clear').addEventListener('click', () => {
  if (!shapes.length || !confirm('Start a new icon? (You can undo this.)')) return;
  checkpoint();
  shapes = [];
  selectedId = null;
  commit();
});

document.addEventListener('keydown', (e) => {
  if ((e.target as Element).tagName === 'INPUT') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') (e.shiftKey ? redo : undo)(), e.preventDefault();
  else if (mod && e.key.toLowerCase() === 'y') redo(), e.preventDefault();
  else if (mod && e.key === ']') reorderSelected(1), e.preventDefault();
  else if (mod && e.key === '[') reorderSelected(-1), e.preventDefault();
  else if (penPath && (e.key === 'Enter' || e.key === 'Escape')) finishPen(false);
  else if (penPath && e.key === 'Backspace') {
    penPath.nodes.pop();
    if (!penPath.nodes.length) finishPen(false);
    else commit();
  } else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  else if (!mod) {
    const map: Record<string, Tool> = { v: 'select', r: 'rect', e: 'ellipse', l: 'line', p: 'bezier', f: 'freehand' };
    const t = map[e.key.toLowerCase()];
    if (t) setTool(t);
  }
});

// ---- Layers ------------------------------------------------------------

const TYPE_LABEL: Record<Shape['type'], string> = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', path: 'Freehand', bezier: 'Path' };

function nextName(type: Shape['type']) {
  return `${TYPE_LABEL[type]} ${shapes.filter((s) => s.type === type).length + 1}`;
}

const layerList = $<HTMLUListElement>('layerList');
let renamingId: string | null = null;

function renderLayers() {
  if (renamingId) return; // don't steal focus from the rename field
  layerList.replaceChildren();
  if (!shapes.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Draw a shape to get started';
    layerList.append(empty);
    return;
  }
  // Topmost shape first, like most design tools.
  [...shapes].reverse().forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'layer' + (s.id === selectedId ? ' selected' : '') + (s.hidden ? ' is-hidden' : '');
    li.dataset.id = s.id;
    const top = i === 0;
    const bottom = i === shapes.length - 1;
    li.innerHTML = `
      <button class="eye" data-act="toggle" title="${s.hidden ? 'Show' : 'Hide'}">${s.hidden ? '◌' : '●'}</button>
      <span class="name"></span>
      <button data-act="up" title="Bring forward" ${top ? 'disabled' : ''}>▲</button>
      <button data-act="down" title="Send backward" ${bottom ? 'disabled' : ''}>▼</button>`;
    li.querySelector('.name')!.textContent = s.name ?? TYPE_LABEL[s.type];
    layerList.append(li);
  });
}

layerList.addEventListener('click', (e) => {
  const li = (e.target as Element).closest<HTMLLIElement>('li.layer');
  if (!li) return;
  const id = li.dataset.id!;
  const act = (e.target as Element).closest<HTMLButtonElement>('button')?.dataset.act;
  const idx = shapes.findIndex((s) => s.id === id);

  if (act === 'toggle') {
    checkpoint();
    shapes[idx].hidden = !shapes[idx].hidden;
  } else if (act === 'up' || act === 'down') {
    const to = act === 'up' ? idx + 1 : idx - 1; // later in the array = drawn on top
    if (to < 0 || to >= shapes.length) return;
    checkpoint();
    [shapes[idx], shapes[to]] = [shapes[to], shapes[idx]];
    selectedId = id;
  } else if ((e.target as Element).closest('.name') && selectedId === id) {
    startRename(li, shapes[idx]);
    return;
  } else {
    selectedId = id;
    render();
    return;
  }
  commit();
});

// Tap a selected layer's name (or double-click) to rename it.
layerList.addEventListener('dblclick', (e) => {
  if (renamingId) return;
  const li = (e.target as Element).closest<HTMLLIElement>('li.layer');
  const s = shapes.find((x) => x.id === li?.dataset.id);
  if (li && s) startRename(li, s);
});

function startRename(li: HTMLLIElement, s: Shape) {
  renamingId = s.id;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = s.name ?? TYPE_LABEL[s.type];
  li.querySelector('.name')!.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    renamingId = null;
    const name = input.value.trim();
    if (save && name && name !== s.name) {
      checkpoint();
      s.name = name;
    }
    commit();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function reorderSelected(delta: 1 | -1) {
  const idx = shapes.findIndex((s) => s.id === selectedId);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= shapes.length) return;
  checkpoint();
  [shapes[idx], shapes[to]] = [shapes[to], shapes[idx]];
  commit();
}

const layersPanel = $<HTMLElement>('layers');
const layersBtn = $<HTMLButtonElement>('toggleLayers');
function setLayersOpen(open: boolean) {
  layersPanel.hidden = !open;
  layersBtn.classList.toggle('active', open);
  try {
    localStorage.setItem('iconic:layersOpen', open ? '1' : '0');
  } catch {
    /* ignore */
  }
}
layersBtn.addEventListener('click', () => setLayersOpen(layersPanel.hidden));
{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('iconic:layersOpen');
  } catch {
    /* ignore */
  }
  // Open by default on wide screens, closed on phones.
  setLayersOpen(saved ? saved === '1' : matchMedia('(min-width: 700px)').matches);
}

// ---- Artboard size -----------------------------------------------------

const sizeSelect = $<HTMLSelectElement>('size');
sizeSelect.replaceChildren(...SIZES.map((n) => new Option(`${n}px`, String(n))));

// Changing size scales the artwork (including strokes) so the icon looks the same.
sizeSelect.addEventListener('change', () => {
  const next = Number(sizeSelect.value);
  if (next === size) return;
  checkpoint();
  const from: Box = { x: 0, y: 0, w: size, h: size };
  const to: Box = { x: 0, y: 0, w: next, h: next };
  for (const s of shapes) {
    scaleShape(s, structuredClone(s), from, to);
    s.strokeWidth *= next / size;
  }
  size = next;
  commit();
});

// ---- Export ------------------------------------------------------------

function exportSvgString() {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('viewBox', `0 0 ${size} ${size}`);
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  for (const s of shapes) {
    if (s.hidden) continue;
    const el = shapeToElement(s);
    el.removeAttribute('data-id');
    root.append(el);
  }
  return new XMLSerializer().serializeToString(root);
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('exportSvg').addEventListener('click', () => download(new Blob([exportSvgString()], { type: 'image/svg+xml' }), 'icon.svg'));

async function renderPng(px: number): Promise<Blob> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSvgString());
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = px;
  c.getContext('2d')!.drawImage(img, 0, 0, px, px);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const PNG_PREF_KEY = 'iconic:pngSizes';
const pngDialog = $<HTMLDialogElement>('pngDialog');
const pngSizesBox = $<HTMLDivElement>('pngSizes');

function savedPngSizes(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(PNG_PREF_KEY) || 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch {
    /* ignore */
  }
  return [512];
}

$('exportPng').addEventListener('click', () => {
  const chosen = savedPngSizes();
  pngSizesBox.replaceChildren(
    ...PNG_SIZES.map((n) => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${n}" ${chosen.includes(n) ? 'checked' : ''} /> ${n}`;
      return label;
    }),
  );
  pngDialog.showModal();
});

$('pngCancel').addEventListener('click', () => pngDialog.close());

$('pngExport').addEventListener('click', async () => {
  const sizes = [...pngSizesBox.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => Number(i.value));
  if (!sizes.length) return;
  try {
    localStorage.setItem(PNG_PREF_KEY, JSON.stringify(sizes));
  } catch {
    /* ignore */
  }
  pngDialog.close();
  if (sizes.length === 1) {
    download(await renderPng(sizes[0]), `icon-${sizes[0]}.png`);
    return;
  }
  const files = await Promise.all(
    sizes.map(async (n) => ({ name: `icon-${n}.png`, data: new Uint8Array(await (await renderPng(n)).arrayBuffer()) })),
  );
  download(zip(files), 'icon-png.zip');
});

// Minimal ZIP writer (stored, no compression — PNGs are already compressed).
function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true); // compressed size
    local.setUint32(22, f.data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central directory header
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Boot --------------------------------------------------------------

setTool('rect');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
}
