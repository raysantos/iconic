// Masters & interpolation (like variable fonts / Material Symbols' weight axis):
// draw an icon at two weights and generate everything in between.
import { center, moveShape, toBezier, worldBox } from './geometry';
import type { Artboard, BNode, Pt, Shape } from './model';
import { inside, shapes } from './store';

// Material Symbols' weight axis.
export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700];

const shapesIn = (ab: Artboard) => shapes().filter((s) => !s.hidden && inside(ab, center(worldBox(s))));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const label = (s: Shape, i: number) => `${s.name ?? s.type} (#${i + 1})`;

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

// The icon at `t` (0 = first master, 1 = second), in the first master's coordinates.
export function interpolate(a: Artboard, b: Artboard, t: number): Shape[] | null {
  if (compatibility(a, b).length) return null;
  const off: Pt = [a.x - b.x, a.y - b.y]; // bring the second master onto the first
  const ys = shapesIn(b).map((s) => {
    const c = structuredClone(s);
    moveShape(c, structuredClone(c), off[0], off[1]);
    return c;
  });
  return shapesIn(a).map((x, i) => mix(x, ys[i], t));
}

function mix(x: Shape, y: Shape, t: number): Shape {
  const paint = { strokeWidth: lerp(x.strokeWidth, y.strokeWidth, t), rotation: lerp(x.rotation ?? 0, y.rotation ?? 0, t) };
  if (x.type === 'boolean' && y.type === 'boolean') return { ...structuredClone(x), ...paint, children: x.children.map((c, i) => mix(c, y.children[i], t)) };
  if (x.type === 'instance' && y.type === 'instance') {
    return { ...structuredClone(x), ...paint, x: lerp(x.x, y.x, t), y: lerp(x.y, y.y, t), scale: lerp(x.scale, y.scale, t), knockout: lerp(x.knockout ?? 0, y.knockout ?? 0, t) };
  }
  if (x.type === 'rect' && y.type === 'rect') return { ...structuredClone(x), ...paint, x: lerp(x.x, y.x, t), y: lerp(x.y, y.y, t), w: lerp(x.w, y.w, t), h: lerp(x.h, y.h, t), r: lerp(x.r ?? 0, y.r ?? 0, t) };
  if (x.type === 'ellipse' && y.type === 'ellipse') return { ...structuredClone(x), ...paint, cx: lerp(x.cx, y.cx, t), cy: lerp(x.cy, y.cy, t), rx: lerp(x.rx, y.rx, t), ry: lerp(x.ry, y.ry, t) };
  if (x.type === 'line' && y.type === 'line') return { ...structuredClone(x), ...paint, x1: lerp(x.x1, y.x1, t), y1: lerp(x.y1, y.y1, t), x2: lerp(x.x2, y.x2, t), y2: lerp(x.y2, y.y2, t) };
  // Everything else as matching paths, point by point.
  const a = toBezier(x);
  const b = toBezier(y);
  const nodes: BNode[] = a.nodes.map((n, k) => {
    const m = b.nodes[k];
    return {
      p: lerpPt(n.p, m.p, t),
      in: n.in && m.in ? lerpPt(n.in, m.in, t) : undefined,
      out: n.out && m.out ? lerpPt(n.out, m.out, t) : undefined,
      smooth: n.smooth,
      radius: n.radius || m.radius ? lerp(n.radius ?? 0, m.radius ?? 0, t) : undefined,
    };
  });
  return { ...a, ...paint, rotation: 0, nodes };
}
