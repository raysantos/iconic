// Masters & interpolation (like variable fonts / Material Symbols' axes): draw
// an icon once more per axis (bolder, filled, at another optical size) and
// generate every combination in between.
import { snapNode } from './audit';
import { bbox, center, scaleKeepingRotation, scaleShape, toBezier, worldBox } from './geometry';
import type { Artboard, AxisTag, Box, Loc, Shape } from './model';
import { artboardById, inside, shapes } from './store';

// Material Symbols' axes.
export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700];
export const FILLS = [0, 1];
export const AXES: AxisTag[] = ['wght', 'FILL', 'opsz'];
export const AXIS_LABEL: Record<AxisTag, string> = { wght: 'Weight', FILL: 'Fill', opsz: 'Optical size' };

export interface Master {
  ab: Artboard;
  axis: AxisTag;
  value: number;
}

const shapesIn = (ab: Artboard) => shapes().filter((s) => !s.hidden && inside(ab, center(worldBox(s))));
const label = (s: Shape, i: number) => `${s.name ?? s.type} (#${i + 1})`;

// The base artboard of the family `ab` belongs to (itself, its base, or the base it was generated from).
export function baseOf(ab: Artboard): Artboard | null {
  if (ab.variations) return ab;
  const id = ab.masterOf ?? ab.generated?.from;
  const base = id ? artboardById(id) : null;
  return base?.variations ? base : null;
}

// The base's own location; its optical size is its width.
export const baseLoc = (base: Artboard): Loc => ({ wght: base.variations?.wght ?? 400, FILL: base.variations?.FILL ?? 0, opsz: base.w });

// The base's masters that still exist (an optical-size master's value is its width).
export function mastersOf(base: Artboard): Master[] {
  return (base.variations?.masters ?? []).flatMap((m) => {
    const ab = artboardById(m.id);
    return ab ? [{ ab, axis: m.axis, value: m.axis === 'opsz' ? ab.w : m.value }] : [];
  }).sort((a, b) => AXES.indexOf(a.axis) - AXES.indexOf(b.axis));
}

// Generated names follow Google's downloads: home_FILL1_wght300_GRAD0_opsz20.
export const locSuffix = (l: Loc) => `FILL${+l.FILL.toFixed(2)}_wght${Math.round(l.wght)}_GRAD0_opsz${Math.round(l.opsz)}`;
export const locLabel = (l: Loc) => `Weight ${Math.round(l.wght)} · Fill ${+l.FILL.toFixed(2)} · ${Math.round(l.opsz)}dp`;

// ---- Compatibility --------------------------------------------------------

// Shapes in each master, in the same order, must have the same structure.
export function compatibility(a: Artboard, b: Artboard): string[] {
  return compareLists(shapesIn(a), shapesIn(b));
}

function compareLists(xs: Shape[], ys: Shape[]): string[] {
  if (xs.length !== ys.length) return [`Different number of shapes: ${xs.length} vs ${ys.length}`];
  return xs.flatMap((x, i) => compareShapes(x, ys[i], i));
}

function compareShapes(x: Shape, y: Shape, i: number): string[] {
  if (x.type === 'boolean' || y.type === 'boolean') {
    if (x.type !== 'boolean' || y.type !== 'boolean') return [`${label(x, i)}: one master has a boolean group here`];
    return compareLists(x.children, y.children).map((p) => `${label(x, i)} › ${p}`);
  }
  if (x.type === 'instance' || y.type === 'instance') {
    if (x.type !== 'instance' || y.type !== 'instance' || x.ref !== y.ref) return [`${label(x, i)}: instances must use the same component`];
    return [];
  }
  if (x.type === y.type && x.type !== 'bezier' && x.type !== 'path') return []; // same primitive: always compatible
  const a = toBezier(x);
  const b = toBezier(y);
  if (a.closed !== b.closed) return [`${label(x, i)}: open in one master, closed in the other`];
  if (a.nodes.length !== b.nodes.length) return [`${label(x, i)}: ${a.nodes.length} vs ${b.nodes.length} points`];
  const bad = a.nodes.findIndex((n, k) => !!n.in !== !!b.nodes[k].in || !!n.out !== !!b.nodes[k].out);
  if (bad >= 0) return [`${label(x, i)}: point ${bad + 1} is a curve in one master and a corner in the other`];
  return [];
}

// ---- Scaling (optical-size masters are drawn on other artboard sizes) -------

// Scale a shape from box `a` to box `b` (same proportions), lines and corner radii included.
export function scaleWhole(s: Shape, a: Box, b: Box) {
  const k = b.w / a.w;
  scaleKeepingRotation(s, structuredClone(s), a, b);
  const walk = (x: Shape) => {
    x.strokeWidth *= k;
    if (x.type === 'boolean') x.children.forEach(walk);
    if (x.type === 'rect' && x.r) x.r *= k;
    if (x.type === 'instance' && x.knockout) x.knockout *= k;
    if (x.type === 'bezier') for (const n of x.nodes) if (n.radius) n.radius *= k;
  };
  walk(s);
}

// A master's artwork, moved and scaled onto the base artboard.
function onBase(base: Artboard, ab: Artboard): Shape[] {
  return shapesIn(ab).map((s) => {
    const c = structuredClone(s);
    scaleWhole(c, ab, { x: base.x, y: base.y, w: base.w, h: base.w * (ab.h / ab.w) });
    return c;
  });
}

// ---- Interpolation --------------------------------------------------------

// Give matching shapes the same type so their numbers line up (mixed types become paths).
function align(xs: Shape[]): Shape[] {
  if (xs.every((x) => x.type === 'boolean')) {
    return xs.map((x, k) => ({ ...x, children: (x as Extract<Shape, { type: 'boolean' }>).children.map((_, i) => align(xs.map((y) => (y as Extract<Shape, { type: 'boolean' }>).children[i]))[k]) }) as Shape);
  }
  if (xs.every((x) => x.type === xs[0].type)) return xs;
  return xs.map(toBezier);
}

// A shape's numbers in a fixed order, so masters can be mixed with plain arithmetic.
function nums(s: Shape): number[] {
  const own = [s.strokeWidth, s.rotation ?? 0];
  switch (s.type) {
    case 'boolean':
      return [...own, ...s.children.flatMap(nums)];
    case 'instance':
      return [...own, s.x, s.y, s.scale, s.knockout ?? 0];
    case 'rect':
      return [...own, s.x, s.y, s.w, s.h, s.r ?? 0];
    case 'ellipse':
      return [...own, s.cx, s.cy, s.rx, s.ry];
    case 'line':
      return [...own, s.x1, s.y1, s.x2, s.y2];
    case 'path':
      return [...own, ...s.points.flat()];
    case 'bezier':
      return [...own, ...s.nodes.flatMap((n) => [...n.p, ...(n.in ?? []), ...(n.out ?? []), n.radius ?? 0])];
  }
}

// Write numbers back in the same order; returns how many were used.
function setNums(s: Shape, v: number[], i = 0): number {
  const next = () => v[i++];
  s.strokeWidth = next();
  const rot = next();
  if (rot || s.rotation) s.rotation = rot;
  switch (s.type) {
    case 'boolean':
      for (const c of s.children) i = setNums(c, v, i);
      break;
    case 'instance': {
      Object.assign(s, { x: next(), y: next(), scale: next() });
      const k = next();
      if (k || s.knockout) s.knockout = k;
      break;
    }
    case 'rect': {
      Object.assign(s, { x: next(), y: next(), w: next(), h: next() });
      const r = next();
      if (r || s.r !== undefined) s.r = r;
      break;
    }
    case 'ellipse':
      Object.assign(s, { cx: next(), cy: next(), rx: next(), ry: next() });
      break;
    case 'line':
      Object.assign(s, { x1: next(), y1: next(), x2: next(), y2: next() });
      break;
    case 'path':
      s.points = s.points.map(() => [next(), next()]);
      break;
    case 'bezier':
      for (const n of s.nodes) {
        n.p = [next(), next()];
        if (n.in) n.in = [next(), next()];
        if (n.out) n.out = [next(), next()];
        const r = next();
        if (r || n.radius !== undefined) n.radius = r;
      }
      break;
  }
  return i;
}

// The icon at `loc`, on the base artboard (at the base's size). Each master adds
// its share of change along its axis, like a variable font. Null if a master
// isn't compatible.
//
// Fill is worked out from the in-between icon itself (holes shrunk to nothing,
// plus your own touch-ups to the filled master), so a bolder icon's smaller
// holes still close exactly instead of overshooting.
export function interpolate(base: Artboard, loc: Loc): Shape[] | null {
  const ms = mastersOf(base);
  if (ms.some((m) => compatibility(base, m.ab).length)) return null;
  const at = baseLoc(base);
  const t = (m: Master) => (m.value === at[m.axis] ? 0 : (loc[m.axis] - at[m.axis]) / (m.value - at[m.axis]));
  const plain = ms.filter((m) => m.axis !== 'FILL');
  const others = plain.map((m) => onBase(base, m.ab));
  const fm = ms.find((m) => m.axis === 'FILL');
  const filled = fm && t(fm) ? onBase(base, fm.ab) : null;
  return shapesIn(base).map((x, i) => {
    const [a, ...rest] = align([x, ...others.map((o) => o[i])]);
    const v0 = nums(a);
    const v = [...v0];
    rest.forEach((r, k) => {
      const tk = t(plain[k]);
      if (tk) nums(r).forEach((n, j) => (v[j] += tk * (n - v0[j])));
    });
    const out = structuredClone(a);
    setNums(out, v);
    if (!filled) return out;
    // Filled target = auto-fill of this in-between icon + (filled master − auto-fill of the base).
    const auto = (s: Shape) => {
      const c = structuredClone(s);
      fillIn(c);
      return c;
    };
    const [o, autoO, autoA, f] = align([out, auto(out), auto(a), filled[i]]);
    const [vo, vAutoO, vAutoA, vf] = [o, autoO, autoA, f].map(nums);
    const tf = t(fm!);
    const mixed = vo.map((n, j) => n + tf * (vAutoO[j] - n + vf[j] - vAutoA[j]));
    const res = structuredClone(o);
    setNums(res, mixed);
    return res;
  });
}

// Every combination of the picked values (axes without a master stay at the
// base), leaving out the base and the masters themselves.
export function combos(base: Artboard, picks: Partial<Record<AxisTag, number[]>>): Loc[] {
  const at = baseLoc(base);
  const ms = mastersOf(base);
  const values = (axis: AxisTag) => (ms.some((m) => m.axis === axis) ? [...new Set(picks[axis] ?? [])].sort((a, b) => a - b) : [at[axis]]);
  const drawn = [at, ...ms.map((m) => ({ ...at, [m.axis]: m.value }))];
  const out: Loc[] = [];
  for (const opsz of values('opsz'))
    for (const FILL of values('FILL'))
      for (const wght of values('wght')) {
        const l: Loc = { wght, FILL, opsz };
        if (!drawn.some((d) => AXES.every((k) => d[k] === l[k]))) out.push(l);
      }
  return out;
}

// In-between weights land on fractional coordinates; put every path point back
// on the half-pixel grid so generated icons pass Audit without a Fix all.
export function snapToGrid(s: Shape) {
  if (s.type === 'boolean') s.children.forEach(snapToGrid);
  else if (s.type === 'bezier') s.nodes.forEach(snapNode);
}

// ---- Fill master ----------------------------------------------------------

// Turn an outlined icon into its filled master the way Material Symbols does:
// holes shrink to nothing instead of disappearing, so both masters keep the
// same shapes and points. Returns how many shapes were only approximated.
export function fillIn(s: Shape): number {
  if (s.type === 'boolean') {
    // Subtract: the bottom shape minus the ones above it, which are the holes.
    return s.children.reduce((n, c, i) => n + (s.op === 'subtract' && i > 0 ? (collapse(c), 0) : fillIn(c)), 0);
  }
  const outline = s.stroke !== 'none' && s.strokeWidth > 0 && s.fill === 'none';
  const closed = s.type === 'rect' || s.type === 'ellipse' || (s.type === 'bezier' && s.closed);
  if (!outline || !closed) return 0; // already solid, or an open line (no hole)
  // Thicken the line inward until the hole closes; the outer edge stays put.
  const b = bbox(s);
  const sw = s.strokeWidth;
  const width = Math.min(b.w, b.h) / 2 + sw / 2;
  const d = (width - sw) / 2;
  s.strokeWidth = width;
  if (s.type === 'rect') Object.assign(s, { x: s.x + d, y: s.y + d, w: s.w - 2 * d, h: s.h - 2 * d, r: s.r ? Math.max(0, s.r - d) : s.r });
  else if (s.type === 'ellipse') Object.assign(s, { rx: s.rx - d, ry: s.ry - d });
  else {
    scaleShape(s, structuredClone(s), b, { x: b.x + d, y: b.y + d, w: b.w - 2 * d, h: b.h - 2 * d });
    return 1; // exact for rectangles and circles; other outlines need a look
  }
  return 0;
}

// Shrink a shape to a point at its center (a hole that's closed).
function collapse(s: Shape) {
  const [cx, cy] = center(bbox(s));
  scaleShape(s, structuredClone(s), bbox(s), { x: cx, y: cy, w: 0, h: 0 });
  const walk = (x: Shape) => {
    x.strokeWidth = 0;
    if (x.type === 'boolean') x.children.forEach(walk);
    if (x.type === 'rect' && x.r) x.r = 0;
    if (x.type === 'bezier') for (const n of x.nodes) if (n.radius) n.radius = 0;
  };
  walk(s);
}
