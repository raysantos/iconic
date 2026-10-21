// Geometry audit (like FontLab's Font Audit): spots path problems that blur or
// bloat icons, each with an automatic fix.
import { removeAnchorSmooth } from './fit';
import { cubicAt, segments, splitSegment } from './geometry';
import type { BezierShape, BNode, Pt, Shape } from './model';
import { dist } from './vec';

export type AuditKind = 'near-straight' | 'extremes' | 'tiny' | 'off-grid' | 'redundant';

export interface AuditIssue {
  sid: string;
  kind: AuditKind;
  at: Pt;
  message: string;
  fix: (s: BezierShape) => void; // applied to the live shape
}

export const AUDIT_LABEL: Record<AuditKind, string> = {
  'near-straight': 'Almost straight line',
  extremes: 'Missing extreme point',
  tiny: 'Tiny segment',
  'off-grid': 'Point off the pixel grid',
  redundant: 'Redundant point',
};

const NEAR_DEG = 3; // within this many degrees of horizontal/vertical, but not exact
const TINY = 0.5; // px
const GRID = 0.5; // points should sit on the half-pixel grid
const EPS = 0.01;

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const offGrid = (v: number) => Math.abs(v / GRID - Math.round(v / GRID)) * GRID > EPS;

// Move a point onto the half-pixel grid, taking its handles along (the curve keeps its shape).
export function snapNode(e: BNode) {
  const snap = (v: number) => Math.round(v / GRID) * GRID;
  const delta: Pt = [snap(e.p[0]) - e.p[0], snap(e.p[1]) - e.p[1]];
  const mv = (v?: Pt): Pt | undefined => v && [v[0] + delta[0], v[1] + delta[1]];
  Object.assign(e, { p: mv(e.p), in: mv(e.in), out: mv(e.out) });
}

export function auditShape(s: Shape): AuditIssue[] {
  if (s.type !== 'bezier' || s.hidden) return [];
  const issues: AuditIssue[] = [];
  const n = s.nodes.length;
  const segs = segments(s.nodes, s.closed);

  segs.forEach(([a, b, c, d], i) => {
    const j = (i + 1) % n;
    const straight = b === a && c === d;
    const len = dist(a, d);

    if (len > 0 && len < TINY && n > 2) {
      issues.push({ sid: s.id, kind: 'tiny', at: mid(a, d), message: `${len.toFixed(2)} px long`, fix: (x) => removeAnchorSmooth(x, j) });
      return;
    }

    if (straight) {
      const dx = d[0] - a[0];
      const dy = d[1] - a[1];
      const ang = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0 = horizontal, 90 = vertical
      const offH = Math.abs(dy) > EPS && ang < NEAR_DEG;
      const offV = Math.abs(dx) > EPS && 90 - ang < NEAR_DEG;
      if (offH || offV) {
        issues.push({
          sid: s.id,
          kind: 'near-straight',
          at: mid(a, d),
          message: `${(offH ? ang : 90 - ang).toFixed(1)}° off ${offH ? 'horizontal' : 'vertical'}`,
          // Line it up by moving the end point (with its handles).
          fix: (x) => {
            const e = x.nodes[j];
            const delta: Pt = offH ? [0, x.nodes[i].p[1] - e.p[1]] : [x.nodes[i].p[0] - e.p[0], 0];
            const mv = (v?: Pt): Pt | undefined => v && [v[0] + delta[0], v[1] + delta[1]];
            Object.assign(e, { p: mv(e.p), in: mv(e.in), out: mv(e.out) });
          },
        });
      }
      return;
    }

    // Curves: an extreme (leftmost/topmost…) strictly inside the segment that
    // sticks out past both end points should have its own point.
    for (const axis of [0, 1]) {
      const A = -a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis];
      const B = 2 * (a[axis] - 2 * b[axis] + c[axis]);
      const C = b[axis] - a[axis];
      const roots = Math.abs(A) < 1e-9 ? (B ? [-C / B] : []) : quadRoots(A, B, C);
      for (const t of roots) {
        if (t <= 0.02 || t >= 0.98) continue;
        const p = cubicAt(a, b, c, d, t);
        const lo = Math.min(a[axis], d[axis]);
        const hi = Math.max(a[axis], d[axis]);
        if (p[axis] < lo - 0.05 || p[axis] > hi + 0.05) {
          issues.push({ sid: s.id, kind: 'extremes', at: p, message: `Curve bulges ${axis ? 'vertically' : 'horizontally'} without a point`, fix: (x) => splitSegment(x, i, t) });
          return;
        }
      }
    }
  });

  s.nodes.forEach((node, i) => {
    if (offGrid(node.p[0]) || offGrid(node.p[1])) {
      issues.push({
        sid: s.id,
        kind: 'off-grid',
        at: node.p,
        message: `At ${node.p.map((v) => +v.toFixed(2)).join(', ')}`,
        fix: (x) => snapNode(x.nodes[i]),
      });
    }
    // A sharp point in the middle of a straight line does nothing.
    const isEnd = !s.closed && (i === 0 || i === n - 1);
    if (isEnd || n < 3 || node.in || node.out || node.radius) return;
    const prev = s.nodes[(i - 1 + n) % n];
    const next = s.nodes[(i + 1) % n];
    if (prev.out || next.in) return;
    const cross = (node.p[0] - prev.p[0]) * (next.p[1] - prev.p[1]) - (node.p[1] - prev.p[1]) * (next.p[0] - prev.p[0]);
    const between = (node.p[0] - prev.p[0]) * (next.p[0] - node.p[0]) + (node.p[1] - prev.p[1]) * (next.p[1] - node.p[1]) > 0;
    if (Math.abs(cross) < 1e-3 && between) {
      issues.push({ sid: s.id, kind: 'redundant', at: node.p, message: 'Sits on a straight line', fix: (x) => x.nodes.splice(i, 1) });
    }
  });
  return issues;
}

function quadRoots(a: number, b: number, c: number) {
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)];
}
