import { beforeEach, describe, expect, test } from 'vitest';
import { combos, locSuffix } from '../src/masters';
import type { Artboard } from '../src/model';
import { allShapes, checkpoint, commit, containerOf, redo, removeShape, state, undo } from '../src/store';
import { group, path, rect } from './helpers';

beforeEach(() => {
  state.doc = { name: 'Test', artboards: [{ id: 'ab', name: 'icon_1', x: 0, y: 0, w: 24, h: 24 }], shapes: [] };
  state.activeArtboard = 'ab';
  state.selection = [];
});

describe('removeShape (regression: shapes inside boolean groups)', () => {
  test('removes a top-level shape', () => {
    state.doc.shapes = [rect('a', 0, 0, 4), rect('b', 0, 0, 4)];
    removeShape('a');
    expect(state.doc.shapes.map((s) => s.id)).toEqual(['b']);
  });
  test('removes a shape inside a group and keeps the group', () => {
    state.doc.shapes = [group('g', 'union', [path('a', [[0, 0], [1, 1]]), path('b', [[2, 2], [3, 3]])])];
    removeShape('b');
    expect(allShapes().map((s) => s.id)).toEqual(['g', 'a']);
  });
  test('an emptied group goes too, all the way up', () => {
    state.doc.shapes = [rect('keep', 0, 0, 4), group('outer', 'union', [group('inner', 'exclude', [rect('a', 0, 0, 4)])])];
    removeShape('a');
    expect(allShapes().map((s) => s.id)).toEqual(['keep']);
  });
  test('unknown ids are ignored', () => {
    state.doc.shapes = [rect('a', 0, 0, 4)];
    removeShape('nope');
    expect(state.doc.shapes).toHaveLength(1);
    expect(containerOf('nope')).toBeNull();
  });
});

describe('undo / redo', () => {
  test('round-trips the document and drops selection of shapes that no longer exist', () => {
    checkpoint();
    state.doc.shapes.push(rect('a', 0, 0, 4));
    state.selection = ['a'];
    commit();
    undo();
    expect(state.doc.shapes).toHaveLength(0);
    expect(state.selection).toEqual([]);
    redo();
    expect(state.doc.shapes.map((s) => s.id)).toEqual(['a']);
  });
});

describe('masters', () => {
  test('locSuffix matches Google download names', () => {
    expect(locSuffix({ wght: 300, FILL: 1, GRAD: 0, opsz: 20 })).toBe('FILL1_wght300_GRAD0_opsz20');
    expect(locSuffix({ wght: 412.6, FILL: 0.5, GRAD: -25, opsz: 24 })).toBe('FILL0.5_wght413_GRAD-25_opsz24');
  });
  test('combos: every pick on axes that have a master, minus the drawn ones', () => {
    const base: Artboard = { id: 'base', name: 'home', x: 0, y: 0, w: 24, h: 24, variations: { wght: 400, FILL: 0, masters: [{ id: 'm', axis: 'wght', value: 700 }] } };
    state.doc.artboards = [base, { id: 'm', name: 'home_bold', x: 32, y: 0, w: 24, h: 24, masterOf: 'base' }];
    const out = combos(base, { wght: [100, 400, 700, 300, 300], FILL: [0, 1] });
    // FILL has no master, so it stays at the base value; 400 and 700 are already drawn.
    expect(out.map((l) => l.wght)).toEqual([100, 300]);
    expect(out.every((l) => l.FILL === 0 && l.opsz === 24)).toBe(true);
  });
});
