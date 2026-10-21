// Export popover and the pre-export review dialog.
import * as A from '../actions';
import { checkSinglePath, DENSITIES, exportArtboards, fileBase, type ExportFormat, type ExportIssue } from '../export';
import { exportIconFont } from '../fontexport';
import { activeArtboard, artboards, savePrefs, state } from '../store';
import { q, h } from './dom';
import { closePop } from './popover';
import { segmented, toggleRow } from './controls';

export function exportControls() {
  const box = h('div', { class: 'export-controls' });
  const set = <K extends keyof typeof state.prefs>(key: K, v: (typeof state.prefs)[K]) => {
    state.prefs[key] = v;
    savePrefs();
    draw();
  };
  const draw = () => {
    const p = state.prefs;
    const count = artboards().length;
    const kids: Node[] = [];
    if (count > 1) kids.push(segmented<string>([['one', 'This artboard'], ['all', `All ${count}`]], p.exportAll ? 'all' : 'one', (v) => set('exportAll', v === 'all')));
    kids.push(
      segmented<ExportFormat>(
        [
          ['svg', 'SVG', 'Web / Material Symbols SVG'],
          ['xml', 'Android', 'Android Vector Drawable (.xml)'],
          ['png', 'PNG', 'PNG at Android densities'],
          ['font', 'Font', 'Icon font (OTF + WOFF) with ligatures and codepoints'],
        ],
        p.exportFormat,
        (v) => set('exportFormat', v),
      ),
    );
    if (p.exportFormat === 'font') {
      kids.push(h('p', { class: 'd-hint', textContent: 'One glyph per icon: type its name (ligature) or use its codepoint. Includes CSS, a codepoints file and a demo page.' }));
    } else if (p.exportFormat === 'png') {
      const chips = h('div', { class: 'chips' });
      const ab = activeArtboard();
      for (const d of DENSITIES) {
        const on = p.densities.includes(d.name);
        const c = h('button', { class: 'chip' + (on ? ' on' : ''), textContent: d.name, title: `${d.scale}x · ${Math.round(ab.w * d.scale)} px` });
        c.addEventListener('click', () => {
          const next = on ? p.densities.filter((x) => x !== d.name) : [...p.densities, d.name];
          if (next.length) set('densities', next);
        });
        chips.append(c);
      }
      kids.push(chips);
    } else {
      kids.push(toggleRow(p.materialMode ? 'Single path (Google format)' : 'Single path (merged)', '', p.singlePath, () => set('singlePath', !p.singlePath)));
      if (p.exportFormat === 'svg' && p.singlePath && p.materialMode) kids.push(toggleRow('960 grid (Material Symbols)', '', p.grid960, () => set('grid960', !p.grid960)));
      kids.push(toggleRow(p.exportFormat === 'svg' ? 'Use currentColor' : 'Tintable (colorControlNormal)', '', p.currentColor, () => set('currentColor', !p.currentColor)));
    }
    const boards = p.exportAll ? artboards() : [activeArtboard()];
    const ext = p.exportFormat;
    const single = boards.length === 1 && (p.exportFormat !== 'png' || p.densities.length === 1);
    const label = p.exportFormat === 'font' ? `Export icon font · ${boards.length} glyph${boards.length > 1 ? 's' : ''} (.zip)` : single ? `Export ${fileBase(boards[0])}.${ext}` : `Export ${boards.length > 1 ? `${boards.length} icons` : fileBase(boards[0])} (.zip)`;
    const go = h('button', { class: 'primary-btn', textContent: label });
    go.addEventListener('click', async () => {
      const opts = { format: p.exportFormat, densities: p.densities, currentColor: p.currentColor, singlePath: p.singlePath, grid960: p.grid960 };
      if ((p.singlePath && p.exportFormat !== 'png') || p.exportFormat === 'font') {
        go.textContent = 'Checking…';
        const issues = await checkSinglePath(state.doc, boards);
        go.textContent = label;
        if (issues.length && !(await reviewIssues(issues))) return;
      }
      closePop();
      if (p.exportFormat === 'font') return exportIconFont(state.doc, boards);
      await exportArtboards(state.doc, boards, opts);
    });
    kids.push(go);
    box.replaceChildren(...kids);
  };
  draw();
  return box;
}

// Lists what would make the merged icon differ, with fixes where possible.
// Resolves true to export anyway, false to cancel.
export function reviewIssues(issues: ExportIssue[]): Promise<boolean> {
  return new Promise((resolve) => {
    closePop();
    const dlg = q<HTMLDialogElement>('#reviewDialog');
    const list = h('ul', { class: 'issues' });
    for (const it of issues) {
      const li = h('li', {}, h('strong', { textContent: it.artboard ? `${it.artboard}: ` : '' }), it.message);
      if (it.kind === 'white') {
        const fix = h('button', { class: 'secondary-btn inline', textContent: 'Convert to Subtract' });
        fix.addEventListener('click', () => {
          const ab = artboards().find((a) => a.name === it.artboard);
          if (ab && A.whitesToSubtract(ab.id)) {
            li.classList.add('fixed');
            fix.replaceWith(h('span', { class: 'fixed-note', textContent: 'Fixed' }));
          }
        });
        li.append(fix);
      }
      list.append(li);
    }
    const cancel = h('button', { class: 'secondary-btn', textContent: 'Cancel' });
    const go = h('button', { class: 'primary-btn', textContent: 'Export anyway' });
    dlg.replaceChildren(
      h('h2', { textContent: 'Check before exporting' }),
      h('p', { class: 'd-hint', textContent: 'The single-path export would not match what you see:' }),
      list,
      h('div', { class: 'dialog-actions' }, cancel, go),
    );
    // The dialog element is shared (Variants uses it too), so its Esc listener goes on close.
    const onEsc = () => done(false);
    const done = (ok: boolean) => {
      dlg.removeEventListener('cancel', onEsc);
      dlg.close();
      resolve(ok);
    };
    cancel.addEventListener('click', () => done(false));
    go.addEventListener('click', () => done(true));
    dlg.addEventListener('cancel', onEsc);
    dlg.showModal();
  });
}
