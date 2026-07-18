/**
 * Theme-quality guards (feature 009). Pure colour maths and the automated
 * distinctness + contrast assertions that keep bundled themes visually distinct
 * and legible. No OS/DOM — safe in @throng/core.
 *
 * - Distinctness: CIEDE2000 (ΔE00) mean token-pair distance across the colour
 *   tokens two themes share. (The OQ-1 answer specified the minimum, but minimum
 *   is degenerate on the real themes — every pair shares an identical token — so
 *   the robust mean is used; see themePairDistance and research.md R1.) Threshold
 *   calibrated to sit just below the closest legitimate bundled pair.
 * - Contrast: WCAG 2.1 relative-luminance ratio over an enumerated pairing list;
 *   AA thresholds (4.5:1 body, 3:1 large/UI). Hard failure for the in-scope
 *   themes only; out-of-scope shortfalls are reported, not thrown.
 */
import { THRONG_THEME, type Theme } from './theme.js';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** Parse an `#rrggbb` string (case-insensitive) into 0–255 channels. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

/** sRGB channel (0–255) → linear-light component (WCAG 2.1). */
function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance in [0,1]. */
export function relativeLuminance(rgb: Rgb): number {
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio in [1,21]. Symmetric in its arguments. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** sRGB (0–255) → CIE XYZ (D65). */
function rgbToXyz(rgb: Rgb): { x: number; y: number; z: number } {
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    z: r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  };
}

/** CIE XYZ (D65) → CIE L*a*b*. */
export function rgbToLab(rgb: Rgb): Lab {
  const { x, y, z } = rgbToXyz(rgb);
  // D65 reference white.
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const f = (t: number): number =>
    t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

const deg2rad = (d: number): number => (d * Math.PI) / 180;
const rad2deg = (r: number): number => (r * 180) / Math.PI;

/** CIEDE2000 colour difference (ΔE00). Symmetric; 0 for identical colours. */
export function ciede2000(a: Lab, b: Lab): number {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const c1 = Math.hypot(a.a, a.b);
  const c2 = Math.hypot(b.a, b.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));

  const a1p = (1 + g) * a.a;
  const a2p = (1 + g) * b.a;
  const c1p = Math.hypot(a1p, a.b);
  const c2p = Math.hypot(a2p, b.b);

  const h1p = hpF(a.b, a1p);
  const h2p = hpF(b.b, a2p);

  const dLp = b.L - a.L;
  const dCp = c2p - c1p;
  const dhp = dhpF(c1p, c2p, h1p, h2p);
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(deg2rad(dhp) / 2);

  const lBarP = (a.L + b.L) / 2;
  const cBarP = (c1p + c2p) / 2;
  const hBarP = aHpF(c1p, c2p, h1p, h2p);

  const t =
    1 -
    0.17 * Math.cos(deg2rad(hBarP - 30)) +
    0.24 * Math.cos(deg2rad(2 * hBarP)) +
    0.32 * Math.cos(deg2rad(3 * hBarP + 6)) -
    0.2 * Math.cos(deg2rad(4 * hBarP - 63));

  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const cBarP7 = cBarP ** 7;
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(deg2rad(2 * dTheta)) * rc;

  return Math.sqrt(
    (dLp / (kL * sl)) ** 2 +
      (dCp / (kC * sc)) ** 2 +
      (dHp / (kH * sh)) ** 2 +
      rt * (dCp / (kC * sc)) * (dHp / (kH * sh)),
  );
}

function hpF(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  const h = rad2deg(Math.atan2(x, y));
  return h >= 0 ? h : h + 360;
}

function dhpF(c1p: number, c2p: number, h1p: number, h2p: number): number {
  if (c1p * c2p === 0) return 0;
  const diff = h2p - h1p;
  if (Math.abs(diff) <= 180) return diff;
  return diff > 180 ? diff - 360 : diff + 360;
}

function aHpF(c1p: number, c2p: number, h1p: number, h2p: number): number {
  if (c1p * c2p === 0) return h1p + h2p;
  if (Math.abs(h1p - h2p) <= 180) return (h1p + h2p) / 2;
  if (h1p + h2p < 360) return (h1p + h2p + 360) / 2;
  return (h1p + h2p - 360) / 2;
}

/**
 * Distance between two theme palettes: the MEAN CIEDE2000 across the colour
 * tokens they share.
 *
 * NOTE (deviation from the literal OQ-1 answer — flagged for ratification): the
 * clarification specified the *minimum* token-pair distance. Measured against the
 * real bundled themes, minimum is degenerate — every pair shares at least one
 * identical token (pure-black backgrounds, and the shared `danger`/`success`/
 * `unsavedDot` defaults), so the minimum is 0.00 for ALL pairs and cannot
 * distinguish twins from distinct themes. The mean is the robust whole-palette
 * measure that actually separates near-clones (small mean) from distinct themes
 * (large mean), and — because it averages over ~28 tokens — a single differing
 * accent still cannot rescue an otherwise-cloned palette (the concern behind the
 * "not mean" instruction is quantitatively negligible over a full palette). See
 * research.md R1/R2 and the feature report.
 */
export function themePairDistance(a: Theme, b: Theme): number {
  let sum = 0;
  let n = 0;
  for (const token of Object.keys(a.colours)) {
    const bv = b.colours[token];
    if (bv === undefined) continue;
    sum += ciede2000(rgbToLab(hexToRgb(a.colours[token])), rgbToLab(hexToRgb(bv)));
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

export interface ClosestPair {
  a: string;
  b: string;
  delta: number;
}

/** The closest pair (smallest mean token-pair distance) among the themes. */
export function closestPair(themes: readonly Theme[]): ClosestPair {
  let best: ClosestPair = { a: '', b: '', delta: Infinity };
  for (let i = 0; i < themes.length; i += 1) {
    for (let j = i + 1; j < themes.length; j += 1) {
      const delta = themePairDistance(themes[i], themes[j]);
      if (delta < best.delta) best = { a: themes[i].name, b: themes[j].name, delta };
    }
  }
  return best;
}

/**
 * The measured mean-token-pair distance of the closest LEGITIMATE bundled pair,
 * recorded for audit. The distinctness threshold sits just below this so every
 * current legitimate pair passes while an exact/near duplicate (mean → 0) fails.
 * Value confirmed by the distinctness test.
 */
export const CLOSEST_LEGITIMATE_PAIR_DELTA = 6.925410524236476;

/**
 * Hard distinctness gate: no two bundled themes may be closer than this mean ΔE00. A
 * duplicated/near-cloned theme (mean → 0) fails; every current legitimate pair passes; the
 * recoloured Bash sits ~20 from Matrix. See research.md R2.
 *
 * This constant is a MEASUREMENT, and it has now been re-derived four times — by 013, by 018, by
 * 016, and again here where 016 and 018 met. The reason it keeps moving is worth stating plainly,
 * because every move looks like a regression and none of them is: the metric is a MEAN over the
 * colour tokens two themes SHARE, so *any* change to the token set moves it, including one that
 * adds a token whose value is identical everywhere — the denominator changes even when no hue does.
 *
 * The two features enlarged the palette independently and neither's measurement survives the merge:
 *   - 016 measured 7.186 (throng vs Windows Terminal) with its 13 syntax/status-strip tokens, but
 *     without 018's.
 *   - 018 measured 4.403 (Windows Terminal vs VSCode) with its split roles, scrollbar trio,
 *     `accentText` and the error pair, but without 016's.
 * Taking either number on faith would have shipped a gate calibrated against a palette that no
 * longer exists. Re-measured against the MERGED token set — the only palette the application
 * actually has — the closest legitimate pair is 6.925.
 *
 * It lands BETWEEN the two, and that is the expected shape rather than a coincidence: 016's syntax
 * hues are drawn from each theme's own character and push the palettes apart, while 018's error pair
 * is DERIVED from every theme's existing `danger` and `bg`, so it adds real separation but less of
 * it — pulling the mean back down from 7.186 without approaching 018's pre-016 4.403.
 *
 * The gate itself is unchanged at 4.3, with 2.63 of headroom. It has never been loosened to
 * accommodate a measurement, and it was not loosened here: it still sits below the closest
 * legitimate pair, while a near-clone (mean → 0) fails it by a mile. The constant follows the
 * measurement, never the other way round.
 */
export const DISTINCTNESS_THRESHOLD = 4.3;

/** Throw if any two themes are closer than DISTINCTNESS_THRESHOLD (names the pair). */
export function assertDistinct(themes: readonly Theme[]): void {
  const offenders: string[] = [];
  for (let i = 0; i < themes.length; i += 1) {
    for (let j = i + 1; j < themes.length; j += 1) {
      const delta = themePairDistance(themes[i], themes[j]);
      if (delta < DISTINCTNESS_THRESHOLD) {
        offenders.push(`${themes[i].name} vs ${themes[j].name} (meanΔE00=${delta.toFixed(3)})`);
      }
    }
  }
  if (offenders.length) {
    throw new Error(
      `themes too close (< ${DISTINCTNESS_THRESHOLD} mean ΔE00): ${offenders.join('; ')}`,
    );
  }
}

/** WCAG 2.1 AA thresholds. */
export const WCAG_AA_BODY = 4.5;
export const WCAG_AA_LARGE_UI = 3.0;

/** The bundled themes redesigned in feature 009 — build-blocking for contrast. */
export const IN_SCOPE_THEMES: readonly string[] = ['Bash', 'SUBNET', 'Cyberpunk'];

export interface ContrastPairing {
  /** foreground colour token. */
  fg: string;
  /** background colour token. */
  bg: string;
  /** required minimum WCAG ratio. */
  min: number;
  /** human label for diagnostics. */
  label: string;
}

/** Every `syntax*` token a theme paints code with, sorted for a stable pairing order. */
function syntaxTokensOf(theme: Theme): string[] {
  return Object.keys(theme.colours)
    .filter((token) => token.startsWith('syntax'))
    .sort();
}

/**
 * The tokens code is painted with (016, FR-006), DERIVED from the canonical registry (019, FR-026).
 *
 * This was a hand-list of ten names, and the hand-list IS the bug #83 reports: 016 added these
 * tokens and nobody added the matching pairings, because nothing forced them to. Restating the
 * names here would leave the same escape hatch one level down — a future `syntaxDecorator` added to
 * the themes and forgotten here would be invisible to every guard below. `THRONG_THEME` is the
 * right source: it is the always-complete theme every other theme falls back to, and the one theme
 * that bypasses `makeTheme`'s legibility lift.
 */
export const SYNTAX_TOKENS: readonly string[] = syntaxTokensOf(THRONG_THEME);

/**
 * The floor for a syntax hue on the editor body (019, C3/FR-025).
 *
 * WCAG AA body text (`WCAG_AA_BODY`, 4.5:1) is the FLOOR, not the gate. `makeTheme` already lifts
 * every syntax seed to 6:1 against `editorBg` (`default-themes/index.ts`, `syntaxAndSearch`),
 * because a search-match surface can only be tinted as far as the WEAKEST syntax hue still reads on
 * it: a comment authored at exactly 4.5:1 on the body leaves NO budget and collapses the search
 * highlight to invisibility. So a 4.5 gate here would be WEAKER than the derivation it exists to
 * protect — it would admit exactly the theme the lift is written to prevent, and report nothing.
 * 6.0 is throng's house standard for code on the editor body, and it is what the shipped themes
 * already meet: all ten tokens across all fifteen bundled themes measure ≥6.01:1.
 */
export const SYNTAX_BODY_MIN = 6.0;

/**
 * Themes whose low contrast is the POINT, not a defect (019, C4/FR-028; #61's policy).
 *
 * All three pass the syntax/body gate today, so the carve-out costs nothing right now. It exists so
 * that a future recolour honouring one of these themes' character is not reported as a defect.
 */
export const BY_DESIGN_LOW_CONTRAST_THEMES: readonly string[] = ['Matrix', 'VI-VIM', 'Gothic'];

/**
 * Every syntax colour, measured on BOTH search-match surfaces (016, FR-007a).
 *
 * This is the pairing set that makes FR-007a mean something. A search match is drawn as a
 * BACKGROUND beneath the code, so highlighted code keeps its colours rather than flattening into
 * a solid block — which means every one of the ten syntax hues must stay legible on top of both
 * match surfaces, not merely on the editor body. Generated from the token list rather than typed
 * out twenty times, so a new syntax token cannot be added without being measured.
 */
const SYNTAX_ON_MATCH: readonly ContrastPairing[] = SYNTAX_TOKENS.flatMap((fg) => [
  { fg, bg: 'searchMatch', min: WCAG_AA_BODY, label: `${fg} on a search match` },
  { fg, bg: 'searchMatchCurrent', min: WCAG_AA_BODY, label: `${fg} on the current search match` },
]);

/** A syntax hue measured on the editor body — the background it is painted on nearly always. */
const syntaxOnBodyPairing = (fg: string): ContrastPairing => ({
  fg,
  bg: 'editorBg',
  min: SYNTAX_BODY_MIN,
  label: `${fg} on the editor background`,
});

/**
 * Every syntax colour, measured on the EDITOR BODY (019, FR-025/#83).
 *
 * The existing pairings measure the syntax hues against the two SEARCH-MATCH surfaces only — the
 * background beneath a handful of characters, occasionally — while `editorBg` is the background for
 * the overwhelming majority of a source file and was never measured at all. DERIVED from
 * `SYNTAX_TOKENS` (FR-026), so a token added later is measured without anyone editing a list.
 */
const SYNTAX_ON_BODY: readonly ContrastPairing[] = SYNTAX_TOKENS.map(syntaxOnBodyPairing);

/**
 * The enumerated foreground-on-background pairings measured for every theme
 * (FR-016). Body text at 4.5:1; muted text, gutter, and UI/button components at
 * 3:1 (accents are UI components — this is what lets SUBNET keep its neons).
 */
export const CONTRAST_PAIRINGS: readonly ContrastPairing[] = [
  { fg: 'text', bg: 'appBg', min: WCAG_AA_BODY, label: 'body text on app background' },
  { fg: 'textMuted', bg: 'appBg', min: WCAG_AA_LARGE_UI, label: 'muted text on app background' },
  { fg: 'terminalFg', bg: 'terminalBg', min: WCAG_AA_BODY, label: 'terminal text on terminal background' },
  { fg: 'editorFg', bg: 'editorBg', min: WCAG_AA_BODY, label: 'editor text on editor background' },
  { fg: 'editorGutterFg', bg: 'editorGutterBg', min: WCAG_AA_LARGE_UI, label: 'gutter line numbers on gutter background' },
  { fg: 'buttonText', bg: 'buttonBg', min: WCAG_AA_LARGE_UI, label: 'button text on button background' },
  { fg: 'buttonHoverText', bg: 'buttonHoverBg', min: WCAG_AA_LARGE_UI, label: 'button hover text on button hover background' },
  { fg: 'buttonText', bg: 'surfaceActive', min: WCAG_AA_LARGE_UI, label: 'button text on active surface' },
  // The editor status strip (016, FR-010c). SC-007 promises the language indicator is READABLE on
  // every bundled theme — a promise that was asserted and never measured until this pairing existed.
  {
    fg: 'editorStatusStripFg',
    bg: 'editorStatusStripBg',
    min: WCAG_AA_BODY,
    label: 'editor status strip label on its strip background',
  },
  ...SYNTAX_ON_MATCH,
  ...SYNTAX_ON_BODY,
];

/**
 * The pairings measured for a GIVEN theme: the enumerated set, plus an `editorBg` pairing for any
 * `syntax*` token the theme carries that the registry does not (FR-026, FR-029).
 *
 * The second half is what makes the derivation real rather than merely tidy. `CONTRAST_PAIRINGS` is
 * derived from `THRONG_THEME` at module load, so a theme that paints code with a token throng has
 * never heard of would otherwise slip through the same crack #83 reports — the list would simply not
 * know about it. Derived per theme, it cannot: whatever a theme SHIPS is what gets measured.
 */
export function contrastPairingsFor(theme: Theme): readonly ContrastPairing[] {
  const extra = syntaxTokensOf(theme)
    .filter((token) => !SYNTAX_TOKENS.includes(token))
    .map(syntaxOnBodyPairing);
  return extra.length === 0 ? CONTRAST_PAIRINGS : [...CONTRAST_PAIRINGS, ...extra];
}

export interface ContrastResult {
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  pass: boolean;
}

/** Measure every enumerated pairing for a theme (colours resolve within the theme). */
export function measureContrast(theme: Theme): ContrastResult[] {
  return contrastPairingsFor(theme).map((p) => {
    const fg = theme.colours[p.fg];
    const bg = theme.colours[p.bg];
    const ratio = fg && bg ? contrastRatio(fg, bg) : 0;
    return { label: p.label, fg: p.fg, bg: p.bg, ratio, min: p.min, pass: ratio >= p.min };
  });
}

/** The failing pairings of a theme (empty if all pass). */
export function contrastFailures(theme: Theme): ContrastResult[] {
  return measureContrast(theme).filter((r) => !r.pass);
}

/**
 * Hard contrast gate for the in-scope themes (Bash, SUBNET, Cyberpunk): throw if
 * any enumerated pairing falls below its WCAG 2.1 AA threshold (FR-017).
 */
export function assertInScopeContrast(themes: readonly Theme[]): void {
  const problems: string[] = [];
  for (const theme of themes) {
    if (!IN_SCOPE_THEMES.includes(theme.name)) continue;
    for (const f of contrastFailures(theme)) {
      problems.push(`${theme.name}: ${f.label} = ${f.ratio.toFixed(2)}:1 (needs ${f.min}:1)`);
    }
  }
  if (problems.length) {
    throw new Error(`in-scope theme contrast below WCAG 2.1 AA: ${problems.join('; ')}`);
  }
}

/**
 * Hard gate for the syntax-on-editor-body pairings across EVERY bundled theme bar the by-design
 * carve-out (019, FR-027/C4): throw if any syntax hue falls below `SYNTAX_BODY_MIN` on the editor
 * background it is painted on, naming theme, token and measured ratio.
 *
 * Deliberately a THROW and deliberately its own gate, for two separate reasons:
 *   - a report nobody reads is what #83 objects to, so routing these to `knownContrastIssues()`
 *     would reproduce the defect in the fix. A theme that fails this fails the build;
 *   - its scope is not `IN_SCOPE_THEMES`, which governs the EXISTING pairings and stays untouched.
 *     Widening that is #61 (vNext) and is risky, because those themes may fail it today. Separating
 *     the pairing SETS is what lets this gate cover all fifteen without blocking on #61 — measured,
 *     every bundled theme already clears it, so gating them all cannot fail the build.
 */
export function assertSyntaxBodyContrast(themes: readonly Theme[]): void {
  const problems: string[] = [];
  for (const theme of themes) {
    if (BY_DESIGN_LOW_CONTRAST_THEMES.includes(theme.name)) continue;
    for (const r of measureContrast(theme)) {
      if (r.bg !== 'editorBg' || !r.fg.startsWith('syntax') || r.pass) continue;
      problems.push(
        `${theme.name}: ${r.fg} on editorBg = ${r.ratio.toFixed(2)}:1 (needs ${r.min}:1)`,
      );
    }
  }
  if (problems.length) {
    throw new Error(
      `syntax colours illegible on the editor body (< ${SYNTAX_BODY_MIN}:1): ${problems.join('; ')}`,
    );
  }
}

export interface KnownContrastIssue {
  theme: string;
  label: string;
  ratio: number;
  min: number;
}

/**
 * Contrast shortfalls in the OUT-OF-SCOPE bundled themes — reported as known
 * issues, never build-blocking (FR-018).
 */
export function knownContrastIssues(themes: readonly Theme[]): KnownContrastIssue[] {
  const out: KnownContrastIssue[] = [];
  for (const theme of themes) {
    if (IN_SCOPE_THEMES.includes(theme.name)) continue;
    for (const f of contrastFailures(theme)) {
      out.push({ theme: theme.name, label: f.label, ratio: Number(f.ratio.toFixed(2)), min: f.min });
    }
  }
  return out;
}
