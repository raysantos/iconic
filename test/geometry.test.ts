import { describe, expect, test } from 'vitest';
import { bbox, bezierBox, bezierToPath, cubicAt, expandCorners, nearestOnPath, splitSegment, toBezier } from '../src/geometry';
import type { BezierShape, BNode, Pt } from '../src/model';
import { closeTo, path, rect } from './helpers';

describe('cubicAt', () => {
  test('hits the end points at t = 0 and 1', () => {
    const [a, b, c, d]: Pt[] = [[0, 0], [1, 2], [3, 2], [4, 0]];
    expect(cubicAt(a, b, c, d, 0)).toEqual(a);
    expect(cubicAt(a, b, c, d, 1)).toEqual(d);
    expect(cubicAt(a, b, c, d, 0.5)).toEqual([2, 1.5]);
  });
});

describe('bezierBox', () => {
  test('straight polygon: the anchor points', () => {
    const nodes: BNode[] = [{ p: [2, 3] }, { p: [10, 1] }, { p: [6, 9] }];
    expect(bezierBox(nodes, true)).toEqual({ x: 2, y: 1, w: 8, h: 8 });
  });
  test('curve: includes the bulge between anchors, not the handles', () => {
    // Arch from (0,0) to (4,0) with handles at y = 4: the peak is at y = 3.
    const nodes: BNode[] = [{ p: [0, 0], out: [0, 4] }, { p: [4, 0], in: [4, 4] }];
    const b = bezierBox(nodes, false);
    expect(b.x).toBe(0);
    expect(b.w).toBe(4);
    expect(b.y).toBe(0);
    expect(b.h).toBeCloseTo(3, 9);
  });
});

describe('toBezier', () => {
  test('a plain rect becomes its four corners', () => {
    const b = toBezier(rect('r', 2, 2, 20, 10));
    expect(b.closed).toBe(true);
    expect(b.nodes.map((n) => n.p)).toEqual([[2, 2], [22, 2], [22, 12], [2, 12]]);
  });
  test('a rounded rect keeps its bounds', () => {
    const r = rect('r', 2, 2, 20, 10, 3);
    const b = toBezier(r);
    expect(b.nodes).toHaveLength(8);
    expect(bezierBox(b.nodes, true)).toEqual(bbox(r));
  });
  test('the radius is clamped to half the shorter side', () => {
    const b = toBezier(rect('r', 0, 0, 10, 4, 50));
    expect(bezierBox(b.nodes, true)).toEqual({ x: 0, y: 0, w: 10, h: 4 });
  });
});

describe('expandCorners', () => {
  test('leaves paths without radii alone', () => {
    const nodes: BNode[] = [{ p: [0, 0] }, { p: [10, 0] }, { p: [10, 10] }];
    expect(expandCorners(nodes, true)).toBe(nodes);
  });
  test('a rounded right angle becomes two points r away from the corner', () => {
    const nodes: BNode[] = [{ p: [0, 0] }, { p: [10, 0], radius: 2 }, { p: [10, 10] }, { p: [0, 10] }];
    const out = expandCorners(nodes, true);
    expect(out).toHaveLength(5);
    expect(closeTo(out[1].p, [8, 0])).toBe(true);
    expect(closeTo(out[2].p, [10, 2])).toBe(true);
  });
  test('the radius shrinks to fit short legs', () => {
    const nodes: BNode[] = [{ p: [0, 0] }, { p: [4, 0], radius: 10 }, { p: [4, 4] }, { p: [0, 4] }];
    const out = expandCorners(nodes, true);
    expect(closeTo(out[1].p, [2, 0])).toBe(true); // half of the 4-unit leg
  });
  test('open path ends are never rounded', () => {
    const nodes: BNode[] = [{ p: [0, 0], radius: 2 }, { p: [10, 0] }, { p: [10, 10], radius: 2 }];
    expect(expandCorners(nodes, false)).toHaveLength(3);
  });
});

describe('splitSegment', () => {
  test('Add Anchor on a straight line: a plain point where you clicked', () => {
    const s = path('p', [[0, 0], [10, 0]]) as BezierShape;
    const hit = nearestOnPath(s, [2.5, 1]);
    expect(hit.dist).toBeCloseTo(1, 3);
    splitSegment(s, hit.seg, hit.t);
    expect(closeTo(s.nodes[1].p, [2.5, 0], 1e-3)).toBe(true);
    expect(s.nodes[1].in).toBeUndefined();
  });
  test('a curve keeps its exact shape', () => {
    const s: BezierShape = { ...(path('p', []) as BezierShape), nodes: [{ p: [0, 0], out: [0, 8] }, { p: [10, 0], in: [10, 8] }] };
    const before = (t: number) => cubicAt([0, 0], [0, 8], [10, 8], [10, 0], t);
    splitSegment(s, 0, 0.5);
    const [a, m, b] = s.nodes;
    expect(closeTo(m.p, before(0.5))).toBe(true);
    // Points on each half match the original curve.
    expect(closeTo(cubicAt(a.p, a.out!, m.in!, m.p, 0.5), before(0.25))).toBe(true);
    expect(closeTo(cubicAt(m.p, m.out!, b.in!, b.p, 0.5), before(0.75))).toBe(true);
  });
  test('the closing segment of a closed path wraps around', () => {
    const s = path('p', [[0, 0], [10, 0], [10, 10]], true) as BezierShape;
    splitSegment(s, 2, 0.5);
    expect(s.nodes[3].p).toEqual([5, 5]);
  });
});

describe('bezierToPath', () => {
  test('lines, curves and closing', () => {
    const nodes: BNode[] = [{ p: [0, 0] }, { p: [10, 0], out: [10, 5] }, { p: [0, 10], in: [5, 10] }];
    expect(bezierToPath(nodes, true)).toBe('M0 0 L10 0 C10 5 5 10 0 10 L0 0 Z');
  });
  test('rounds to 2 decimals', () => {
    expect(bezierToPath([{ p: [1 / 3, 2 / 3] }, { p: [1, 1] }], false)).toBe('M0.33 0.67 L1 1');
  });
});
