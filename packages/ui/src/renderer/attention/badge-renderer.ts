import { readableTextOn, type AttentionKind } from '@throng/core';

/**
 * Draws the taskbar badge (057 FR-039; research R13).
 *
 * Main has no canvas, and the badge's colour must come from the theme (FR-016), so a renderer draws the
 * PNG and answers `throng:attention:badgeImage` with it. The canvas and the colour lookup are passed in,
 * so the drawing is provable where there is neither (the unit layer); {@link domBadgeDeps} wires the
 * real ones.
 */

/** The slice of a canvas this draws on, so a fake can stand in. */
export interface BadgeCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    fillStyle: string;
    font: string;
    textAlign: string;
    textBaseline: string;
    clearRect(x: number, y: number, w: number, h: number): void;
    beginPath(): void;
    arc(x: number, y: number, r: number, from: number, to: number): void;
    fill(): void;
    fillText(text: string, x: number, y: number): void;
  } | null;
  toDataURL(type?: string): string;
}

export interface BadgeDeps {
  createCanvas(): BadgeCanvas;
  /** The theme's mark colour (`attentionMark`), the same for both kinds since 057 round 13 (FR-135). */
  colour(kind: AttentionKind): string;
  /** The theme's text-on-accent colour, used when the mark colour is not a hex `readableTextOn` can judge. */
  fallbackText(): string;
}

/** Windows draws an overlay icon at 16 x 16. */
const SIZE = 16;

/** The count as the badge shows it: a single digit up to 9, then "9+" (FR-039). */
export function badgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/**
 * The badge as a PNG data URL: a disc in the kind's theme colour with the count on it, in whichever of
 * black or white reads on that colour. Throws when the environment cannot draw, so main hears a failure
 * rather than setting an empty image.
 */
export function renderBadge(req: { count: number; kind: AttentionKind }, deps: BadgeDeps): string {
  const canvas = deps.createCanvas();
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas 2d context unavailable: cannot draw the taskbar badge');
  const fill = deps.colour(req.kind);
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.fill();
  const label = badgeLabel(req.count);
  ctx.fillStyle = readableTextOn(fill) ?? deps.fallbackText();
  ctx.font = `bold ${label.length > 1 ? 9 : 11}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, SIZE / 2, SIZE / 2 + 1);
  return canvas.toDataURL('image/png');
}

/** The real canvas, and the theme's colours as the theme provider set them on the document. */
export function domBadgeDeps(): BadgeDeps {
  const read = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return {
    createCanvas: () => document.createElement('canvas') as unknown as BadgeCanvas,
    // FR-135 (round 13): one mark colour for both kinds; `attentionFailedMark` is retired.
    colour: () => read('--throng-colour-attentionMark'),
    fallbackText: () => read('--throng-colour-accentText'),
  };
}
