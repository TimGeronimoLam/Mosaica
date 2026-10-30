export type RGB = [number, number, number];

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance 0..1 of a 0..1 RGB triple. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return luminance(r / 255, g / 255, b / 255);
}

/** Black or white, whichever reads better on the given colour. */
export function contrastText(hex: string): string {
  return hexLuminance(hex) > 0.55 ? '#111111' : '#ffffff';
}

/** A slightly darker version of a colour, used for outlines on light swatches. */
export function darken(hex: string, amount = 0.25): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
