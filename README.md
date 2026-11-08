# Mosaica

Turn any image into a printable picture puzzle. Mosaica runs entirely in the browser: drop in a photo, drawing or logo, tune how it is turned into pixel art, pick a puzzle type, save it to your gallery and print it on its own or as a whole book.

## Puzzle types

| Mode | What the solver does |
| --- | --- |
| **Nonogram** | Classic one-colour picross: fill cells from row and column run clues. The editor checks whether the clues have exactly one answer and outlines any cells that could shift. |
| **Colour nonogram** | Same idea, but every clue carries its colour. |
| **Colour by code** | Every cell has a number (or a little sum for maths practice); colour it from the legend. |
| **Mystery portrait** | Codes 0–9 stand for half squares and triangles; drawing them reveals a greyscale portrait. |
| **Fill-a-Pix** | Each number says how many cells of its 3×3 block are filled; solve by logic. Generated puzzles are checked to be solvable without guessing. |
| **Logipix** | Join each pair of equal numbers with a path of exactly that many cells; shade the paths. Black & white or colour. |
| **Labymage** | A maze whose only route from entrance to exit visits every cell of the picture, so shading the route draws it. |
| **Connect the dots** | Numbered dots along the outline, with a circled start and a star at the end of each section. |

## Features

- Image to pixel art pipeline with crop/zoom, brightness, contrast, saturation, threshold, colour count, dithering, speckle removal and invert.
- Photo tools for real-world pictures: rotate, mirror and straighten; crop to any shape; remove the background; clean up lighting and texture; touch up single cells (see below).
- A careful photo-to-cells converter: renders the crop from the full-resolution photo, keeps edges crisp, chooses palettes by how colours look, and cleans up specks (see below).
- Undo and redo for every change (Ctrl+Z, Ctrl+Shift+Z).
- Live preview of the photo, the pixel art, the puzzle and its solution while you adjust settings.
- Save mosaics in the browser (IndexedDB) and manage them in a gallery: open, duplicate, delete, export and import as JSON.
- Print a single puzzle (A4 or Letter, with an optional solution page) or build a book: cover, how-to-play page, contents, one puzzle per page and solutions at the back.
- Works on phones, tablets and desktops: on narrow screens the editor switches between an Edit and a Preview pane, and print pages shrink to fit the screen (they always print at full size).

## Getting a good result from a photo

Photos are harder than drawings: backgrounds are busy, light falls unevenly and fine details vanish when a whole patch of picture becomes one cell. The editor works through this in four places:

1. **Frame it** (sidebar step 1, and the *Photo* view). Rotate in quarter turns, mirror, or straighten up to ±45° (the picture zooms just enough to hide the corners). With the *Crop* tool you can:
   - drag the corners or edges to crop to any shape
   - drag inside the crop to move it
   - drag outside it to draw a new one
   - pinch or Ctrl+scroll to resize it around its centre

   Pick a fixed shape (square, 4:3, 16:9, …) from *Shape*. The grid takes the crop's shape. To fix both grid sides by hand instead, turn off *Height follows the crop* in step 3, and the crop keeps the grid's shape. Faint lines inside the crop show the cells. Tighter crops give each feature more cells: for a portrait, crop to the face, not the whole person.
2. **Remove the background** (Photo view). *Find the subject* runs a neural network in your browser that separates the subject from everything else; it works on busy backgrounds too. Pick *People* (MODNet, a 25 MB portrait model, about 3 s) or *Any subject* (BiRefNet lite, 94 MB, about 15 s, for pets and objects; the portrait model is no good for those). The model is downloaded once and cached; the photo never leaves your device. *Remove plain background* is the older colour flood fill: it floods inwards from the top and sides through areas of similar colour, so it suits plain backdrops, and it leaves the bottom edge alone because that is usually where the subject is. The *Wand* removes one connected area of a similar colour, and the *Brush* paints by hand. Switch either to *Keep* to bring parts back, and use *Invert* to keep only what you painted. Removed areas print as blank paper and are left out of the colour palette, so all the colours go to the subject.
3. **Mark the detail** (Photo view, *Detail* layer). A portrait is recognised by a handful of cells: the eyes, the brows, the mouth. *Find face details* finds faces (MediaPipe Face Landmarker, in your browser) and marks their eyes, brows, nose and mouth; the *Brush* and *Wand* mark anything else (a logo, a cat's eyes) on the same layer. Marked areas keep the contrast the photo had there, are never merged into their neighbours or treated as specks, and count three times when the palette is chosen, so an eye gets a colour of its own.
4. **Clean it up** (sidebar step 5). *Auto-fix photo* applies a good starting mix:
   - *Auto levels* stretches the crop to full black and white.
   - *Even out lighting* takes away shadows across a face.
   - *Simplify textures* is an edge-preserving filter that flattens fur, skin and grass into clean areas.
   - *Keep dark details* stops eyes and thin lines from being averaged away.
   - *Restore contrast* is perceptual downscaling (see below): cells get back the contrast that averaging took away.
   - *Outline edges* darkens strong edges, which helps nonograms and connect-the-dots.
5. **Touch up the cells** (*Pixels* view). Paint with the pencil, flood-fill an area, pick a colour from the grid, or brush cells back to the automatic result. *Photo underneath* shows where things really are. Touch-ups are stored by colour, not by palette number, so they survive changes to other settings, and they are rescaled if you change the grid size.

### How a photo becomes cells

Each step below fixes a specific weakness of the simple approach of averaging each cell's pixels and running k-means in RGB. They were chosen by comparing the output on real photos (a portrait, a cat, a coffee cup) in colour-by-code and nonogram puzzles:

- **Full-resolution crop.** The crop is rendered from the original photo (kept at up to 2400px) at up to 6×6 samples per cell, not cut out of a small working copy. Tight crops keep their detail.
- **Main colour per cell** (*Each cell takes*, step 3). A cell on an edge takes the colour of the larger side, instead of a blend that exists on neither side. Blends add a muddy halo along every edge and waste palette colours. Cells of one colour stay averaged, so smooth areas stay smooth.
- **Restore contrast** (step 5) is the closed form of perceptual downscaling (Öztireli & Gross, SIGGRAPH 2015). Averaging a cell loses the contrast of anything thinner than a cell: an eye becomes a slightly darker patch of skin. For every 3×3 neighbourhood of cells the converter compares how much the photo's pixels vary with how much the cell colours vary, and scales the cells' deviations from their local mean up until the two match (capped at 4×, so noise cannot blow up). Flat areas are untouched. Cells marked as detail always get the full effect.
- **Detail mask.** Marked cells also lean harder towards their darkest quarter, are locked against merging and speckle removal, and are entered three times into the palette's k-means.
- **Palettes chosen by how colours look.** k-means runs in OKLab, a perceptual colour space, with hue and saturation counting double, and keeps the best of six starts. This keeps skin apart from a grey wall and an orange crema apart from beige foam, and *Shuffle* gives variations rather than worse palettes.
- **Merge small areas** (step 4). Islands smaller than *N* cells (3 by default) join the neighbouring area they share most border with, preferring similar colours. This is the usual paint-by-numbers clean-up: one-cell specks are photo noise and tedious to colour. It is skipped while shading is on, because dither dots are one-cell areas on purpose.
- **Shading** (step 4): *Pattern* (ordered 4×4 dithering) gives regular textures that are easy to colour, and *Speckle* is classic error diffusion. Both have a strength slider; 50% is usually plenty.
- **Auto threshold** (step 4, one-colour modes) picks the cut between dark and light with Otsu's method. It is a suggestion: it suits some photos and not others.
- Cut-out edges take their colour only from the kept part of the cell, so no background colour bleeds around the subject.

Mosaics saved before this converter keep the original one, so they regenerate exactly as saved. The Grid step offers to switch them over.

The background and detail masks are stored in the photo's own coordinates, so they stay in place when you rotate or straighten afterwards. Both masks and the touch-ups are saved with the mosaic and included in exports.

### Neural networks in the browser

Nothing leaves your device. *Find the subject* uses [Transformers.js](https://huggingface.co/docs/transformers.js) (ONNX Runtime's WebAssembly backend; WebGPU is avoided on purpose because ONNX Runtime 1.31 produces a garbage matte for MODNet and fails BiRefNet with a shader limit) with [Xenova/modnet](https://huggingface.co/Xenova/modnet) (Apache-2.0) or [studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512) (MIT; the 1024 px export runs out of WebAssembly memory); *Find face details* uses [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker). Models and the runtime's WebAssembly are fetched from the Hugging Face hub, jsDelivr and Google's model store on first use and cached by the browser, so these two buttons need a network connection the first time; everything else works offline. The models are code-split into their own chunks and only loaded when a button is pressed.

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
src/lib/image.ts        image loading, rotated/straightened rendering, full-resolution crop renderer
src/lib/crop.ts         free crop: shapes, handles, keeping grid and crop the same shape
src/lib/transform.ts    rotate / mirror / straighten as affine maps
src/lib/sampler.ts      picks the cell sampler for a mosaic's converter
src/lib/preprocess.ts   crop → cell colours (average or main colour), auto levels, even lighting, simplify, outlines
src/lib/regions.ts      merge small areas, Otsu threshold
src/lib/mask.ts         background mask: brush, magic wand, auto background, storage
src/lib/edits.ts        cell touch-ups on top of the automatic pixel art
src/lib/history.ts      undo / redo stack
src/lib/quantize.ts     k-means palette, Floyd–Steinberg and ordered dithering
src/lib/color.ts        hex/RGB helpers and OKLab
src/lib/pixelize.ts     image → PixelGrid for binary, palette and mystery modes
src/lib/modes/*.ts      one generator per puzzle type, plus the registry in index.ts
src/lib/db.ts           IndexedDB storage
src/components/         editor, gallery, print and book views, SVG renderers
src/test/               vitest unit tests (puzzle generators, photo tools, crop and converter)
```
