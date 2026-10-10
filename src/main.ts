import './style.css';

// ---- Document model ----------------------------------------------------

type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'pen';

interface Style {
  fill: string; // 'none' or a color
  stroke: string;
  strokeWidth: number;
}

type Shape =
  | ({ id: string; type: 'rect'; x: number; y: number; w: number; h: number } & Style)
  | ({ id: string; type: 'ellipse'; cx: number; cy: number; rx: number; ry: number } & Style)
  | ({ id: string; type: 'line'; x1: number; y1: number; x2: number; y2: number } & Style)
  | ({ id: string; type: 'path'; points: [number, number][] } & Style);

const SIZE = 24; // icon grid size (viewBox 0 0 24 24)
const STORAGE_KEY = 'icon-forge:doc';
const SVG_NS = 'http://www.w3.org/2000/svg';

let shapes: Shape[] = load();
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

function load(): Shape[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shapes));
  } catch {
    /* storage unavailable; ignore */
  }
}

function checkpoint() {
  undoStack.push(JSON.stringify(shapes));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(JSON.stringify(shapes));
  shapes = JSON.parse(prev);
  selectedId = null;
  commit();
}

function redo() {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(JSON.stringify(shapes));
  shapes = JSON.parse(next);
  selectedId = null;
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
  }
  setAttrs(el, {
    fill: s.type === 'line' ? 'none' : s.fill,
    stroke: s.strokeWidth > 0 ? s.stroke : 'none',
    'stroke-width': s.strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  el.dataset.id = s.id;
  return el;
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
  // pixel grid (editor only, not exported)
  const grid = document.createElementNS(SVG_NS, 'g');
  grid.setAttribute('class', 'grid');
  for (let i = 1; i < SIZE; i++) {
    const v = document.createElementNS(SVG_NS, 'line');
    setAttrs(v, { x1: i, y1: 0, x2: i, y2: SIZE });
    const h = document.createElementNS(SVG_NS, 'line');
    setAttrs(h, { x1: 0, y1: i, x2: SIZE, y2: i });
    grid.append(v, h);
  }
  canvas.append(grid);

  for (const s of shapes) canvas.append(shapeToElement(s));

  const sel = shapes.find((s) => s.id === selectedId);
  if (sel) {
    const el = canvas.querySelector(`[data-id="${sel.id}"]`) as SVGGraphicsElement;
    const b = el.getBBox();
    const box = document.createElementNS(SVG_NS, 'rect');
    setAttrs(box, { x: b.x - 0.3, y: b.y - 0.3, width: b.width + 0.6, height: b.height + 0.6 });
    box.setAttribute('class', 'selection');
    canvas.append(box);
  }
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

let drag: { start: [number, number]; shape?: Shape; original?: string } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toCanvas(e);
  const [sx, sy] = [snap(p[0]), snap(p[1])];

  if (tool === 'select') {
    const target = (e.target as Element).closest('[data-id]') as SVGElement | null;
    selectedId = target?.dataset.id ?? null;
    const shape = shapes.find((s) => s.id === selectedId);
    if (shape) {
      checkpoint();
      drag = { start: p, shape, original: JSON.stringify(shape) };
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
  shapes.push(shape);
  selectedId = id;
  drag = { start: [sx, sy], shape };
  render();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag?.shape) return;
  const p = toCanvas(e);
  const s = drag.shape;

  if (tool === 'select') {
    const o = JSON.parse(drag.original!) as Shape;
    const dx = snap(p[0] - drag.start[0]);
    const dy = snap(p[1] - drag.start[1]);
    moveShape(s, o, dx, dy);
    render();
    return;
  }

  const [x, y] = [snap(p[0]), snap(p[1])];
  const [x0, y0] = drag.start;
  if (s.type === 'rect') Object.assign(s, { x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) });
  else if (s.type === 'ellipse') Object.assign(s, { cx: (x0 + x) / 2, cy: (y0 + y) / 2, rx: Math.abs(x - x0) / 2, ry: Math.abs(y - y0) / 2 });
  else if (s.type === 'line') Object.assign(s, { x2: x, y2: y });
  else if (s.type === 'path') s.points.push(p);
  render();
});

function endDrag() {
  if (!drag) return;
  const s = drag.shape;
  // Discard zero-size shapes from accidental taps.
  if (s && tool !== 'select' && isEmpty(s)) {
    shapes = shapes.filter((x) => x.id !== s.id);
    undoStack.pop();
    selectedId = null;
  }
  if (s?.type === 'path') s.points = simplify(s.points, 0.15);
  drag = null;
  commit();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function isEmpty(s: Shape) {
  if (s.type === 'rect') return s.w === 0 || s.h === 0;
  if (s.type === 'ellipse') return s.rx === 0 || s.ry === 0;
  if (s.type === 'line') return s.x1 === s.x2 && s.y1 === s.y2;
  return s.points.length < 2;
}

function moveShape(s: Shape, o: Shape, dx: number, dy: number) {
  if (s.type === 'rect' && o.type === 'rect') Object.assign(s, { x: o.x + dx, y: o.y + dy });
  else if (s.type === 'ellipse' && o.type === 'ellipse') Object.assign(s, { cx: o.cx + dx, cy: o.cy + dy });
  else if (s.type === 'line' && o.type === 'line') Object.assign(s, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
  else if (s.type === 'path' && o.type === 'path') s.points = o.points.map(([x, y]) => [x + dx, y + dy]);
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
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  else if (!mod) {
    const map: Record<string, Tool> = { v: 'select', r: 'rect', e: 'ellipse', l: 'line', p: 'pen' };
    const t = map[e.key.toLowerCase()];
    if (t) setTool(t);
  }
});

// ---- Export ------------------------------------------------------------

function exportSvgString() {
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  root.setAttribute('width', String(SIZE));
  root.setAttribute('height', String(SIZE));
  for (const s of shapes) {
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

$('exportPng').addEventListener('click', () => {
  const px = 512;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    c.getContext('2d')!.drawImage(img, 0, 0, px, px);
    c.toBlob((b) => b && download(b, `icon-${px}.png`), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSvgString());
});

// ---- Boot --------------------------------------------------------------

setTool('rect');

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js');
}
