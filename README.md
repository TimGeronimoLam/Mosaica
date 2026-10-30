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

Mosaica is deployed to **Cloudflare Workers** as a static-assets Worker, configured in `wrangler.jsonc`.

Every push to `main` runs `.github/workflows/deploy.yml`: it installs dependencies, runs the tests, builds the site and deploys `dist/` with Wrangler. Pull requests run the tests and build only. The workflow needs two repository secrets (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → use the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Overview (right-hand sidebar) |

After the first deploy the site is served at `https://mosaica.<your-account-subdomain>.workers.dev`. To use your own domain, add a `routes` entry with `custom_domain: true` to `wrangler.jsonc` (the zone must be on Cloudflare).

Deploying from your machine works too:

```bash
npx wrangler login     # once
npm run deploy         # build + wrangler deploy
npm run preview:cf     # serve the build locally through the Workers runtime
```

The site is fully static, so the same `dist/` folder can also be dropped onto any other static host.

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
