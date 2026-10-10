// Material-style export: SVG, Android Vector Drawable, and PNG at Android densities.
import { bezierToPath, intersects, mapNodes, round, toBezier, worldBox } from './geometry';
import type { Artboard, Doc, Shape } from './model';
import { exportSvgString } from './svg';

export type ExportFormat = 'svg' | 'xml' | 'png';

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

// Material Symbols file naming: add_circle_24dp.svg
export const fileBase = (ab: Artboard) => `${snakeName(ab.name)}_${round(Math.max(ab.w, ab.h))}dp`;

const visibleOn = (shapes: Shape[], ab: Artboard) => shapes.filter((s) => !s.hidden && intersects(worldBox(s), ab));

function svgFor(doc: Doc, ab: Artboard, currentColor: boolean) {
  const svg = exportSvgString(doc.shapes, ab);
  return currentColor ? svg.replace(/(fill|stroke)="#[0-9a-fA-F]{3,8}"/g, '$1="currentColor"') : svg;
}

// Android Vector Drawable: one <path> per shape, in artboard coordinates.
export function vectorDrawable(doc: Doc, ab: Artboard, currentColor: boolean) {
  const color = (c: string) => (currentColor ? '@android:color/white' : c.toUpperCase());
  const paths = visibleOn(doc.shapes, ab).map((s) => {
    const b = toBezier(s);
    const d = bezierToPath(mapNodes(b.nodes, ([x, y]) => [x - ab.x, y - ab.y]), b.closed);
    const attrs = [`android:pathData="${d}"`];
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
  return [
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${round(ab.w)}dp"`,
    `    android:height="${round(ab.h)}dp"`,
    `    android:viewportWidth="${round(ab.w)}"`,
    `    android:viewportHeight="${round(ab.h)}"${currentColor ? '\n    android:tint="?attr/colorControlNormal"' : ''}>`,
    ...paths,
    '</vector>',
    '',
  ].join('\n');
}

async function renderPng(svg: string, w: number, h: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas');
  [c.width, c.height] = [w, h];
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

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
    if (opts.format === 'svg') files.push({ name: `${base}.svg`, data: enc.encode(svgFor(doc, ab, opts.currentColor)), type: 'image/svg+xml' });
    else if (opts.format === 'xml') files.push({ name: `${base}.xml`, data: enc.encode(vectorDrawable(doc, ab, opts.currentColor)), type: 'text/xml' });
    else {
      const svg = svgFor(doc, ab, false);
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
