// @vitest-environment jsdom
import { beforeAll, describe, expect, test } from 'vitest';
import type { Shape } from '../src/model';
import { pathOpsReady } from '../src/pathops';
import { extractSvg, importSvg, svgSize } from '../src/svgimport';

beforeAll(() => pathOpsReady);

// jsdom has no canvas; colour parsing uses a 2D context's fillStyle to normalise
// CSS colours, so stand in for it the way browsers answer (hex, or rgba when translucent).
const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff' };
HTMLCanvasElement.prototype.getContext = function () {
  let fill = '#000000';
  return {
    get fillStyle() {
      return fill;
    },
    set fillStyle(v: string) {
      const c = v.trim().toLowerCase();
      const short = c.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
      if (short) fill = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
      else if (/^#[0-9a-f]{6}$/.test(c)) fill = c;
      else if (NAMED[c]) fill = NAMED[c];
      else if (/^rgba?\(/.test(c)) fill = c;
    },
  };
} as unknown as typeof HTMLCanvasElement.prototype.getContext;

const at1 = { k: 1, tx: 0, ty: 0 };
const svg = (body: string, attrs = 'viewBox="0 0 24 24" width="24" height="24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const only = (text: string, outer = at1) => {
  const r = importSvg(text, outer)!;
  expect(r.shapes).toHaveLength(1);
  return r.shapes[0];
};

describe('importSvg', () => {
  test('a rect stays a live rect with its colour and radius', () => {
    const s = only(svg('<rect x="2" y="3" width="10" height="8" rx="2" fill="#ff0000"/>'));
    expect(s).toMatchObject({ type: 'rect', x: 2, y: 3, w: 10, h: 8, r: 2, fill: '#FF0000' });
  });
  test('placement scales and moves onto the canvas', () => {
    const s = only(svg('<rect x="2" y="2" width="10" height="10"/>'), { k: 2, tx: 100, ty: 50 }) as Extract<Shape, { type: 'rect' }>;
    expect([s.x, s.y, s.w, s.h]).toEqual([104, 54, 20, 20]);
  });
  test('viewBox scaling is applied', () => {
    const s = only(svg('<rect x="0" y="0" width="480" height="480"/>', 'viewBox="0 0 960 960" width="24" height="24"')) as Extract<Shape, { type: 'rect' }>;
    expect(s.w).toBe(12);
  });
  test('group transforms: translate + rotate keep a rect live with rotation', () => {
    const s = only(svg('<g transform="translate(12 12) rotate(45)"><rect x="-4" y="-4" width="8" height="8"/></g>'));
    expect(s.type).toBe('rect');
    expect(s.rotation).toBeCloseTo(45, 6);
  });
  test('a skewed rect becomes a path', () => {
    expect(only(svg('<rect width="8" height="8" transform="skewX(20)"/>')).type).toBe('bezier');
  });
  test('a path with a hole becomes an Exclude group', () => {
    const s = only(svg('<path d="M2 2H22V22H2Z M6 6V18H18V6Z"/>'));
    expect(s.type).toBe('boolean');
    expect(s.type === 'boolean' && s.op).toBe('exclude');
    expect(s.type === 'boolean' && s.children).toHaveLength(2);
  });
  test('an outline-only path with two subpaths becomes two paths', () => {
    const r = importSvg(svg('<path d="M2 2H10 M2 6H10" fill="none" stroke="#000" stroke-width="2"/>'), at1)!;
    expect(r.shapes.map((s) => s.type)).toEqual(['bezier', 'bezier']);
    expect(r.shapes[0].strokeWidth).toBe(2);
  });
  test('fill inherits from the parent group and CSS classes apply', () => {
    const r = importSvg(svg('<style>.c{fill:#00ff00}</style><g fill="#0000ff"><rect width="4" height="4"/><rect class="c" x="5" width="4" height="4"/></g>'), at1)!;
    expect(r.shapes.map((s) => s.fill)).toEqual(['#0000FF', '#00FF00']);
  });
  test('a Figma white background frame is dropped', () => {
    const r = importSvg(svg('<rect width="24" height="24" fill="white"/><circle cx="12" cy="12" r="6"/>'), at1)!;
    expect(r.shapes.map((s) => s.type)).toEqual(['ellipse']);
  });
  test('text and images are reported as skipped', () => {
    const r = importSvg(svg('<text>Hi</text><image href="x.png"/><rect width="4" height="4"/>'), at1)!;
    expect(r.shapes).toHaveLength(1);
    expect(r.skipped.sort()).toEqual(['images', 'text']);
  });
  test('rgba with zero alpha is no fill', () => {
    expect(only(svg('<rect width="4" height="4" fill="rgba(0,0,0,0)" stroke="#000" stroke-width="1"/>')).fill).toBe('none');
  });
  test('not SVG: null', () => {
    expect(importSvg('hello', at1)).toBeNull();
  });
});

describe('extractSvg / svgSize', () => {
  test('pulls the SVG out of surrounding HTML', () => {
    expect(extractSvg('<div><svg viewBox="0 0 1 1"></svg></div>')).toBe('<svg viewBox="0 0 1 1"></svg>');
    expect(extractSvg('no svg here')).toBeNull();
  });
  test('size comes from width/height, else the viewBox', () => {
    expect(svgSize(svg('', 'width="48" height="32"'))).toEqual({ w: 48, h: 32 });
    expect(svgSize(svg('', 'viewBox="0 -960 960 960"'))).toEqual({ w: 960, h: 960 });
  });
});
