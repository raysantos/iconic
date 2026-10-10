import type { Doc } from './model';
import { exportSvgString } from './svg';

export const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileBase = (doc: Doc) => doc.name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'icon';

export function exportSvg(doc: Doc) {
  download(new Blob([exportSvgString(doc)], { type: 'image/svg+xml' }), `${fileBase(doc)}.svg`);
}

async function renderPng(doc: Doc, px: number): Promise<Blob> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSvgString(doc));
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = px;
  c.getContext('2d')!.drawImage(img, 0, 0, px, px);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}

// One size downloads a .png; several are bundled into a .zip.
export async function exportPng(doc: Doc, sizes: number[]) {
  const base = fileBase(doc);
  if (sizes.length === 1) {
    download(await renderPng(doc, sizes[0]), `${base}-${sizes[0]}.png`);
    return;
  }
  const files = await Promise.all(
    sizes.map(async (n) => ({ name: `${base}-${n}.png`, data: new Uint8Array(await (await renderPng(doc, n)).arrayBuffer()) })),
  );
  download(zip(files), `${base}-png.zip`);
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
