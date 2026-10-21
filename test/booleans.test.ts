import { beforeAll, describe, expect, test } from 'vitest';
import { bbox } from '../src/geometry';
import type { BooleanShape } from '../src/model';
import { booleanResult, flattenArtboard, pathOpsReady, transformPath } from '../src/pathops';
import { group, rect } from './helpers';

beforeAll(() => pathOpsReady);

const contours = (d: string) => (d.match(/M/g) ?? []).length;
const result = (op: BooleanShape['op'], ...children: ReturnType<typeof rect>[]) => booleanResult(group(`g-${op}-${Math.random()}`, op, children) as BooleanShape)!;

describe('booleanResult', () => {
  test('union of overlapping squares: one outline covering both', () => {
    const r = result('union', rect('a', 0, 0, 10), rect('b', 5, 5, 10));
    expect(contours(r.d)).toBe(1);
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 15, h: 15 });
  });
  test('subtract: the bottom shape minus everything above it', () => {
    const r = result('subtract', rect('a', 0, 0, 20), rect('b', 5, 5, 10));
    expect(contours(r.d)).toBe(2); // outline plus hole
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 20, h: 20 });
  });
  test('subtract removes the union of all upper shapes', () => {
    const r = result('subtract', rect('a', 0, 0, 20), rect('b', 0, 0, 20, 10), rect('c', 0, 10, 20, 10));
    expect(r.d).toBe('');
    expect(r.bounds).toBeNull();
  });
  test('intersect keeps only the overlap', () => {
    const r = result('intersect', rect('a', 0, 0, 10), rect('b', 5, 5, 10));
    expect(r.bounds).toEqual({ x: 5, y: 5, w: 5, h: 5 });
  });
  test('exclude is even-odd: an inner square becomes a hole', () => {
    const r = result('exclude', rect('a', 0, 0, 20), rect('b', 5, 5, 10));
    expect(contours(r.d)).toBe(2);
    expect(r.fillRule).toBe('evenodd');
  });
  test('the box of a boolean group is its result, not its children', () => {
    const g = group('gi', 'intersect', [rect('a', 0, 0, 10), rect('b', 5, 5, 10)]);
    expect(bbox(g)).toEqual({ x: 5, y: 5, w: 5, h: 5 });
  });
  test('the cache notices a changed child', () => {
    const g = group('gc', 'union', [rect('a', 0, 0, 10)]) as BooleanShape;
    expect(booleanResult(g)!.bounds).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    (g.children[0] as { w: number }).w = 4;
    expect(booleanResult(g)!.bounds).toEqual({ x: 0, y: 0, w: 4, h: 10 });
  });
});

describe('flattenArtboard', () => {
  const ab = { x: 100, y: 100, w: 24, h: 24 };
  test('moves the artwork to (0,0) and clips it to the artboard', () => {
    const flat = flattenArtboard([rect('a', 104, 104, 30)], ab)!;
    expect(flat.d).toBe('M4 4L24 4L24 24L4 24L4 4Z');
  });
  test('scales for the 960 grid with a y offset', () => {
    const flat = flattenArtboard([rect('a', 100, 100, 24)], ab, 40, -960)!;
    expect(flat.d).toBe('M0 -960L960 -960L960 0L0 0L0 -960Z');
  });
  test('hidden-free empty input is an empty path', () => {
    expect(flattenArtboard([], ab)).toEqual({ d: '', fillRule: 'nonzero' });
  });
});

test('transformPath scales then moves', () => {
  expect(transformPath('M1 1L2 1L2 2Z', 2, 10, 20)).toBe('M12 22L14 22L14 24L12 22Z');
});
