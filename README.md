# Iconic

**Live app:** https://raysantos.github.io/iconic/

**An icon editing tool with a familiar look and feel and the precision of font-editing tools.**

Iconic is made for designing **Google Material icons**, on PC and phone. It has a Figma-style interface, Adobe Illustrator keyboard shortcuts and type-design tools inspired by FontLab. It's a Progressive Web App (PWA): open it in a browser, then "Install" (desktop Chrome/Edge) or "Add to Home Screen" (iOS Safari / Android Chrome) to use it like a native app, including offline.

## Material icons

- **Material mode** switch (next to the Material section title, also in the main menu): on by default; turn it off for general icons — Material options and keylines disappear, sizes become 16/24/32/48/64, and files are named without the `_24dp` suffix
- **Keyline template** (`Ctrl+;`): 2dp padding, 20dp live area, circle / square / portrait / landscape keylines and center lines, scaled to each artboard
- **Styles:** Outlined, Rounded, Sharp — sets line ends, corners and rectangle corner radius across the icon
- **Defaults:** 24dp artboards, solid black fill, whole-pixel snapping, 2dp corner radius on rectangles
- **Optical sizes:** 20 / 24 / 40 / 48 dp presets (scale the artwork)
- **snake_case names** (`arrow_back`) and Material Symbols file names (`arrow_back_24dp.svg`)
- **Google-format export (default):** each icon becomes **one filled path** — strokes outlined, shapes merged, clipped to the artboard — on Material Symbols' 960-unit grid (`viewBox="0 -960 960 960"`), exactly like Google's downloads. Your document stays editable.
- **Export checks:** before a single-path export, Iconic renders the working icon and the merged path and compares them pixel by pixel, and warns about multiple colors, white shapes faking holes (one-click **Convert to Subtract**) and artwork outside the artboard
- **Merged preview** (`Ctrl+Y`): see every icon exactly as it will export, while still editing the shapes
- **Formats:** SVG (optional `currentColor`), **Android Vector Drawable** XML (optional `colorControlNormal` tint), PNG at Android densities (mdpi–xxxhdpi, zipped into `drawable-*` folders), and an **icon font**; one artboard or all of them

## Type-design tools (from FontLab)

- **Variations (masters):** like Material Symbols' variable axes. Add a bold master (weight), a filled master (fill: holes shrink to nothing so it stays compatible) and an optical-size master (20/24/40/48dp), check that each matches the base, preview any mix with one slider per axis, and generate every combination of the picked weights, fills and sizes. Names follow Google's downloads (`home_FILL1_wght300_GRAD0_opsz20`, exported as `home_20dp_FILL1_…`), and generated points snap to the half-pixel grid so they pass Audit as-is
- **Tunni lines:** with Direct Selection, a dashed line joins each curve's handle ends — drag it to make the curve fuller or flatter, double-click to balance the handles
- **Power Nudge:** moving or nudging points keeps neighbouring curves in proportion (toggle in Grid)
- **Smart Corners:** live rounded corners on any sharp point of any path (R field), kept as a single editable point
- **Audit:** flags almost-straight lines, missing extreme points, tiny segments, off-grid points and redundant points, with Fix / Fix all
- **Overview** (`Ctrl+Shift+O`): every icon in a grid with name, size and status (component, linked, master, weight, audit issues)
- **Icon font export:** OTF + WOFF with a ligature per icon name (type `home` → icon), Private Use Area codepoints, CSS, a codepoints file and a demo page

## Components, badges & variants (modifier icons)

- **Components** (`Ctrl+Alt+K`): turn any artboard — or selected shapes, like an arrowhead — into a reusable component and place linked **instances** of it in other icons (Assets tab). Edit the component once and every instance updates; double-click an instance to jump to its component; **Detach** (`Ctrl+Alt+B`) turns it into editable shapes
- **Badges:** plus, minus, check, close, alert, up, down — **bare** or in a **circle** — dropped into the icon's corner slot, sized for the 24dp grid and colored to match the icon
- **Knockout gap:** a badge cuts clearance (default 1.5dp, adjustable) out of everything beneath it, following the badge's exact shape — live on the canvas and exact in the single-path export
- **Make variants:** pick base icons and badges; Iconic creates every combination as linked artboards named Material-style (`file_add`, `file_remove_circle`, …)

## Boolean groups (non-destructive)

- **Union, Subtract, Intersect, Exclude** (`Ctrl+Alt+U / S / I / X`) create a live boolean group: the shapes inside stay fully editable and the result updates as you change them
- Switch the operation any time; **Release** (`Ctrl+Shift+G`) gives the shapes back
- **Double-click** the result to select a shape inside; groups appear as a tree in Layers
- Powered by **Skia PathOps**, Google's path engine from Chrome and Android, running as WebAssembly

## Artboards (an icon set on one canvas)

- **Artboard tool** (`Shift+O`): drag to create; drag an artboard (or its name label) to move it with its artwork; `Alt`-drag to duplicate; corner handles resize
- **Artboards panel:** add, duplicate (with artwork), rename, delete; click to zoom
- **Arrange all artboards** into a grid with chosen columns and gap; new artboards fill the next grid cell
- **Grid:** pixel grid plus an optional stronger line every 2/4/8 px; snap to ½ px, 1 px or the grid

## Drawing & editing

- **Smart guides** (`Ctrl+U`): snap to other objects' edges and centers, artboard edges and centers, and anchor points, with magenta guides and labels — while moving, drawing, resizing and editing points
- **Tools:** Selection, Direct Selection, Artboard, Pen, Add/Delete/Convert Anchor Point, Rectangle, Ellipse, Line, Pencil, Hand, Zoom
- **Pen:** click for corners, drag for curves (`Alt` breaks handles, `Shift` 45°), click the first point to close; click an open path's end to **continue** it, or another path's end to **join** it
- **Direct Selection:** click, `Shift`-click or marquee to select **multiple anchor points**; drag, arrow-key nudge or `Delete` them; drag handles (`Alt` breaks them, `Shift` 45°); any shape becomes an editable path on first edit
- **Delete Anchor Point** keeps the curve's shape (refits the neighbouring segments)
- **Join** (`Ctrl+J`): close an open path, or join two open paths at their nearest ends
- **Pencil** strokes become smooth, editable Bezier curves
- **Design panel:** X/Y/W/H/rotation/corner radius (drag the label to scrub, arrows step, math like `12+4`), alignment, fill, stroke weight, ends and corners
- **Color picker:** saturation/brightness area, hue slider, Hex / RGB / HSL, eyedropper (Chrome/Edge), document colors and a Material palette; keyboard and touch friendly, one undo step per pick
- **Interface font:** Roboto Flex (variable, optical sizing), bundled so it works offline
- **Layers:** multi-select, drag to reorder, rename, lock, hide
- Undo/redo, autosave, mouse/touch (pinch zoom)/stylus

## Keyboard shortcuts (Illustrator layout)

Press `Ctrl+/` in the app for the full list. Highlights:

| Tools | | Edit | | Object & view | |
|---|---|---|---|---|---|
| Selection / Direct Selection | `V` / `A` | Paste / in front / in back | `Ctrl+V` / `Ctrl+F` / `Ctrl+B` | Arrange | `Ctrl+[` `Ctrl+]` (+`Shift` for back/front) |
| Artboard | `Shift+O` | Paste in place | `Ctrl+Shift+V` | Join paths | `Ctrl+J` |
| Pen / Add / Delete / Convert | `P` `+` `-` `Shift+C` | Duplicate | `Alt`+drag | Lock / Hide (+`Alt` = all) | `Ctrl+2` / `Ctrl+3` |
| Rectangle / Ellipse / Line | `M` `L` `\` | Transform again | `Ctrl+D` | Fit artboard / all / 100% | `Ctrl+0` / `Ctrl+Alt+0` / `Ctrl+1` |
| Pencil / Hand / Zoom | `N` `H` `Z` | Select all / Deselect | `Ctrl+A` / `Ctrl+Shift+A` | Smart guides / Keylines | `Ctrl+U` / `Ctrl+;` |
| Temporary hand | hold `Space` | Default colors / Swap / None | `D` / `Shift+X` / `/` | Grid / Snap / Panels | `Ctrl+'` / `Ctrl+Shift+'` / `Tab` |

On Mac, `Ctrl` is `⌘` and `Alt` is `⌥`. In a browser tab, Chrome reserves a few combos (`Ctrl+1`–`3`, `Ctrl+N`); install the app to use all of them.

## Develop

```bash
npm install
npm run dev
```

`npm run dev` listens on your local network, so you can open the printed `Network:` URL on your phone (same Wi-Fi) to test touch.

Source layout: `src/model.ts` (types), `geometry.ts` (shape math, Bezier), `fit.ts` (curve fitting), `guides.ts` (smart guides), `pathops.ts` (Skia booleans / outline stroke), `store.ts` (document, selection, undo), `actions.ts` (editing commands), `canvas.ts` (view and tools), `ui.ts` (panels, menus), `shortcuts.ts` (keymap), `export.ts` (SVG / Android / PNG), `svg.ts`, `icons.ts`.

## Build

```bash
npm run build
```

Output goes to `dist/`. Every push to `main` deploys automatically to GitHub Pages via `.github/workflows/deploy.yml`.

## Roadmap ideas

- SVG import (Figma / Illustrator files) and round-trip tests
- Destructive Outline Stroke / Flatten commands
- Groups (`Ctrl+G`)
- Icon font / sprite export

## License

Copyright (C) 2026 Ray Santos

Iconic is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; see [LICENSE](LICENSE) for details.

### Third-party software

- [pathkit-wasm](https://www.npmjs.com/package/pathkit-wasm) (Skia PathOps) — Copyright Google LLC, BSD 3-Clause License
- [opentype.js](https://github.com/opentypejs/opentype.js) — Copyright Frederik De Bleser, MIT License (loaded only for font export)
- [Roboto Flex](https://github.com/googlefonts/roboto-flex) via [@fontsource-variable/roboto-flex](https://www.npmjs.com/package/@fontsource-variable/roboto-flex) — Copyright The Roboto Flex Project Authors, SIL Open Font License 1.1
