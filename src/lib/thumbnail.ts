import type { PixelGrid } from '../types';
import { MYSTERY_POLYGONS } from './pixelize';

/** Render the pixel art to a small PNG data URL for the gallery. */
export function renderThumbnail(grid: PixelGrid, maxSize = 320): string {
  const scale = Math.max(1, Math.floor(maxSize / Math.max(grid.width, grid.height)));
  const canvas = document.createElement('canvas');
  canvas.width = grid.width * scale;
  canvas.height = grid.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const v = grid.cells[y * grid.width + x];
      if (grid.kind === 'mystery') {
        const poly = MYSTERY_POLYGONS[v];
        if (!poly) continue;
        ctx.fillStyle = '#111111';
        ctx.beginPath();
        poly.split(' ').forEach((pair, i) => {
          const [px, py] = pair.split(',').map(Number);
          if (i === 0) ctx.moveTo((x + px) * scale, (y + py) * scale);
          else ctx.lineTo((x + px) * scale, (y + py) * scale);
        });
        ctx.closePath();
        ctx.fill();
        continue;
      }
      if (grid.blank && v === 0) continue;
      ctx.fillStyle = grid.palette[v] ?? '#000000';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL('image/png');
}
