# Iconic — notes for Claude

Iconic is Ray Santos's vector editor for **Google Material icons**. It is an installable PWA that runs on PC and phone.

**What it is, in one line:** an icon editing tool with a familiar look and feel and the precision of font-editing tools. The familiar part is the **Figma** interface with **Adobe Illustrator** shortcuts. The type-design tools are inspired by FontLab: masters and interpolation, Tunni lines, Power Nudge, Smart Corners, Audit, an overview grid and icon-font export.

Ray is a designer: explain things in plain language, not jargon.

- Repo: https://github.com/raysantos/iconic (public, branch `main`)
- Live: https://raysantos.github.io/iconic/. Every push to `main` deploys automatically via `.github/workflows/deploy.yml`.
- License: GPL-3.0-or-later. Credit third-party code in README → "Third-party software", and keep its license compatible.

## Working rules

- **Keep GitHub in sync.** After each finished, verified change: run `npm run build` (it must pass), commit, and push to `main` without asking. Never push a broken build. Git author: `Ray Santos`.
- **"Tell first"**: when Ray asks to hear about something before an update, explain the options and wait. Don't change code yet.
- For big features, propose a short plan before building.
- Test in the built-in browser before saying something works (see Develop).
- Update `README.md` (features and shortcut table) and the in-app help (`Ctrl+/`, in `ui.ts`) when features or shortcuts change. Bump `version` in `package.json` for notable features.

## Product direction

- **Material first:**
  - snake_case icon names, `name_24dp` file names, 24dp artboards
  - keylines; Outlined / Rounded / Sharp styles; optical sizes 20/24/40/48
  - Material mode can be switched off for general icons; its options then disappear
- **Illustrator model:**
  - artboards, not Figma frames; shapes belong to an artboard by their center point
  - Illustrator shortcut meanings (matched by physical key code in `shortcuts.ts`)
- **Figma look:**
  - Layers/Assets panel on the left, Design panel on the right
  - accent `#0D99FF`, component purple `#9747FF`
  - Roboto Flex interface font (bundled, works offline)
- **Non-destructive editing:**
  - boolean groups keep their children editable
  - components and instances (including nested badges, bare and circle) stay linked
  - knockout gaps are live
- **Google-format export:** one merged filled path on the 960 grid (`viewBox="0 -960 960 960"`), with a pixel-diff check and warnings. What you see while editing must match what exports.
- **Type-design tools (from FontLab):** weight masters and interpolation, Tunni lines, Power Nudge, Smart Corners, Audit, Overview, icon-font export.
- **Design details Ray cares about:**
  - consistent icon stroke weights (the style icons all use stroke-width 3)
  - no cramped or overflowing panel rows
  - phone-friendly layout (bottom sheets under 768px)
  - keep the view centered when the window is resized

## Stack

- **Build:** Vite 5 + TypeScript (strict), vanilla DOM, SVG canvas. No framework.
- **Geometry:** `pathkit-wasm` (Skia PathOps) for booleans, outline stroke and simplify.
- **Font export:** `opentype.js`, lazy-loaded.
- **Persistence:** state lives in `store.ts`; edits go through `edit()` in `actions.ts` (undo via snapshots). Autosave to localStorage under `iconic:doc` and `iconic:prefs`. When the document format changes, migrate old docs in `loadDoc`.
- **Service worker:** `public/sw.js`. Bump `CACHE` when caching behaviour changes.

Source map:
- `src/model.ts`: types
- `src/geometry.ts`: shape math, Bezier, Smart Corners
- `src/pathops.ts`: Skia booleans and flattening
- `src/svg.ts`: rendering
- `src/canvas.ts`: view, tools, gestures
- `src/ui.ts`: panels
- `src/shortcuts.ts`: keymap
- `src/export.ts`: SVG, Android XML and PNG export
- `src/fontexport.ts`: icon-font export
- `src/components.ts`: badges and instances
- `src/masters.ts`: weight interpolation
- `src/audit.ts`: audit checks
- `src/curvetools.ts`: Tunni lines and Power Nudge
- `src/fit.ts`: curve fitting
- `src/guides.ts`: smart guides
- `src/overview.ts`: Overview grid
- `src/colorpicker.ts`: colour picker

## Develop

```bash
npm install
npx vite --port 5174 --strictPort
```

- Open http://localhost:5174 in the built-in browser. In dev, `window.iconic.state` exposes the store for checks.
- Stop the server when you're done.
- `npm run build` type-checks the project and builds `dist/` with base `/iconic/`.
- The project folder is synced by OneDrive. If a file is locked, wait and retry.

## Ideas not yet requested (ask before starting)

- SVG import and round-trip tests with Figma and Illustrator
- iOS export (asset catalog, @2x/@3x)
- fill and optical-size axes
- pixel-size labels on the PNG chips
- groups (`Ctrl+G`)
