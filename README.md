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
- Live preview of the puzzle and its solution while you adjust settings.
- Save mosaics in the browser (IndexedDB) and manage them in a gallery: open, duplicate, delete, export and import as JSON.
- Print a single puzzle (A4 or Letter, with an optional solution page) or build a book: cover, how-to-play page, contents, one puzzle per page and solutions at the back.
- Works on phones, tablets and desktops: on narrow screens the editor switches between an Edit and a Preview pane, and print pages shrink to fit the screen (they always print at full size).

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
src/lib/image.ts        image loading, cropping and sampling
src/lib/quantize.ts     k-means palette + Floyd–Steinberg dithering
src/lib/pixelize.ts     image → PixelGrid for binary, palette and mystery modes
src/lib/modes/*.ts      one generator per puzzle type, plus the registry in index.ts
src/lib/db.ts           IndexedDB storage
src/components/         editor, gallery, print and book views, SVG renderers
src/test/               vitest unit tests
```
