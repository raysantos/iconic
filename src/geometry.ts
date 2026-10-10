import type { BNode, BezierShape, Box, Pt, Shape } from './model';
import { booleanResult } from './pathops';

export const round = (v: number) => Math.round(v * 100) / 100;

// Bounding box in the shape's own (unrotated) frame.
export function bbox(s: Shape): Box {
  switch (s.type) {
    case 'rect':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'ellipse':
      return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    case 'line':
      return fromPoints([
        [s.x1, s.y1],
        [s.x2, s.y2],
      ]);
    case 'path':
      return fromPoints(s.points);
    case 'bezier':
      return bezierBox(s.nodes, s.closed);
    case 'boolean': {
      // The live result's bounds; before the geometry engine loads, the children's.
      const r = booleanResult(s)?.bounds;
      if (r) return r;
      const kids = s.children.filter((c) => !c.hidden);
      return kids.length ? unionBox(kids.map(worldBox)) : { x: 0, y: 0, w: 0, h: 0 };
    }
  }
}

// Axis-aligned bounds on the canvas, accounting for rotation.
export function worldBox(s: Shape): Box {
  const b = bbox(s);
  if (!s.rotation) return b;
  return fromPoints(corners(b).map((p) => rotate(p, s.rotation!, center(b))));
}

export function unionBox(boxes: Box[]): Box {
  return fromPoints(boxes.flatMap((b) => corners(b)));
}

export const corners = (b: Box): Pt[] => [
  [b.x, b.y],
  [b.x + b.w, b.y],
  [b.x + b.w, b.y + b.h],
  [b.x, b.y + b.h],
];

export function fromPoints(pts: Pt[]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const center = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];

export const intersects = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export function rotate([x, y]: Pt, deg: number, [cx, cy]: Pt): Pt {
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

// Map shape geometry from box `a` onto box `b` (stroke width is unchanged).
export function scaleShape(s: Shape, o: Shape, a: Box, b: Box) {
  const sx = a.w ? b.w / a.w : 1;
  const sy = a.h ? b.h / a.h : 1;
  const mx = (x: number) => b.x + (x - a.x) * sx;
  const my = (y: number) => b.y + (y - a.y) * sy;
  if (s.type === 'rect' && o.type === 'rect') Object.assign(s, { x: mx(o.x), y: my(o.y), w: o.w * sx, h: o.h * sy });
  else if (s.type === 'ellipse' && o.type === 'ellipse') Object.assign(s, { cx: mx(o.cx), cy: my(o.cy), rx: o.rx * sx, ry: o.ry * sy });
  else if (s.type === 'line' && o.type === 'line') Object.assign(s, { x1: mx(o.x1), y1: my(o.y1), x2: mx(o.x2), y2: my(o.y2) });
  else if (s.type === 'path' && o.type === 'path') s.points = o.points.map(([x, y]) => [mx(x), my(y)]);
  else if (s.type === 'bezier' && o.type === 'bezier') s.nodes = mapNodes(o.nodes, ([x, y]) => [mx(x), my(y)]);
  else if (s.type === 'boolean' && o.type === 'boolean') s.children.forEach((c, i) => scaleKeepingRotation(c, o.children[i], a, b));
}

// Scale from box `a` to `b`; a rotated shape keeps its rotation (its center
// moves with the box and its own size scales).
export function scaleKeepingRotation(s: Shape, o: Shape, a: Box, b: Box) {
  if (!o.rotation) return scaleShape(s, o, a, b);
  const sx = a.w ? b.w / a.w : 1;
  const sy = a.h ? b.h / a.h : 1;
  const own = bbox(o);
  const [cx, cy] = center(own);
  const [nx, ny] = [b.x + (cx - a.x) * sx, b.y + (cy - a.y) * sy];
  const [w, h] = [own.w * sx, own.h * sy];
  scaleShape(s, o, own, { x: nx - w / 2, y: ny - h / 2, w, h });
}

export function moveShape(s: Shape, o: Shape, dx: number, dy: number) {
  scaleShape(s, o, { x: 0, y: 0, w: 1, h: 1 }, { x: dx, y: dy, w: 1, h: 1 });
}

export function isEmpty(s: Shape) {
  if (s.type === 'rect') return s.w === 0 || s.h === 0;
  if (s.type === 'ellipse') return s.rx === 0 || s.ry === 0;
  if (s.type === 'line') return s.x1 === s.x2 && s.y1 === s.y2;
  if (s.type === 'bezier') return s.nodes.length < 2;
  if (s.type === 'boolean') return !s.children.length;
  return s.points.length < 2;
}

// ---- Bezier ------------------------------------------------------------

export function mapNodes(nodes: BNode[], f: (p: Pt) => Pt): BNode[] {
  return nodes.map((n) => ({ ...n, p: f(n.p), in: n.in && f(n.in), out: n.out && f(n.out) }));
}

// Each segment as [start, control1, control2, end].
export function segments(nodes: BNode[], closed: boolean): [Pt, Pt, Pt, Pt][] {
  const segs: [Pt, Pt, Pt, Pt][] = [];
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    segs.push([a.p, a.out ?? a.p, b.in ?? b.p, b.p]);
  }
  return segs;
}

export function bezierToPath(nodes: BNode[], closed: boolean) {
  if (!nodes.length) return '';
  const f = ([x, y]: Pt) => `${round(x)} ${round(y)}`;
  let d = `M${f(nodes[0].p)}`;
  for (const [a, c1, c2, e] of segments(nodes, closed)) {
    const straight = c1 === a && c2 === e;
    d += straight ? ` L${f(e)}` : ` C${f(c1)} ${f(c2)} ${f(e)}`;
  }
  return closed ? d + ' Z' : d;
}

export function pointsToPath(pts: Pt[]) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join(' ');
}

// Exact bounds: anchor points plus each segment's extrema (where dx/dt or dy/dt = 0).
export function bezierBox(nodes: BNode[], closed: boolean): Box {
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

export function cubicAt(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((i) => w[0] * a[i] + w[1] * b[i] + w[2] * c[i] + w[3] * d[i]) as Pt;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

// Closest point on the path: { segment index, t, distance }.
export function nearestOnPath(s: BezierShape, p: Pt) {
  let best = { seg: -1, t: 0, dist: Infinity };
  segments(s.nodes, s.closed).forEach(([a, b, c, d], seg) => {
    // Coarse sample, then refine around the best sample.
    let bt = 0;
    let bd = Infinity;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const q = cubicAt(a, b, c, d, t);
      const dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dist < bd) [bd, bt] = [dist, t];
    }
    for (let step = 1 / 80; step > 1e-4; step /= 2) {
      for (const t of [bt - step, bt + step]) {
        if (t < 0 || t > 1) continue;
        const q = cubicAt(a, b, c, d, t);
        const dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (dist < bd) [bd, bt] = [dist, t];
      }
    }
    if (bd < best.dist) best = { seg, t: bt, dist: bd };
  });
  return best;
}

// Insert an anchor at parameter t of segment `seg` without changing the curve (de Casteljau).
export function splitSegment(s: BezierShape, seg: number, t: number) {
  const n0 = s.nodes[seg];
  const n1 = s.nodes[(seg + 1) % s.nodes.length];
  const [a, b, c, d] = [n0.p, n0.out ?? n0.p, n1.in ?? n1.p, n1.p];
  const straight = same(a, b) && same(c, d);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const cd = lerp(c, d, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const p = lerp(abc, bcd, t);
  const node: BNode = straight ? { p } : { p, in: abc, out: bcd, smooth: true };
  if (!straight) {
    n0.out = ab;
    n1.in = cd;
  }
  s.nodes.splice(seg + 1, 0, node);
}

const KAPPA = 0.5523; // control-handle length for a circle quarter

// Any shape as an editable Bezier path (rotation baked in).
export function toBezier(s: Shape): BezierShape {
  const base = { ...s } as Partial<Shape>;
  let nodes: BNode[];
  let closed = true;
  switch (s.type) {
    case 'bezier':
      nodes = structuredClone(s.nodes);
      closed = s.closed;
      break;
    case 'boolean':
      nodes = []; // no editable points of its own; edit the shapes inside
      break;
    case 'rect': {
      const r = Math.min(s.r ?? 0, s.w / 2, s.h / 2);
      if (!r) {
        nodes = corners(bbox(s)).map((p) => ({ p }));
        break;
      }
      // Two points per rounded corner, joined by a quarter-circle curve.
      const { x, y, w, h } = s;
      const k = r * KAPPA;
      nodes = [
        { p: [x + r, y], in: [x + r - k, y] },
        { p: [x + w - r, y], out: [x + w - r + k, y] },
        { p: [x + w, y + r], in: [x + w, y + r - k] },
        { p: [x + w, y + h - r], out: [x + w, y + h - r + k] },
        { p: [x + w - r, y + h], in: [x + w - r + k, y + h] },
        { p: [x + r, y + h], out: [x + r - k, y + h] },
        { p: [x, y + h - r], in: [x, y + h - r + k] },
        { p: [x, y + r], out: [x, y + r - k] },
      ];
      break;
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = s;
      const [kx, ky] = [rx * KAPPA, ry * KAPPA];
      nodes = [
        { p: [cx, cy - ry], in: [cx - kx, cy - ry], out: [cx + kx, cy - ry], smooth: true },
        { p: [cx + rx, cy], in: [cx + rx, cy - ky], out: [cx + rx, cy + ky], smooth: true },
        { p: [cx, cy + ry], in: [cx + kx, cy + ry], out: [cx - kx, cy + ry], smooth: true },
        { p: [cx - rx, cy], in: [cx - rx, cy + ky], out: [cx - rx, cy - ky], smooth: true },
      ];
      break;
    }
    case 'line':
      nodes = [{ p: [s.x1, s.y1] }, { p: [s.x2, s.y2] }];
      closed = false;
      break;
    case 'path':
      nodes = s.points.map((p) => ({ p }));
      closed = false;
      break;
  }
  if (s.rotation) {
    const c = center(bbox(s));
    nodes = mapNodes(nodes, (p) => rotate(p, s.rotation!, c));
  }
  for (const k of ['x', 'y', 'w', 'h', 'r', 'cx', 'cy', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'children', 'op']) delete (base as Record<string, unknown>)[k];
  return { ...(base as Shape), type: 'bezier', nodes, closed, rotation: 0 } as BezierShape;
}

// ---- Freehand ----------------------------------------------------------

// Ramer–Douglas–Peucker: thin out freehand points.
export function simplify(pts: Pt[], eps: number): Pt[] {
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

function distToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt) {
  const [dx, dy] = [bx - ax, by - ay];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
