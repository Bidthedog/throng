/**
 * 075 FR-020 – FR-023 — the seven callout colour roles as theme colours, and how legible they are.
 *
 * A callout's role colour paints its border, icon and title; its background is that colour tinted over the
 * preview's background (`editorBg`) at {@link CALLOUT_TINT} — the same `color-mix(in srgb, …)` the stylesheet
 * draws, computed here so the contrast guard measures exactly what is shown. The body text stays `editorFg`.
 *
 * The bundled themes carry values DERIVED here, per theme, the way `deriveFileIconColours` derives the file
 * icon colours: each role keeps its hue, and its lightness walks away from the theme's background until the
 * title clears body-text contrast on its own tint. Pure. No OS, no DOM.
 */
import { CALLOUT_ROLES, type CalloutRole } from '../preview/callouts.js';
import { contrastRatio, hexToRgb, relativeLuminance } from './colour-math.js';

/** The theme colour token each role paints with. */
export const CALLOUT_ROLE_TOKENS: Readonly<Record<CalloutRole, string>> = Object.freeze({
  neutral: 'calloutNeutral',
  info: 'calloutInfo',
  accent: 'calloutAccent',
  success: 'calloutSuccess',
  question: 'calloutQuestion',
  warning: 'calloutWarning',
  danger: 'calloutDanger',
});

/** How much of the role colour the background takes over `editorBg` (the stylesheet's `color-mix` percentage / 100). */
export const CALLOUT_TINT = 0.12;

/** The floor for a callout's title and body text on its tint (WCAG 2.1 AA body text, the guards' threshold). */
export const CALLOUT_TEXT_MIN_CONTRAST = 4.5;
/** The floor for its icon (WCAG 2.1 SC 1.4.11 non-text). */
export const CALLOUT_ICON_MIN_CONTRAST = 3;

/** Each role's hue, in degrees; `neutral` is drawn grey. */
const HUES: Readonly<Record<CalloutRole, number>> = Object.freeze({
  neutral: 0,
  info: 205,
  accent: 275,
  success: 135,
  question: 45,
  warning: 28,
  danger: 355,
});

const to2 = (c: number): string => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0');

/** `role` at {@link CALLOUT_TINT} over `editorBg`, as `color-mix(in srgb, role 12%, editorBg)` draws it. */
export function calloutTint(role: string, editorBg: string): string {
  const a = hexToRgb(editorBg);
  const b = hexToRgb(role);
  const mix = (x: number, y: number): number => x + (y - x) * CALLOUT_TINT;
  return `#${to2(mix(a.r, b.r))}${to2(mix(a.g, b.g))}${to2(mix(a.b, b.b))}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${to2(f(0) * 255)}${to2(f(8) * 255)}${to2(f(4) * 255)}`;
}

/** Whether `colour`, as a callout of that role, clears every floor over `editorBg` with `editorFg` as body text. */
function legible(colour: string, editorBg: string, editorFg: string): boolean {
  const tint = calloutTint(colour, editorBg);
  return contrastRatio(colour, tint) >= CALLOUT_TEXT_MIN_CONTRAST && contrastRatio(editorFg, tint) >= CALLOUT_TEXT_MIN_CONTRAST;
}

/** The seven role colours for a theme with this editor background and text. */
export function deriveCalloutColours(editorBg: string, editorFg: string): Record<string, string> {
  const dark = relativeLuminance(hexToRgb(editorBg)) < 0.18;
  const out: Record<string, string> = {};
  for (const role of CALLOUT_ROLES) {
    const saturation = role === 'neutral' ? 0 : dark ? 0.72 : 0.78;
    let lightness = dark ? 0.62 : 0.4;
    let colour = hslToHex(HUES[role], saturation, lightness);
    while (!legible(colour, editorBg, editorFg) && lightness > 0.04 && lightness < 0.96) {
      lightness += dark ? 0.02 : -0.02;
      colour = hslToHex(HUES[role], saturation, lightness);
    }
    out[CALLOUT_ROLE_TOKENS[role]] = colour;
  }
  return out;
}

export interface CalloutContrastResult {
  readonly role: CalloutRole;
  readonly label: string;
  readonly ratio: number;
  readonly min: number;
  readonly pass: boolean;
}

/** FR-023 — title, body text and icon against each role's tint, for one theme's colours. */
export function measureCalloutContrast(theme: { readonly colours: Readonly<Record<string, string>> }): CalloutContrastResult[] {
  const editorBg = theme.colours.editorBg ?? '#000000';
  const editorFg = theme.colours.editorFg ?? '#ffffff';
  return CALLOUT_ROLES.flatMap((role): CalloutContrastResult[] => {
    const colour = theme.colours[CALLOUT_ROLE_TOKENS[role]];
    if (colour === undefined) {
      return ['title', 'body text', 'icon'].map((part) => ({ role, label: `${role} callout ${part} (no colour)`, ratio: 0, min: 1, pass: false }));
    }
    const tint = calloutTint(colour, editorBg);
    const result = (label: string, fg: string, min: number): CalloutContrastResult => {
      const ratio = contrastRatio(fg, tint);
      return { role, label: `${role} callout ${label}`, ratio, min, pass: ratio >= min };
    };
    return [
      result('title', colour, CALLOUT_TEXT_MIN_CONTRAST),
      result('body text', editorFg, CALLOUT_TEXT_MIN_CONTRAST),
      result('icon', colour, CALLOUT_ICON_MIN_CONTRAST),
    ];
  });
}

/** The failing measurements of {@link measureCalloutContrast} (empty when every one passes). */
export function calloutContrastFailures(theme: { readonly colours: Readonly<Record<string, string>> }): CalloutContrastResult[] {
  return measureCalloutContrast(theme).filter((r) => !r.pass);
}
