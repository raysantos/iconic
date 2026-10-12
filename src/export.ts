// Material-style export: SVG, Android Vector Drawable, and PNG at Android densities.
// "Google format" merges each icon into one filled path (strokes outlined), the
// way Google ships Material icons; the working document stays editable.
import { locSuffix } from './masters';
import { intersects, round, worldBox } from './geometry';
import type { Artboard, Doc, Shape } from './model';
import { flattenArtboard, geometryPath, hasPathOps, shapeAreaPath, transformPath } from './pathops';
import { state } from './store';
import { exportSvgString } from './svg';

export type ExportFormat = 'svg' | 'xml' | 'png' | 'font';

// Android density buckets (1x = mdpi).
export const DENSITIES: { name: string; scale: number }[] = [
  { name: 'mdpi', scale: 1 },
  { name: 'hdpi', scale: 1.5 },
  { name: 'xhdpi', scale: 2 },
  { name: 'xxhdpi', scale: 3 },
  { name: 'xxxhdpi', scale: 4 },
];

export interface ExportOptions {
  format: ExportFormat;
  densities: string[]; // PNG only
  currentColor: boolean; // SVG: currentColor · XML: white + colorControlNormal tint
  singlePath: boolean; // Google format: one merged, filled path per icon
  grid960: boolean; // SVG: Material Symbols' 960-unit viewBox (0 -960 960 960)
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Material icon names are snake_case: "Arrow Back" -> "arrow_back".
export const snakeName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'icon';

// Material Symbols file naming (add_circle_24dp.svg) in Material mode; plain names otherwise.
export function fileBase(ab: Artboard) {
  if (!state.prefs.materialMode) return snakeName(ab.name);
  const dp = `${round(Math.max(ab.w, ab.h))}dp`;
  // Generated variations keep Google's download order: home_20dp_FILL1_wght300_GRAD200_opsz20.
  const sfx = ab.generated && locSuffix(ab.generated.loc);
  if (sfx && ab.name.endsWith(`_${sfx}`)) return `${snakeName(ab.name.slice(0, -sfx.length - 1))}_${dp}_${sfx}`;
  return `${snakeName(ab.name)}_${dp}`;
}

export const visibleOn = (shapes: Shape[], ab: Artboard) => shapes.filter((s) => !s.hidden && intersects(worldBox(s), ab));

// The color a shape shows: its fill, or its stroke for outline-only shapes.
export function paintColor(s: Shape): string | null {
  if (s.type === 'instance') return s.fill !== 'none' ? s.fill.toUpperCase() : null; // null: keeps the component's own colors
  if (s.type !== 'line' && s.fill !== 'none') return s.fill.toUpperCase();
  return s.strokeWidth > 0 ? s.stroke.toUpperCase() : null;
}

// One icon color for a merged path: the color covering the most shapes.
function iconColor(shapes: Shape[]) {
  const counts = new Map<string, number>();
  for (const s of shapes) {
    const c = paintColor(s);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#000000';
}

// The editable version: one element per shape.
function layeredSvg(doc: Doc, ab: Artboard, currentColor: boolean) {
  const svg = exportSvgString(doc.shapes, ab);
  return currentColor ? svg.replace(/(fill|stroke)="#[0-9a-fA-F]{3,8}"/g, '$1="currentColor"') : svg;
}

// Google format: <svg ... viewBox="0 -960 960 960" fill="#000"><path d="…"/></svg>
export function singlePathSvg(doc: Doc, ab: Artboard, opts: Pick<ExportOptions, 'currentColor' | 'grid960'>): string | null {
  const shapes = visibleOn(doc.shapes, ab);
  const grid960 = opts.grid960 && state.prefs.materialMode; // the 960 grid is a Material Symbols convention
  const k = grid960 ? 960 / Math.max(ab.w, ab.h) : 1;
  const flat = flattenArtboard(shapes, ab, k, grid960 ? -ab.h * k : 0);
  if (!flat) return null;
  const [w, h] = [round(ab.w * k), round(ab.h * k)];
  const viewBox = grid960 ? `0 ${-h} ${w} ${h}` : `0 0 ${w} ${h}`;
  const fill = opts.currentColor ? 'currentColor' : iconColor(shapes);
  const rule = flat.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" height="${round(ab.h)}px" viewBox="${viewBox}" width="${round(ab.w)}px" fill="${fill}"><path d="${flat.d}"${rule}/></svg>`;
}

// Android Vector Drawable, in artboard coordinates.
export function vectorDrawable(doc: Doc, ab: Artboard, opts: Pick<ExportOptions, 'currentColor' | 'singlePath'>) {
  const color = (c: string) => (opts.currentColor ? '@android:color/white' : c.toUpperCase());
  const shapes = visibleOn(doc.shapes, ab);
  let paths: string[];
  // Android has no masks, so knockouts always export merged.
  const knockouts = shapes.some((s) => s.type === 'instance' && (s.knockout ?? 0) > 0);
  const flat = opts.singlePath || knockouts ? flattenArtboard(shapes, ab) : null;
  if (flat) {
    const attrs = [`android:pathData="${flat.d}"`, `android:fillColor="${color(iconColor(shapes))}"`];
    if (flat.fillRule === 'evenodd') attrs.push('android:fillType="evenOdd"');
    paths = [`  <path\n      ${attrs.join('\n      ')}/>`];
  } else {
    paths = shapes.map((s) => {
      if (s.type === 'instance') {
        // An instance exports as its filled outline.
        return `  <path
      android:pathData="${transformPath(shapeAreaPath(s), 1, -ab.x, -ab.y)}"
      android:fillColor="${color(iconColor(shapes))}"/>`;
      }
      const attrs = [`android:pathData="${transformPath(geometryPath(s), 1, -ab.x, -ab.y)}"`];
      if (s.type !== 'line' && s.fill !== 'none') attrs.push(`android:fillColor="${color(s.fill)}"`);
      if (s.strokeWidth > 0) {
        attrs.push(
          `android:strokeColor="${color(s.stroke)}"`,
          `android:strokeWidth="${round(s.strokeWidth)}"`,
          `android:strokeLineCap="${s.cap ?? 'round'}"`,
          `android:strokeLineJoin="${s.join ?? 'round'}"`,
        );
      }
      return `  <path\n      ${attrs.join('\n      ')}/>`;
    });
  }
  return [
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${round(ab.w)}dp"`,
    `    android:height="${round(ab.h)}dp"`,
    `    android:viewportWidth="${round(ab.w)}"`,
    `    android:viewportHeight="${round(ab.h)}"${opts.currentColor ? '\n    android:tint="?attr/colorControlNormal"' : ''}>`,
    ...paths,
    '</vector>',
    '',
  ].join('\n');
}

async function rasterize(svg: string, w: number, h: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas');
  [c.width, c.height] = [w, h];
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c;
}

async function renderPng(svg: string, w: number, h: number): Promise<Uint8Array> {
  const c = await rasterize(svg, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---- Checks before a single-path export ----------------------------------------

export interface ExportIssue {
  artboard: string;
  kind: 'colors' | 'white' | 'outside' | 'pixels' | 'engine';
  message: string;
}

// Things that would make the merged icon look different from the working one.
export async function checkSinglePath(doc: Doc, boards: Artboard[]): Promise<ExportIssue[]> {
  const issues: ExportIssue[] = [];
  if (!hasPathOps()) return [{ artboard: '', kind: 'engine', message: 'The geometry engine is still loading — try again in a moment.' }];
  for (const ab of boards) {
    const shapes = visibleOn(doc.shapes, ab);
    const colors = new Set(shapes.map(paintColor).filter(Boolean));
    const whites = shapes.filter((s) => paintColor(s) === '#FFFFFF');
    if (whites.length && colors.size > 1) {
      issues.push({ artboard: ab.name, kind: 'white', message: `${whites.length} white shape${whites.length > 1 ? 's' : ''} will turn into the icon color instead of cutting a hole. Use Subtract.` });
    } else if (colors.size > 1) {
      issues.push({ artboard: ab.name, kind: 'colors', message: `Uses ${colors.size} colors; a single path has one color.` });
    }
    if (shapes.some((s) => {
      const b = worldBox(s);
      return b.x < ab.x - 0.01 || b.y < ab.y - 0.01 || b.x + b.w > ab.x + ab.w + 0.01 || b.y + b.h > ab.y + ab.h + 0.01;
    })) {
      issues.push({ artboard: ab.name, kind: 'outside', message: 'Artwork outside the artboard will be clipped.' });
    }
    // Pixel check: the merged path must render like the working version.
    const flat = singlePathSvg(doc, ab, { currentColor: false, grid960: false });
    if (!flat) {
      issues.push({ artboard: ab.name, kind: 'engine', message: 'Could not merge this icon; it will export as separate shapes.' });
      continue;
    }
    const diff = await pixelDifference(layeredSvg(doc, ab, false), flat, ab);
    if (diff > 0.002) issues.push({ artboard: ab.name, kind: 'pixels', message: `Merged icon differs from the working version on ${(diff * 100).toFixed(1)}% of pixels.` });
  }
  return issues;
}

// Share of pixels that differ visibly between two renderings (at 8x).
async function pixelDifference(a: string, b: string, ab: Artboard): Promise<number> {
  const k = 8;
  const [w, h] = [Math.max(1, Math.round(ab.w * k)), Math.max(1, Math.round(ab.h * k))];
  const [ca, cb] = await Promise.all([rasterize(a, w, h), rasterize(b, w, h)]);
  const da = ca.getContext('2d')!.getImageData(0, 0, w, h).data;
  const db = cb.getContext('2d')!.getImageData(0, 0, w, h).data;
  let bad = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) + Math.abs(da[i + 3] - db[i + 3]);
    if (d > 96) bad++; // ignore anti-aliasing noise along edges
  }
  return bad / (w * h);
}

// ---- Export --------------------------------------------------------------------

// One file downloads as-is; several are bundled into a .zip
// (PNGs go into Android drawable-<density>/ folders).
export async function exportArtboards(doc: Doc, boards: Artboard[], opts: ExportOptions) {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array; type: string }[] = [];
  const used = new Map<string, number>();
  const unique = (base: string) => {
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}_${n + 1}` : base;
  };
  const densities = DENSITIES.filter((d) => opts.densities.includes(d.name));

  for (const ab of boards) {
    const base = unique(fileBase(ab));
    if (opts.format === 'svg') {
      const svg = (opts.singlePath && singlePathSvg(doc, ab, opts)) || layeredSvg(doc, ab, opts.currentColor);
      files.push({ name: `${base}.svg`, data: enc.encode(svg), type: 'image/svg+xml' });
    } else if (opts.format === 'xml') {
      files.push({ name: `${base}.xml`, data: enc.encode(vectorDrawable(doc, ab, opts)), type: 'text/xml' });
    } else {
      const svg = layeredSvg(doc, ab, false);
      for (const d of densities) {
        const data = await renderPng(svg, Math.max(1, Math.round(ab.w * d.scale)), Math.max(1, Math.round(ab.h * d.scale)));
        files.push({ name: densities.length > 1 ? `drawable-${d.name}/${base}.png` : `${base}.png`, data, type: 'image/png' });
      }
    }
  }
  if (!files.length) return;
  if (files.length === 1) return download(new Blob([files[0].data as BlobPart], { type: files[0].type }), files[0].name);
  download(zip(files), `${snakeName(doc.name)}_${opts.format}.zip`);
}

// Minimal ZIP writer (stored, no compression — PNGs are already compressed).
export function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true); // compressed size
    local.setUint32(22, f.data.length, true); // uncompressed size
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central directory header
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
