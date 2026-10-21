// Point and path commands (Direct Selection nudge and delete, Join, pencil to curve).
import { toBezier } from './geometry';
import { type BezierShape, type Pt, type Shape } from './model';
import { checkpoint, commit, selected, removeShape, shapes, state } from './store';
import { powerAdjust } from './curvetools';
import { cubicsToNodes, fitCurve, removeAnchorSmooth, reverseNodes } from './fit';
import { ensureBezier } from './canvas';

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
      removeShape(s.id);
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
  removeShape(b.id);
  state.selection = [a.id];
  commit();
  return null;
}

// Pencil strokes become smooth, editable curves.
export function pencilToCurve(s: Extract<Shape, { type: 'path' }>) {
  const nodes = cubicsToNodes(fitCurve(s.points, 0.3));
  if (nodes.length < 2) return;
  const list = shapes();
  const { points: _pts, ...rest } = s;
  list[list.indexOf(s)] = { ...rest, type: 'bezier', nodes, closed: false };
}
