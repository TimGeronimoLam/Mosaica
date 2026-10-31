# Mosaica

Turn any image into a printable picture puzzle. Mosaica runs entirely in the browser: drop in a photo, drawing or logo, tune how it is turned into pixel art, pick a puzzle type, save it to your gallery and print it on its own or as a whole book.

## Puzzle types

| Mode | What the solver does |
| --- | --- |
| **Nonogram** | Classic one-colour picross: fill cells from row and column run clues. |
| **Colour nonogram** | Same idea, but every clue carries its colour. |
| **Colour by code** | Every cell has a number (or a little sum for maths practice); colour it from the legend. |
| **Mystery portrait** | Codes 0–9 stand for half squares and triangles; drawing them reveals a greyscale portrait. |
| **Fill-a-Pix** | Each number says how many cells of its 3×3 block are filled; solve by logic. Generated puzzles are checked to be solvable without guessing. |
| **Logipix** | Join each pair of equal numbers with a path of exactly that many cells; shade the paths. Black & white or colour. |
| **Labymage** | A maze whose only route from entrance to exit visits every cell of the picture, so shading the route draws it. |
| **Connect the dots** | Numbered dots along the outline, with a circled start and a star at the end of each section. |

## Features

- Image to pixel art pipeline with crop/zoom, brightness, contrast, saturation, threshold, colour count, dithering, speckle removal and invert.
- Photo tools for real-world pictures: rotate, mirror and straighten; drag the crop frame; remove the background; clean up lighting and texture; touch up single cells (see below).
- Undo and redo for every change (Ctrl+Z, Ctrl+Shift+Z).
- Live preview of the photo, the pixel art, the puzzle and its solution while you adjust settings.
- Save mosaics in the browser (IndexedDB) and manage them in a gallery: open, duplicate, delete, export and import as JSON.
- Print a single puzzle (A4 or Letter, with an optional solution page) or build a book: cover, how-to-play page, contents, one puzzle per page and solutions at the back.
- Works on phones, tablets and desktops: on narrow screens the editor switches between an Edit and a Preview pane, and print pages shrink to fit the screen (they always print at full size).

## Getting a good result from a photo

Photos are harder than drawings: backgrounds are busy, light falls unevenly and fine details vanish when a whole patch of picture becomes one cell. The editor works through this in four places:

1. **Frame it** (sidebar step 1, and the *Photo* view). Rotate in quarter turns, mirror, or straighten up to ±45° (the picture zooms just enough to hide the corners). In the Photo view, drag the frame to move it, and pinch or Ctrl+scroll to zoom. Tighter crops give each feature more cells: for a portrait, frame the face, not the whole person.
2. **Remove the background** (Photo view). *Remove background* floods inwards from the top and sides of the picture through areas of similar colour, so it works best on plain backdrops. It leaves the bottom edge alone, because that is usually where the subject is. The *Wand* removes one connected area of a similar colour, and the *Brush* paints by hand. Switch either to *Keep* to bring parts back, and use *Invert* to keep only what you painted. Removed areas print as blank paper and are left out of the colour palette, so all the colours go to the subject.
3. **Clean it up** (sidebar step 5). *Auto-fix photo* applies a good starting mix:
   - *Auto levels* stretches the crop to full black and white.
   - *Even out lighting* takes away shadows across a face.
   - *Simplify textures* is an edge-preserving filter that flattens fur, skin and grass into clean areas.
   - *Keep dark details* stops eyes and thin lines from being averaged away.
   - *Outline edges* darkens strong edges, which helps nonograms and connect-the-dots.
4. **Touch up the cells** (*Pixels* view). Paint with the pencil, flood-fill an area, pick a colour from the grid, or brush cells back to the automatic result. *Photo underneath* shows where things really are. Touch-ups are stored by colour, not by palette number, so they survive changes to other settings, and they are rescaled if you change the grid size.

The background mask is stored in the photo's own coordinates, so it stays in place when you rotate or straighten afterwards. The mask and the touch-ups are saved with the mosaic and included in exports.

## Development

```bash
npm install
npm run dev        # start the dev server
npm test           # unit tests for the puzzle generators
npm run build      # type-check and build to dist/
npm run preview    # serve the production build
```

The app is a static site (Vite + React + TypeScript) with no backend. Everything you make stays in your browser unless you export it.

## Deployment

Mosaica is deployed to **Cloudflare Workers** as a static-assets Worker. `wrangler.jsonc` tells Wrangler to upload the Vite build in `dist/` and serve it from the edge, with single-page fallback for unknown paths.

The repository is connected to Cloudflare (Workers & Pages → Create → Import a repository), so Cloudflare builds and deploys every push to `main` using these settings:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Pull requests get a test-and-build check from `.github/workflows/ci.yml`.

Deploying from your machine works too:

```bash
npx wrangler login     # once
npm run deploy         # build + wrangler deploy
npm run preview:cf     # serve the build locally through the Workers runtime
```

To serve from your own domain, add a `routes` entry with `custom_domain: true` to `wrangler.jsonc` (the zone must be on Cloudflare).

## Project layout

```
src/lib/image.ts        image loading, cropping, rotated/straightened rendering
src/lib/transform.ts    rotate / mirror / straighten as affine maps
src/lib/preprocess.ts   crop → cell colours, with auto levels, even lighting, simplify, outlines
src/lib/mask.ts         background mask: brush, magic wand, auto background, storage
src/lib/edits.ts        cell touch-ups on top of the automatic pixel art
src/lib/history.ts      undo / redo stack
src/lib/quantize.ts     k-means palette + Floyd–Steinberg dithering
src/lib/pixelize.ts     image → PixelGrid for binary, palette and mystery modes
src/lib/modes/*.ts      one generator per puzzle type, plus the registry in index.ts
src/lib/db.ts           IndexedDB storage
src/components/         editor, gallery, print and book views, SVG renderers
src/test/               vitest unit tests (puzzle generators, photo tools)
```
