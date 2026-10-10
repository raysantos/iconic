// Fitting cubic Beziers to points (Philip J. Schneider, "An Algorithm for
// Automatically Fitting Digitized Curves", Graphics Gems, 1990).
import { cubicAt, segments } from './geometry';
import type { BNode, BezierShape, Pt } from './model';

type Cubic = [Pt, Pt, Pt, Pt];

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

// Smooth Bezier segments through freehand points. `tolerance` is in canvas units.
export function fitCurve(points: Pt[], tolerance: number): Cubic[] {
  const pts = points.filter((p, i) => i === 0 || len(sub(p, points[i - 1])) > 1e-6);
  if (pts.length < 2) return [];
  const t1 = unit(sub(pts[1], pts[0]));
  const t2 = unit(sub(pts[pts.length - 2], pts[pts.length - 1]));
  return fitCubic(pts, t1, t2, tolerance * tolerance);
}

function fitCubic(pts: Pt[], t1: Pt, t2: Pt, error: number): Cubic[] {
  const [p0, pn] = [pts[0], pts[pts.length - 1]];
  if (pts.length === 2) {
    const d = len(sub(pn, p0)) / 3;
    return [[p0, add(p0, mul(t1, d)), add(pn, mul(t2, d)), pn]];
  }
  let u = chordParams(pts);
  let bez = generate(pts, u, t1, t2);
  let [maxErr, split] = maxError(pts, bez, u);
  if (maxErr < error) return [bez];
  // Close: try improving the parameters before splitting.
  if (maxErr < error * 4) {
    for (let i = 0; i < 20; i++) {
      u = reparameterize(bez, pts, u);
      bez = generate(pts, u, t1, t2);
      [maxErr, split] = maxError(pts, bez, u);
      if (maxErr < error) return [bez];
    }
  }
  const mid = unit(sub(pts[split - 1], pts[split + 1]));
  return [...fitCubic(pts.slice(0, split + 1), t1, mid, error), ...fitCubic(pts.slice(split), mul(mid, -1), t2, error)];
}

// One cubic from p0 to pn leaving along t1 and arriving along t2 (least squares).
export function fitSingle(pts: Pt[], t1: Pt, t2: Pt): Cubic {
  let u = chordParams(pts);
  let bez = generate(pts, u, t1, t2);
  for (let i = 0; i < 8; i++) {
    u = reparameterize(bez, pts, u);
    bez = generate(pts, u, t1, t2);
  }
  return bez;
}

function chordParams(pts: Pt[]) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(pts: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const [p0, pn] = [pts[0], pts[pts.length - 1]];
  let [c00, c01, c11, x0, x1] = [0, 0, 0, 0, 0];
  u.forEach((t, i) => {
    const a1 = mul(t1, 3 * t * (1 - t) * (1 - t));
    const a2 = mul(t2, 3 * t * t * (1 - t));
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[i], cubicAt(p0, p0, pn, pn, t));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  });
  const det = c00 * c11 - c01 * c01;
  let aL = det ? (x0 * c11 - x1 * c01) / det : 0;
  let aR = det ? (c00 * x1 - c01 * x0) / det : 0;
  const segLen = len(sub(pn, p0));
  if (aL < 1e-6 * segLen || aR < 1e-6 * segLen) aL = aR = segLen / 3;
  return [p0, add(p0, mul(t1, aL)), add(pn, mul(t2, aR)), pn];
}

function maxError(pts: Pt[], bez: Cubic, u: number[]): [number, number] {
  let max = 0;
  let split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = sub(cubicAt(...bez, u[i]), pts[i]);
    const e = dot(d, d);
    if (e >= max) [max, split] = [e, i];
  }
  return [max, split];
}

// Newton-Raphson step towards each point's closest parameter.
function reparameterize(bez: Cubic, pts: Pt[], u: number[]) {
  const [a, b, c, d] = bez;
  const d1: Pt[] = [mul(sub(b, a), 3), mul(sub(c, b), 3), mul(sub(d, c), 3)];
  const d2: Pt[] = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
  const q1 = (t: number) => add(add(mul(d1[0], (1 - t) ** 2), mul(d1[1], 2 * t * (1 - t))), mul(d1[2], t * t));
  const q2 = (t: number) => add(mul(d2[0], 1 - t), mul(d2[1], t));
  return u.map((t, i) => {
    const diff = sub(cubicAt(a, b, c, d, t), pts[i]);
    const num = dot(diff, q1(t));
    const den = dot(q1(t), q1(t)) + dot(diff, q2(t));
    const next = den ? t - num / den : t;
    return Math.min(1, Math.max(0, next));
  });
}

// Fitted segments -> anchor points (interior points are smooth by construction).
export function cubicsToNodes(cubics: Cubic[]): BNode[] {
  if (!cubics.length) return [];
  const nodes: BNode[] = [{ p: cubics[0][0], out: cubics[0][1] }];
  cubics.forEach(([, , c2, p], i) => {
    const next = cubics[i + 1];
    nodes.push(next ? { p, in: c2, out: next[1], smooth: true } : { p, in: c2 });
  });
  return nodes;
}

// Delete an anchor but keep the curve's shape (like Illustrator): refit one
// segment from the previous to the next anchor through the old curve.
export function removeAnchorSmooth(s: BezierShape, i: number) {
  const n = s.nodes.length;
  const isEnd = !s.closed && (i === 0 || i === n - 1);
  if (n <= 2 || isEnd) {
    s.nodes.splice(i, 1);
    return;
  }
  const pi = (i - 1 + n) % n;
  const ni = (i + 1) % n;
  const [prev, node, next] = [s.nodes[pi], s.nodes[i], s.nodes[ni]];
  const straight = !prev.out && !node.in && !node.out && !next.in;
  if (!straight) {
    // Sample the two old segments that meet at the anchor.
    const segs = segments(s.nodes, s.closed);
    const a = segs[pi];
    const b = segs[i];
    const pts: Pt[] = [];
    for (let k = 0; k <= 16; k++) pts.push(cubicAt(...a, k / 16));
    for (let k = 1; k <= 16; k++) pts.push(cubicAt(...b, k / 16));
    const t1 = unit(sub(prev.out ?? pts[1], prev.p));
    const t2 = unit(sub(next.in ?? pts[pts.length - 2], next.p));
    const [, c1, c2] = fitSingle(pts, t1, t2);
    prev.out = c1;
    next.in = c2;
  }
  s.nodes.splice(i, 1);
}

// Reverse a path's direction (used to continue drawing from its first point).
export function reverseNodes(nodes: BNode[]): BNode[] {
  return [...nodes].reverse().map((n) => ({ ...n, in: n.out, out: n.in }));
}
