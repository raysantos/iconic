import { describe, expect, test } from 'vitest';
import { cubicsToNodes, fitCurve, reverseNodes } from '../src/fit';
import { cubicAt } from '../src/geometry';
import type { Pt } from '../src/model';

type Cubic = [Pt, Pt, Pt, Pt];
const sample = (f: (t: number) => Pt, n = 40) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
function distToCurves(p: Pt, cubics: Cubic[]) {
  let best = Infinity;
  for (const c of cubics)
    for (let i = 0; i <= 200; i++) {
      const q = cubicAt(...c, i / 200);
      best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
  return best;
}

describe('fitCurve', () => {
  test('a straight run of points is one segment between the ends', () => {
    const cubics = fitCurve(sample((t) => [t * 10, t * 5]), 0.1);
    expect(cubics).toHaveLength(1);
    expect(cubics[0][0]).toEqual([0, 0]);
    expect(cubics[0][3]).toEqual([10, 5]);
  });
  test('points from a known curve are followed within the tolerance', () => {
    const src: Cubic = [[0, 0], [0, 10], [10, 10], [10, 0]];
    const pts = sample((t) => cubicAt(...src, t));
    const cubics = fitCurve(pts, 0.05);
    expect(cubics[0][0]).toEqual([0, 0]);
    expect(cubics.at(-1)![3]).toEqual([10, 0]);
    for (const p of pts) expect(distToCurves(p, cubics)).toBeLessThan(0.05);
  });
  test('a sharp zig-zag splits into several segments', () => {
    const pts: Pt[] = [...sample((t) => [t * 10, t * 10], 10), ...sample((t) => [10 + t * 10, 10 - t * 10], 10).slice(1)];
    const cubics = fitCurve(pts, 0.05);
    expect(cubics.length).toBeGreaterThan(1);
    for (const p of pts) expect(distToCurves(p, cubics)).toBeLessThan(0.05);
  });
  test('duplicate points and too few points', () => {
    expect(fitCurve([[1, 1], [1, 1]], 1)).toEqual([]);
    expect(fitCurve([[0, 0], [0, 0], [4, 0]], 1)).toHaveLength(1);
  });
});

describe('cubicsToNodes / reverseNodes', () => {
  test('joins segments into smooth interior points', () => {
    const nodes = cubicsToNodes([
      [[0, 0], [1, 1], [2, 1], [3, 0]],
      [[3, 0], [4, -1], [5, -1], [6, 0]],
    ]);
    expect(nodes).toEqual([
      { p: [0, 0], out: [1, 1] },
      { p: [3, 0], in: [2, 1], out: [4, -1], smooth: true },
      { p: [6, 0], in: [5, -1] },
    ]);
  });
  test('reversing swaps handles, and reversing twice gives the original', () => {
    const nodes = cubicsToNodes([[[0, 0], [1, 1], [2, 1], [3, 0]]]);
    const r = reverseNodes(nodes);
    expect(r[0].p).toEqual([3, 0]);
    expect(r[0].out).toEqual([2, 1]);
    expect(r[0].in).toBeUndefined();
    expect(reverseNodes(r).map((n) => [n.p, n.in, n.out])).toEqual(nodes.map((n) => [n.p, n.in, n.out]));
  });
});
