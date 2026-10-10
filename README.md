# Iconic

**Live app:** https://raysantos.github.io/iconic/

A lightweight vector icon editor that runs on PC and phone. It's a Progressive Web App (PWA): open it in a browser, then "Install" (desktop Chrome/Edge) or "Add to Home Screen" (iOS Safari / Android Chrome) to use it like a native app, including offline.

## Features (v0.1)

- 16, 24, 32 or 48 px artboard with pixel grid and half-pixel snapping (changing size scales the artwork)
- Tools: select/move, rectangle, ellipse, line, freehand pen
- Fill, stroke color and stroke width (applies to the selected shape too)
- Resize handles (Shift keeps proportions) and rotation with 15° snapping
- Layers panel: select, rename, reorder, hide/show (hidden layers are not exported)
- Undo/redo, delete, autosave to the device
- Export to SVG, or PNG at any mix of sizes from 16 to 1024 px (several sizes download as one .zip)
- Mouse, touch and stylus input (Pointer Events)

Shortcuts: `V` select, `R` rect, `E` ellipse, `L` line, `P` pen, `Ctrl+Z` / `Ctrl+Y`, `Ctrl+]` / `Ctrl+[` (forward/backward), `Del`.

## Develop

```bash
npm install
npm run dev
```

`npm run dev` listens on your local network, so you can open the printed `Network:` URL on your phone (same Wi-Fi) to test touch.

## Build

```bash
npm run build
```

Output goes to `dist/`. Every push to `main` deploys automatically to GitHub Pages via `.github/workflows/deploy.yml`.

## Roadmap ideas

- Bezier pen tool and node editing
- Multiple icons / icon sets, export as sprite or icon font
