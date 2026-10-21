import { describe, expect, test } from 'vitest';
import { cubicAt } from '../src/geometry';
import { parsePathData } from '../src/svgimport';
import { closeTo } from './helpers';

const points = (d: string) => parsePathData(d).map((s) => s.nodes.map((n) => n.p));

describe('parsePathData', () => {
  test('absolute and relative lines, H and V', () => {
    expect(points('M1 1 L5 1 l0 4 H1 v-4')).toEqual([[[1, 1], [5, 1], [5, 5], [1, 5], [1, 1]]]);
  });
  test('extra pairs after M are lines', () => {
    expect(points('M0 0 10 0 10 10')).toEqual([[[0, 0], [10, 0], [10, 10]]]);
    expect(points('m1 1 2 0 0 2')).toEqual([[[1, 1], [3, 1], [3, 3]]]);
  });
  test('Z closes and the next relative move starts from the subpath start', () => {
    const subs = parsePathData('M2 2 h4 v4 z m1 1 h1');
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[1].nodes[0].p).toEqual([3, 3]);
  });
  test('compact numbers: signs, decimals and exponents as separators', () => {
    expect(points('M.5.5L1e1-2.5')).toEqual([[[0.5, 0.5], [10, -2.5]]]);
  });
  test('C keeps handles; S reflects the previous one', () => {
    const [s] = parsePathData('M0 0 C0 4 4 4 4 0 S8 -4 8 0');
    expect(s.nodes[0].out).toEqual([0, 4]);
    expect(s.nodes[1].in).toEqual([4, 4]);
    expect(s.nodes[1].out).toEqual([4, -4]); // reflection of (4,4) about (4,0)
    expect(s.nodes[2].p).toEqual([8, 0]);
  });
  test('Q becomes the exact equivalent cubic (2/3 rule); T reflects', () => {
    const [s] = parsePathData('M0 0 Q3 6 6 0 T12 0');
    expect(closeTo(s.nodes[0].out!, [2, 4])).toBe(true);
    expect(closeTo(s.nodes[1].in!, [4, 4])).toBe(true);
    expect(closeTo(s.nodes[1].out!, [8, -4])).toBe(true); // control reflected to (9,-6)
    expect(s.nodes[2].p).toEqual([12, 0]);
  });
  test('an arc ends at its end point and stays on the circle', () => {
    const [s] = parsePathData('M0 5 A5 5 0 0 1 10 5');
    const last = s.nodes[s.nodes.length - 1];
    expect(closeTo(last.p, [10, 5], 1e-9)).toBe(true);
    for (let i = 0; i < s.nodes.length - 1; i++) {
      const [a, b] = [s.nodes[i], s.nodes[i + 1]];
      const m = cubicAt(a.p, a.out!, b.in!, b.p, 0.5);
      expect(Math.hypot(m[0] - 5, m[1] - 5)).toBeCloseTo(5, 2);
    }
    // Sweep flag 1 goes over the top (smaller y in SVG).
    const mid = s.nodes[Math.floor(s.nodes.length / 2)].p;
    expect(mid[1]).toBeLessThan(5);
  });
  test('arc flags written without separators', () => {
    expect(points('M0 5 a5 5 0 0110 0')).toEqual(points('M0 5 a5 5 0 0 1 10 0'));
  });
  test('an arc with a zero radius is a line', () => {
    expect(points('M0 0 A0 0 0 0 1 4 4')).toEqual([[[0, 0], [4, 4]]]);
  });
  test('ignores junk before the first command', () => {
    expect(points('5 5 M1 1 L2 2')).toEqual([[[1, 1], [2, 2]]]);
  });
});
