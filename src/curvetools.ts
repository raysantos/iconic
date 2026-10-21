// Type-design curve tools (as in FontLab): Tunni lines and Power Nudge.
import type { BNode, Pt } from './model';
import { add, dot, len, mul, sub, unit } from './vec';

// A segment's points: start a, handles b (a.out) and c (d.in), end d.
export function segmentAt(nodes: BNode[], seg: number) {
  const n0 = nodes[seg];
  const n1 = nodes[(seg + 1) % nodes.length];
  return { n0, n1, a: n0.p, b: n0.out, c: n1.in, d: n1.p };
}

// Where the two handle directions meet (the Tunni point), or null if parallel.
export function tunniPoint(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a);
  const s = sub(c, d);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((d[0] - a[0]) * s[1] - (d[1] - a[1]) * s[0]) / den;
  if (t <= 0) return null;
  return add(a, mul(r, t));
}

// Drag the Tunni line by `delta`: both handles grow or shrink by the same
// factor along their own directions (fuller or flatter curve, same angles).
export function dragTunni(n0: BNode, n1: BNode, orig0: BNode, orig1: BNode, delta: Pt) {
  if (!orig0.out || !orig1.in) return;
  const u1 = unit(sub(orig0.out, orig0.p));
  const u2 = unit(sub(orig1.in, orig1.p));
  const l1 = len(sub(orig0.out, orig0.p));
  const l2 = len(sub(orig1.in, orig1.p));
  const dir = unit(add(u1, u2));
  const f = Math.max(0.05, 1 + dot(delta, dir) / (((l1 + l2) / 2) || 1));
  n0.out = add(orig0.p, mul(u1, l1 * f));
  n1.in = add(orig1.p, mul(u2, l2 * f));
}

// Balance (double-click the Tunni line): give both handles the same tension,
// i.e. the same fraction of the way to the Tunni point.
export function balanceTunni(n0: BNode, n1: BNode): boolean {
  if (!n0.out || !n1.in) return false;
  const t = tunniPoint(n0.p, n0.out, n1.in, n1.p);
  const l1 = len(sub(n0.out, n0.p));
  const l2 = len(sub(n1.in, n1.p));
  if (!t) {
    // Parallel handles: just even out their lengths.
    const avg = (l1 + l2) / 2;
    n0.out = add(n0.p, mul(unit(sub(n0.out, n0.p)), avg));
    n1.in = add(n1.p, mul(unit(sub(n1.in, n1.p)), avg));
    return true;
  }
  const d1 = len(sub(t, n0.p));
  const d2 = len(sub(t, n1.p));
  const tension = (l1 / d1 + l2 / d2) / 2;
  n0.out = add(n0.p, mul(unit(sub(n0.out, n0.p)), tension * d1));
  n1.in = add(n1.p, mul(unit(sub(n1.in, n1.p)), tension * d2));
  return true;
}

// Power Nudge: after moving the points in `moved` (from `orig`), scale the far
// handle of every curve that connects a moved point to a fixed one by how much
// that curve's chord changed, so the curve keeps its character.
export function powerAdjust(nodes: BNode[], orig: BNode[], moved: Set<number>, closed: boolean) {
  const n = nodes.length;
  const count = closed ? n : n - 1;
  for (let s = 0; s < count; s++) {
    const i = s;
    const j = (s + 1) % n;
    if (moved.has(i) === moved.has(j)) continue; // both or neither moved
    const [m, f, farPart] = moved.has(i) ? ([i, j, 'in'] as const) : ([j, i, 'out'] as const);
    const far = orig[f][farPart];
    if (!far) continue;
    const before = len(sub(orig[f].p, orig[m].p));
    const after = len(sub(nodes[f].p, nodes[m].p));
    if (!before) continue;
    nodes[f][farPart] = add(nodes[f].p, mul(sub(far, orig[f].p), after / before));
  }
}
