// Icon-font export (like the classic Material Icons font): one glyph per
// artboard on a 960-unit em, a Private Use Area codepoint for each, and a
// "liga" ligature so typing the icon's name shows the icon.
import { download, snakeName, visibleOn, zip } from './export';
import type { Artboard, Doc, Pt } from './model';
import { flattenArtboard } from './pathops';

const EM = 960;
const PUA = 0xe000;

type Cmd = { op: 'M' | 'L' | 'Q' | 'C' | 'Z'; pts: Pt[] };

// Parse the absolute M/L/Q/C/Z path data Skia produces.
function parsePath(d: string): Cmd[] {
  const tokens = d.match(/[MLQCZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const cmds: Cmd[] = [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const op = tokens[i++].toUpperCase() as Cmd['op'];
    const n = { M: 1, L: 1, Q: 2, C: 3, Z: 0 }[op];
    if (n === undefined) continue;
    const pts: Pt[] = [];
    for (let k = 0; k < n; k++) pts.push([num(), num()]);
    cmds.push({ op, pts });
  }
  return cmds;
}

// Split into contours, flip to font coordinates (y up), and orient them for
// nonzero filling: outlines counter-clockwise, holes clockwise (CFF convention).
function toFontContours(d: string): Cmd[][] {
  const contours: Cmd[][] = [];
  for (const c of parsePath(d)) {
    if (c.op === 'M') contours.push([]);
    if (!contours.length) contours.push([]);
    contours[contours.length - 1].push({ op: c.op, pts: c.pts.map(([x, y]) => [x, EM - y] as Pt) });
  }
  const polys = contours.map((c) => c.flatMap((cmd) => cmd.pts));
  const area = (p: Pt[]) => p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0) / 2;
  const insidePoly = ([x, y]: Pt, p: Pt[]) => {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
    }
    return inside;
  };
  return contours.map((c, i) => {
    const probe = polys[i][0];
    const depth = polys.filter((p, j) => j !== i && probe && insidePoly(probe, p)).length;
    const wantCCW = depth % 2 === 0;
    return wantCCW === area(polys[i]) > 0 ? c : reverse(c);
  });
}

// Reverse a contour's direction (start point stays a point on the outline).
function reverse(c: Cmd[]): Cmd[] {
  const start = c[0].pts[0];
  const segs: { op: Cmd['op']; from: Pt; ctrl: Pt[]; to: Pt }[] = [];
  let cur = start;
  for (const cmd of c.slice(1)) {
    if (cmd.op === 'Z') continue;
    const to = cmd.pts[cmd.pts.length - 1];
    segs.push({ op: cmd.op, from: cur, ctrl: cmd.pts.slice(0, -1), to });
    cur = to;
  }
  const out: Cmd[] = [{ op: 'M', pts: [cur] }];
  for (const s of segs.reverse()) out.push({ op: s.op, pts: [...s.ctrl.reverse(), s.from] });
  out.push({ op: 'Z', pts: [] });
  return out;
}

// WOFF 1.0: the font's tables, each zlib-compressed (CompressionStream "deflate").
async function toWoff(otf: ArrayBuffer): Promise<Uint8Array> {
  const src = new DataView(otf);
  const numTables = src.getUint16(4);
  const tables: { tag: number; checksum: number; data: Uint8Array; comp: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const offset = src.getUint32(rec + 8);
    const length = src.getUint32(rec + 12);
    const data = new Uint8Array(otf, offset, length);
    const comp = new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    tables.push({ tag: src.getUint32(rec), checksum: src.getUint32(rec + 4), data, comp: comp.length < length ? comp : data });
  }
  const pad = (n: number) => (n + 3) & ~3;
  const headerLen = 44 + 20 * numTables;
  const total = tables.reduce((n, t) => n + pad(t.comp.length), headerLen);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x774f4646); // 'wOFF'
  dv.setUint32(4, src.getUint32(0)); // flavor ('OTTO')
  dv.setUint32(8, total);
  dv.setUint16(12, numTables);
  dv.setUint32(16, 12 + 16 * numTables + tables.reduce((n, t) => n + pad(t.data.length), 0)); // totalSfntSize
  dv.setUint16(20, 1); // version 1.0
  let off = headerLen;
  tables.forEach((t, i) => {
    const e = 44 + i * 20;
    dv.setUint32(e, t.tag);
    dv.setUint32(e + 4, off);
    dv.setUint32(e + 8, t.comp.length);
    dv.setUint32(e + 12, t.data.length);
    dv.setUint32(e + 16, t.checksum);
    out.set(t.comp, off);
    off += pad(t.comp.length);
  });
  return out;
}

export async function exportIconFont(doc: Doc, boards: Artboard[]) {
  const { default: opentype } = await import('opentype.js'); // loaded only when needed
  const family = doc.name && doc.name !== 'Untitled' ? doc.name.trim() : 'Iconic Icons';
  const base = snakeName(family);

  const notdef = new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: EM, path: new opentype.Path() });
  // Every character used in icon names needs a (blank) glyph for ligatures to start from.
  const seen = new Map<string, number>();
  const names = boards.map((ab) => {
    const n = snakeName(ab.name);
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k > 1 ? `${n}_${k}` : n; // glyph names must be unique
  });
  const chars = [...new Set(names.join(''))].sort();
  const charGlyphs = chars.map((ch) => new opentype.Glyph({ name: ch === '_' ? 'underscore' : `uni${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`, unicode: ch.charCodeAt(0), advanceWidth: 0, path: new opentype.Path() }));
  const iconGlyphs = boards.map((ab, i) => {
    const k = EM / Math.max(ab.w, ab.h);
    const flat = flattenArtboard(visibleOn(doc.shapes, ab), ab, k);
    const path = new opentype.Path();
    if (flat?.d) {
      for (const contour of toFontContours(flat.d)) {
        for (const c of contour) {
          if (c.op === 'M') path.moveTo(...c.pts[0]);
          else if (c.op === 'L') path.lineTo(...c.pts[0]);
          else if (c.op === 'Q') path.quadraticCurveTo(c.pts[0][0], c.pts[0][1], c.pts[1][0], c.pts[1][1]);
          else if (c.op === 'C') path.curveTo(c.pts[0][0], c.pts[0][1], c.pts[1][0], c.pts[1][1], c.pts[2][0], c.pts[2][1]);
          else path.close();
        }
      }
    }
    return new opentype.Glyph({ name: names[i], unicode: PUA + i, advanceWidth: EM, path });
  });

  const font = new opentype.Font({ familyName: family, styleName: 'Regular', unitsPerEm: EM, ascender: EM, descender: 0, glyphs: [notdef, ...charGlyphs, ...iconGlyphs] });
  const glyphIndex = (ch: string) => 1 + chars.indexOf(ch);
  // Longest names first: OpenType applies the first ligature that matches, so
  // "file" must not win over "file_add".
  names
    .map((name, i) => ({ name, i }))
    .sort((x, y) => y.name.length - x.name.length)
    .forEach(({ name, i }) => font.substitution.add('liga', { sub: [...name].map(glyphIndex), by: 1 + chars.length + i }));

  const otf = font.toArrayBuffer();
  const woff = await toWoff(otf);
  const enc = new TextEncoder();
  const hex = (i: number) => (PUA + i).toString(16);
  const css = `@font-face {
  font-family: '${family}';
  src: url('${base}.woff') format('woff'), url('${base}.otf') format('opentype');
  font-display: block;
}

.${base} {
  font-family: '${family}';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'liga';
}

${names.map((n, i) => `.${base}-${n.replace(/_/g, '-')}::before { content: '\\${hex(i)}'; }`).join('\n')}
`;
  const codepoints = names.map((n, i) => `${n} ${hex(i)}`).join('\n') + '\n';
  const demo = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${family}</title><link rel="stylesheet" href="${base}.css">
<style>body{font:14px system-ui,sans-serif;margin:32px;color:#1f1f1f}h1{font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.card{border:1px solid #e3e3e3;border-radius:10px;padding:16px;text-align:center}
.card .${base}{font-size:48px}code{display:block;margin-top:8px;font-size:12px;color:#5f6368}</style></head>
<body><h1>${family}</h1><p>Use a ligature: <code>&lt;span class="${base}"&gt;name&lt;/span&gt;</code> — or a class: <code>&lt;span class="${base} ${base}-name"&gt;&lt;/span&gt;</code></p>
<div class="grid">${names.map((n, i) => `<div class="card"><span class="${base}">${n}</span><code>${n}</code><code>U+${hex(i).toUpperCase()}</code></div>`).join('')}</div>
</body></html>
`;
  download(
    zip([
      { name: `${base}.otf`, data: new Uint8Array(otf) },
      { name: `${base}.woff`, data: woff },
      { name: `${base}.css`, data: enc.encode(css) },
      { name: 'codepoints', data: enc.encode(codepoints) },
      { name: 'demo.html', data: enc.encode(demo) },
    ]),
    `${base}_font.zip`,
  );
}
