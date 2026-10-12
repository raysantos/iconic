// Getting SVG in: Import SVG… (Ctrl+Shift+P, Illustrator's Place), dropping
// .svg files on the window, and pasting from Figma ("Copy as SVG"), Illustrator
// and web pages. The parsing lives in svgimport.ts, the placement in actions.ts.
import * as A from './actions';
import { fitAll, fitArtboard } from './canvas';
import { pathOpsReady } from './pathops';
import { extractSvg } from './svgimport';
import { state } from './store';

let toast: (msg: string) => void = () => {};

type Mode = 'center' | 'inPlace';

interface Clip {
  svg?: string; // image/svg+xml
  plain?: string;
  html?: string;
  files?: File[];
  hasImage?: boolean; // a bitmap (e.g. "Copy image" of a PNG)
}

const isSvgFile = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

function report(r: A.ImportReport | null, what = 'shape') {
  if (!r || (!r.shapes && !r.failed.length)) return toast('Nothing to import — the SVG has no visible shapes');
  const parts = [`Imported ${r.shapes} ${what}${r.shapes === 1 ? '' : 's'}`];
  if (r.skipped.length) parts.push(`skipped ${r.skipped.join(' and ')} (convert to outlines first)`);
  if (r.failed.length) parts.push(`couldn’t read ${r.failed.join(', ')}`);
  toast(parts.join(' — '));
}

// SVG behind an <img> in copied or dragged web content: inline data, or fetched
// (works when the site allows it).
async function svgFromHtml(html: string): Promise<string | null> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const img of doc.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src')!;
    const m = src.match(/^data:image\/svg\+xml(;base64)?,(.*)$/i);
    if (m) return m[1] ? atob(m[2]) : decodeURIComponent(m[2]);
    if (/\.svg(\?|#|$)/i.test(src)) {
      const text = await fetchSvg(src);
      if (text) return text;
    }
  }
  return null;
}

async function fetchSvg(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const text = res.ok ? await res.text() : '';
    return extractSvg(text);
  } catch {
    return null; // blocked by the site (CORS) or offline
  }
}

// Paste: SVG code wins; our own copy (or no SVG at all) uses the internal clipboard.
async function handleClip(c: Clip, mode: Mode) {
  const files = c.files?.filter(isSvgFile) ?? [];
  if (files.length) return importFiles(files);
  let svg = [c.svg, c.plain, c.html].map((t) => t && extractSvg(t)).find(Boolean) ?? null;
  if (!svg && c.html) svg = await svgFromHtml(c.html);
  if (svg && !A.isOwnCopy(svg)) {
    await pathOpsReady;
    return report(A.pasteSvg(svg, mode));
  }
  if (svg || state.clipboard.length) return A.paste(mode);
  if (c.html?.includes('figmeta') || c.html?.includes('(figma)')) {
    return toast('Figma copies in its own format. In Figma, right-click → Copy/Paste as → Copy as SVG, then paste here');
  }
  if (c.hasImage) return toast('That’s a picture, not vector art. Copy the SVG code (or save the .svg and drop it here)');
  if (c.plain || c.html) toast('No SVG on the clipboard. In Illustrator, turn on Preferences → Clipboard Handling → SVG Code');
}

// ---- Keyboard paste ------------------------------------------------------------
// Ctrl+V lets the browser fire its paste event (which carries what Figma,
// Illustrator or a web page copied, with no permission prompt). If no event
// arrives, it falls back to the internal clipboard.

let pending: { mode: Mode; timer: number } | null = null;

export function armPaste(mode: Mode) {
  if (pending) clearTimeout(pending.timer);
  pending = {
    mode,
    timer: window.setTimeout(() => {
      pending = null;
      A.paste(mode);
    }, 120),
  };
}

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

document.addEventListener('paste', (e) => {
  if (typing(e.target)) return;
  const mode = pending?.mode ?? 'center';
  if (pending) clearTimeout(pending.timer);
  pending = null;
  e.preventDefault();
  const dt = e.clipboardData;
  if (!dt) return A.paste(mode);
  void handleClip(
    {
      svg: dt.getData('image/svg+xml'),
      plain: dt.getData('text/plain'),
      html: dt.getData('text/html'),
      files: [...dt.files],
      hasImage: [...dt.items].some((i) => i.type.startsWith('image/') && i.type !== 'image/svg+xml'),
    },
    mode,
  );
});

// Paste from the menu (pen and touch: no keyboard). Asks for clipboard access once.
export async function pasteFromMenu() {
  const c: Clip = {};
  try {
    for (const item of await navigator.clipboard.read()) {
      const text = async (type: string) => (item.types.includes(type) ? (await item.getType(type)).text() : undefined);
      c.svg ??= await text('image/svg+xml');
      c.plain ??= await text('text/plain');
      c.html ??= await text('text/html');
      c.hasImage ||= item.types.some((t) => t.startsWith('image/') && t !== 'image/svg+xml');
    }
  } catch {
    try {
      c.plain = await navigator.clipboard.readText();
    } catch {
      if (state.clipboard.length) return A.paste('center');
      return toast('Allow clipboard access to paste from other apps');
    }
  }
  await handleClip(c, 'center');
}

// ---- Files ---------------------------------------------------------------------

async function importFiles(files: File[]) {
  const svgs = files.filter(isSvgFile);
  if (!svgs.length) return toast('Only .svg files can be imported');
  const read = await Promise.all(svgs.map(async (f) => ({ name: f.name, text: await f.text() })));
  await pathOpsReady;
  const r = A.importSvgFiles(read);
  if (read.length > 1) fitAll();
  else fitArtboard();
  report(r);
}

const picker = Object.assign(document.createElement('input'), { type: 'file', accept: '.svg,image/svg+xml', multiple: true });
picker.addEventListener('change', () => {
  const files = [...(picker.files ?? [])];
  picker.value = '';
  if (files.length) void importFiles(files);
});

export const openImport = () => picker.click();

// Drop .svg files (or an SVG dragged from a web page) anywhere on the window.
const carriesImport = (dt: DataTransfer | null) => !!dt && (dt.types.includes('Files') || dt.types.includes('text/uri-list') || dt.types.includes('text/html'));

window.addEventListener('dragover', (e) => {
  if (!carriesImport(e.dataTransfer)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
});

window.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (!carriesImport(dt) || (e.target as Element).closest?.('input, textarea')) return;
  e.preventDefault();
  const files = [...dt!.files];
  if (files.length) return void importFiles(files);
  const html = dt!.getData('text/html');
  const url = dt!.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'));
  void (async () => {
    const svg = (html && (extractSvg(html) || (await svgFromHtml(html)))) || (url && (await fetchSvg(url.trim())));
    if (!svg) return toast('Couldn’t get the SVG — save it as a file and drop that instead');
    await pathOpsReady;
    report(A.pasteSvg(svg, 'center'));
  })();
});

export function installImport(hooks: { toast: (msg: string) => void }) {
  toast = hooks.toast;
}
