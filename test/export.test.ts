import { crc32 as nodeCrc32 } from 'node:zlib';
import { beforeAll, describe, expect, test } from 'vitest';
import { singlePathSvg, snakeName, vectorDrawable, zip } from '../src/export';
import { glyphNames } from '../src/fontexport';
import type { Artboard, Doc } from '../src/model';
import { pathOpsReady } from '../src/pathops';
import { group, rect } from './helpers';

beforeAll(() => pathOpsReady);

const ab: Artboard = { id: 'ab', name: 'home', x: 0, y: 0, w: 24, h: 24 };
const docWith = (...shapes: Doc['shapes']): Doc => ({ name: 'Test', artboards: [ab], shapes });
const ring = () => group('g', 'exclude', [rect('a', 2, 2, 20), rect('b', 6, 6, 12)]);

describe('Android vector drawable', () => {
  test('single path keeps the even-odd rule', () => {
    const xml = vectorDrawable(docWith(ring()), ab, { currentColor: false, singlePath: true });
    expect(xml).toContain('android:fillType="evenOdd"');
  });
  test('layered export keeps the even-odd rule on boolean groups (regression)', () => {
    const xml = vectorDrawable(docWith(ring()), ab, { currentColor: false, singlePath: false });
    expect(xml).toContain('android:fillType="evenOdd"');
  });
  test('a plain shape has no fill type and uses its colour', () => {
    const xml = vectorDrawable(docWith({ ...rect('r', 2, 2, 20), fill: '#ff0000' }), ab, { currentColor: false, singlePath: false });
    expect(xml).not.toContain('fillType');
    expect(xml).toContain('android:fillColor="#FF0000"');
    expect(xml).toContain('android:width="24dp"');
  });
  test('currentColor maps to white', () => {
    const xml = vectorDrawable(docWith(rect('r', 2, 2, 20)), ab, { currentColor: true, singlePath: true });
    expect(xml).toContain('@android:color/white');
  });
});

describe('single-path SVG', () => {
  test('plain 24px grid', () => {
    const svg = singlePathSvg(docWith(rect('r', 2, 2, 20)), ab, { currentColor: false, grid960: false })!;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#000000"><path d="M2 2L22 2L22 22L2 22L2 2Z"')).toBe(true);
  });
  test('Material 960 grid: y runs from -960 to 0', () => {
    const svg = singlePathSvg(docWith(rect('r', 0, 0, 24)), ab, { currentColor: false, grid960: true })!;
    expect(svg).toContain('viewBox="0 -960 960 960"');
    expect(svg).toContain('d="M0 -960L960 -960L960 0L0 0L0 -960Z"');
  });
  test('even-odd result carries fill-rule', () => {
    const svg = singlePathSvg(docWith(ring()), ab, { currentColor: true, grid960: false })!;
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('fill="currentColor"');
  });
});

describe('zip', () => {
  test('stored entries with correct CRCs, sizes and directory', async () => {
    const enc = new TextEncoder();
    const files = [
      { name: 'a.svg', data: enc.encode('<svg/>') },
      { name: 'dir/b.txt', data: enc.encode('hello world') },
    ];
    const bytes = new Uint8Array(await zip(files).arrayBuffer());
    const v = new DataView(bytes.buffer);
    let off = 0;
    for (const f of files) {
      expect(v.getUint32(off, true)).toBe(0x04034b50);
      expect(v.getUint32(off + 14, true)).toBe(nodeCrc32(f.data));
      expect(v.getUint32(off + 18, true)).toBe(f.data.length);
      const nameLen = v.getUint16(off + 26, true);
      expect(new TextDecoder().decode(bytes.slice(off + 30, off + 30 + nameLen))).toBe(f.name);
      off += 30 + nameLen + f.data.length;
    }
    const end = bytes.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    expect(v.getUint32(end + 16, true)).toBe(off); // central directory starts after the files
  });
});

describe('names', () => {
  test('snake_case file names', () => {
    expect(snakeName('My Cool Icon!')).toBe('my_cool_icon');
  });
  test('glyph names never collide (regression)', () => {
    expect(glyphNames(['x', 'x', 'x_2', 'y'])).toEqual(['x', 'x_3', 'x_2', 'y']);
    expect(glyphNames(['a', 'a', 'a'])).toEqual(['a', 'a_2', 'a_3']);
    const many = glyphNames(['x_2', 'x', 'x', 'x', 'x_3']);
    expect(new Set(many).size).toBe(many.length);
  });
});
