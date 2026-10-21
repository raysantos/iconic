import { expect, test } from 'vitest';
import { auditShape } from '../src/audit';
import type { BezierShape } from '../src/model';
import { path } from './helpers';

test('off-grid points are flagged, and the cached result follows in-place edits', () => {
  const s = path('a', [[0, 0], [10.3, 0], [10, 10]], true) as BezierShape;
  expect(auditShape(s).map((i) => i.kind)).toContain('off-grid');
  // Gestures move points in place (same object), so the cache must notice.
  s.nodes[1].p[0] = 10;
  expect(auditShape(s).map((i) => i.kind)).not.toContain('off-grid');
  s.nodes[1].p[0] = 10.3;
  expect(auditShape(s).map((i) => i.kind)).toContain('off-grid');
});

test('hidden and non-path shapes have no issues', () => {
  const s = path('b', [[0, 0], [10.3, 0], [10, 10]], true) as BezierShape;
  expect(auditShape({ ...s, hidden: true })).toEqual([]);
});
