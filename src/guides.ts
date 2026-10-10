// Smart guides (Illustrator, Ctrl+U): snap to other objects' edges, centers
// and anchor points, and to artboard edges and centers, showing magenta guides.
import { center, toBezier, worldBox } from './geometry';
import type { Box, Pt } from './model';
import { artboards, shapes, state } from './store';

export interface Guide {
  line: [Pt, Pt];
  label?: { at: Pt; text: string };
}

interface Line {
  v: number; // the x (or y) value
  from: number; // extent along the other axis, for drawing the guide
  to: number;
  kind: 'edge' | 'center';
}

interface Targets {
  xs: Line[];
  ys: Line[];
  points: { p: Pt; kind: 'anchor' | 'center' }[];
}

export const PX = 5; // snap distance in screen pixels

// What can be snapped to, minus the shapes being edited (and optionally one
// anchor of a shape, for point editing).
export function collectTargets(exclude: Set<string>, skipAnchor?: { sid: string; i: number }): Targets {
  const t: Targets = { xs: [], ys: [], points: [] };
  const addBox = (b: Box, withPoints: boolean) => {
    const [cx, cy] = center(b);
    t.xs.push({ v: b.x, from: b.y, to: b.y + b.h, kind: 'edge' }, { v: cx, from: b.y, to: b.y + b.h, kind: 'center' }, { v: b.x + b.w, from: b.y, to: b.y + b.h, kind: 'edge' });
    t.ys.push({ v: b.y, from: b.x, to: b.x + b.w, kind: 'edge' }, { v: cy, from: b.x, to: b.x + b.w, kind: 'center' }, { v: b.y + b.h, from: b.x, to: b.x + b.w, kind: 'edge' });
    if (withPoints) t.points.push({ p: [cx, cy], kind: 'center' });
  };
  for (const ab of artboards()) addBox(ab, true);
  for (const s of shapes()) {
    if (s.hidden) continue;
    if (exclude.has(s.id) && skipAnchor?.sid !== s.id) continue;
    if (!exclude.has(s.id)) addBox(worldBox(s), true);
    toBezier(s).nodes.forEach((n, i) => {
      if (skipAnchor && skipAnchor.sid === s.id && skipAnchor.i === i) return;
      t.points.push({ p: n.p, kind: 'anchor' });
    });
  }
  return t;
}

const near = (lines: Line[], v: number, tol: number) => {
  let best: Line | null = null;
  for (const l of lines) if (Math.abs(l.v - v) <= tol && (!best || Math.abs(l.v - v) < Math.abs(best.v - v))) best = l;
  return best;
};

// Snap a point: anchors/centers first, then x and y separately to aligned lines.
export function snapPoint(p: Pt, t: Targets, zoom: number): { p: Pt; x: boolean; y: boolean; guides: Guide[] } {
  const tol = PX / zoom;
  let hit: (typeof t.points)[number] | null = null;
  let best = tol;
  for (const c of t.points) {
    const d = Math.hypot(c.p[0] - p[0], c.p[1] - p[1]);
    if (d <= best) [hit, best] = [c, d];
  }
  if (hit) {
    const at: Pt = [hit.p[0], hit.p[1]];
    return { p: at, x: true, y: true, guides: [{ line: [at, at], label: { at, text: hit.kind } }] };
  }
  const lx = near(t.xs, p[0], tol);
  const ly = near(t.ys, p[1], tol);
  const q: Pt = [lx ? lx.v : p[0], ly ? ly.v : p[1]];
  const guides: Guide[] = [];
  if (lx) guides.push({ line: [[lx.v, Math.min(lx.from, q[1])], [lx.v, Math.max(lx.to, q[1])]] });
  if (ly) guides.push({ line: [[Math.min(ly.from, q[0]), ly.v], [Math.max(ly.to, q[0]), ly.v]] });
  if (lx || ly) guides[guides.length - 1].label = { at: q, text: lx && ly ? 'intersect' : 'align' };
  return { p: q, x: !!lx, y: !!ly, guides };
}

// Snap a moving box (left/center/right and top/middle/bottom) to aligned lines.
export function snapBox(b: Box, t: Targets, zoom: number): { dx: number | null; dy: number | null; guides: Guide[] } {
  const tol = PX / zoom;
  const guides: Guide[] = [];
  const pick = (mine: number[], lines: Line[]) => {
    let best: { d: number; line: Line; mine: number } | null = null;
    for (const m of mine) {
      const l = near(lines, m, tol);
      if (l && (!best || Math.abs(l.v - m) < Math.abs(best.d))) best = { d: l.v - m, line: l, mine: m };
    }
    return best;
  };
  const [cx, cy] = center(b);
  const sx = pick([b.x, cx, b.x + b.w], t.xs);
  const sy = pick([b.y, cy, b.y + b.h], t.ys);
  if (sx) {
    const top = Math.min(sx.line.from, b.y + (sy?.d ?? 0));
    const bottom = Math.max(sx.line.to, b.y + b.h + (sy?.d ?? 0));
    guides.push({ line: [[sx.line.v, top], [sx.line.v, bottom]], label: { at: [sx.line.v, top], text: sx.line.kind } });
  }
  if (sy) {
    const left = Math.min(sy.line.from, b.x + (sx?.d ?? 0));
    const right = Math.max(sy.line.to, b.x + b.w + (sx?.d ?? 0));
    guides.push({ line: [[left, sy.line.v], [right, sy.line.v]], label: { at: [left, sy.line.v], text: sy.line.kind } });
  }
  return { dx: sx ? sx.d : null, dy: sy ? sy.d : null, guides };
}

export const smartOn = () => state.prefs.smartGuides;
