# Iconic

**Live app:** https://raysantos.github.io/iconic/

A vector icon editor for PC and phone with a Figma-style interface and Adobe Illustrator keyboard shortcuts. It's a Progressive Web App (PWA): open it in a browser, then "Install" (desktop Chrome/Edge) or "Add to Home Screen" (iOS Safari / Android Chrome) to use it like a native app, including offline.

## Features

- **Figma-style workspace:** dark toolbar with tool flyouts, Layers panel, Design panel, zoomable/pannable canvas, light and dark themes
- **Artboard:** 16, 24, 32 or 48 px with pixel grid and half-pixel snapping (changing size scales the artwork)
- **Tools:** Selection, Direct Selection, Pen, Add/Delete/Convert Anchor Point, Rectangle, Ellipse, Line, Pencil, Hand, Zoom
- **Selection:** click, Shift-click, drag a marquee, Ctrl+A; 8 resize handles (Shift keeps proportions, Alt resizes from center), rotate by dragging just outside a corner (touch: top handle)
- **Pen & points:** click for corners, drag for curves (Alt breaks handles), click the first point to close; with Direct Selection (A) any shape's points can be edited — rectangles, ellipses and lines turn into paths on first edit
- **Design panel:** X/Y/W/H/rotation fields (drag the label to scrub, arrow keys step, math like `12+4` works), alignment, fill and stroke
- **Layers:** select, Shift/Ctrl-click to multi-select, drag to reorder, rename, lock, hide; hover a row to find the shape
- **Export:** SVG, or PNG at any mix of sizes from 16 to 1024 px (several sizes download as one .zip); copying also puts SVG on the clipboard
- **Undo/redo**, autosave to the device, mouse, touch (two-finger pinch/pan) and stylus input

## Keyboard shortcuts (Illustrator layout)

Press `Ctrl+/` in the app for the full list. Highlights:

| Tools | | Edit | | Object & view | |
|---|---|---|---|---|---|
| Selection | `V` | Paste / in front / in back | `Ctrl+V` / `Ctrl+F` / `Ctrl+B` | Arrange | `Ctrl+[` `Ctrl+]` (+`Shift` for back/front) |
| Direct Selection | `A` | Paste in place | `Ctrl+Shift+V` | Lock / Unlock all | `Ctrl+2` / `Ctrl+Alt+2` |
| Pen / Add / Delete / Convert | `P` `+` `-` `Shift+C` | Duplicate | `Alt`+drag | Hide / Show all | `Ctrl+3` / `Ctrl+Alt+3` |
| Rectangle / Ellipse / Line | `M` `L` `\` | Transform again | `Ctrl+D` | Fit / Actual size | `Ctrl+0` / `Ctrl+1` |
| Pencil / Hand / Zoom | `N` `H` `Z` | Select all / Deselect | `Ctrl+A` / `Ctrl+Shift+A` | Grid / Snap | `Ctrl+'` / `Ctrl+Shift+'` |
| Temporary hand | hold `Space` | Default colors / Swap / None | `D` / `Shift+X` / `/` | Hide panels | `Tab` |

On Mac, `Ctrl` is `⌘` and `Alt` is `⌥`. In a browser tab, Chrome reserves a few combos (`Ctrl+1`–`3`, `Ctrl+N`); install the app to use all of them.

## Develop

```bash
npm install
npm run dev
```

`npm run dev` listens on your local network, so you can open the printed `Network:` URL on your phone (same Wi-Fi) to test touch.

Source layout: `src/model.ts` (types), `geometry.ts` (shape math, Bezier), `store.ts` (document, selection, undo), `actions.ts` (editing commands), `canvas.ts` (view and tools), `ui.ts` (panels, menus), `shortcuts.ts` (keymap), `export.ts`, `svg.ts`, `icons.ts`.

## Build

```bash
npm run build
```

Output goes to `dist/`. Every push to `main` deploys automatically to GitHub Pages via `.github/workflows/deploy.yml`.

## Roadmap ideas

- Groups (`Ctrl+G`), boolean shape operations (Pathfinder), outline stroke
- Multiple icons / icon sets, export as sprite or icon font
