#!/usr/bin/env node
/**
 * Spec 069 FR-057: draw the language file icons Lucide does not have, and (FR-058) the Markdown icon,
 * whose label is the Markdown mark: an M and a down arrow.
 *   node scripts/draw-file-label-icons.mjs
 * Each is Lucide 1.66.0's plain `file` outline with the language's short label written inside it in
 * strokes, since an icon may carry no text element (the sanitiser drops `<text>`) and a font would draw
 * differently on every OS. The letters come from the small stroke alphabet below, drawn in a 3 × 5 box
 * and scaled into the file's body without scaling the stroke. Output goes to
 * specs/069-lucide-icon-set/review/drafts/<key>.svg, where scripts/vendor-lucide-icons.mjs reads every
 * `throng` entry of SOURCES.json; run that script next, then `npm run generate:icons`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRAFTS = join(ROOT, 'specs/069-lucide-icon-set/review/drafts');

/** The language icons: key and the label drawn inside the file. Kept in step with SOURCES.json. */
export const LABEL_ICONS = [
  ['fileC', 'C'],
  ['fileCpp', 'C++'],
  ['fileCsharp', 'C#'],
  ['fileJava', 'JV'],
  ['fileJavaScript', 'JS'],
  ['fileTypeScript', 'TS'],
  ['filePython', 'PY'],
  ['fileGo', 'GO'],
  ['fileRust', 'RS'],
  ['fileRuby', 'RB'],
  ['fileR', 'R'],
  ['fileLua', 'LUA'],
  ['fileDart', 'DA'],
  ['fileSwift', 'SW'],
  ['fileScala', 'SC'],
  ['fileKotlin', 'KT'],
  ['filePhp', 'PHP'],
  ['fileSql', 'SQL'],
  ['fileHtml', 'HTM'],
  ['fileCss', 'CSS'],
  ['fileSass', 'SAS'],
  ['filePowerShell', 'PS'],
  ['fileMarkdown', 'M↓'],
];

/** Lucide 1.66.0 `file`, unchanged. */
const FILE_OUTLINE = [
  'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
  'M14 2v5a1 1 0 0 0 1 1h5',
];

/**
 * A stroke alphabet in a 3 wide × 5 tall box, origin at the top left. Absolute M, L, H, V, C and Z
 * only, so each coordinate can be scaled on its own axis.
 */
const GLYPHS = {
  A: 'M0 5L1.5 0L3 5M0.6 3.3H2.4',
  B: 'M0 2.5V0H1.6C2.3 0 2.8 0.5 2.8 1.25C2.8 2 2.3 2.5 1.6 2.5H0V5H1.8C2.5 5 3 4.5 3 3.75C3 3 2.5 2.5 1.8 2.5',
  C: 'M3 0.6C2.6 0.2 2.1 0 1.5 0C0.5 0 0 1 0 2.5C0 4 0.5 5 1.5 5C2.1 5 2.6 4.8 3 4.4',
  D: 'M0 0V5H1C2.4 5 3 4 3 2.5C3 1 2.4 0 1 0Z',
  G: 'M3 0.6C2.6 0.2 2.1 0 1.5 0C0.5 0 0 1 0 2.5C0 4 0.5 5 1.5 5C2.5 5 3 4.2 3 3.2V2.7H1.8',
  H: 'M0 0V5M3 0V5M0 2.5H3',
  J: 'M3 0V3.5C3 4.5 2.4 5 1.5 5C0.6 5 0 4.5 0 3.8',
  K: 'M0 0V5M3 0L0.3 2.8M1.2 2L3 5',
  L: 'M0 0V5H3',
  M: 'M0 5V0L1.5 2.6L3 0V5',
  O: 'M1.5 0C0.5 0 0 1 0 2.5C0 4 0.5 5 1.5 5C2.5 5 3 4 3 2.5C3 1 2.5 0 1.5 0Z',
  P: 'M0 5V0H1.6C2.5 0 3 0.6 3 1.4C3 2.2 2.5 2.8 1.6 2.8H0',
  Q: 'M1.5 0C0.5 0 0 1 0 2.5C0 4 0.5 5 1.5 5C2.5 5 3 4 3 2.5C3 1 2.5 0 1.5 0ZM1.9 3.9L3 5.2',
  R: 'M0 5V0H1.6C2.5 0 3 0.6 3 1.4C3 2.2 2.5 2.8 1.6 2.8H0M1.6 2.8L3 5',
  S: 'M3 0.7C2.6 0.2 2.1 0 1.5 0C0.6 0 0 0.5 0 1.3C0 2.1 0.7 2.4 1.5 2.5C2.3 2.6 3 2.9 3 3.7C3 4.5 2.4 5 1.5 5C0.9 5 0.3 4.8 0 4.3',
  T: 'M0 0H3M1.5 0V5',
  U: 'M0 0V3.5C0 4.4 0.6 5 1.5 5C2.4 5 3 4.4 3 3.5V0',
  V: 'M0 0L1.5 5L3 0',
  W: 'M0 0L0.75 5L1.5 2L2.25 5L3 0',
  Y: 'M0 0L1.5 2.5L3 0M1.5 2.5V5',
  '+': 'M0.3 2.5H2.7M1.5 1.3V3.7',
  '#': 'M1.1 0.4L0.6 4.6M2.4 0.4L1.9 4.6M0 1.7H3M0 3.3H3',
  '↓': 'M1.5 0V5M0 3.4L1.5 5L3 3.4',
};

/** Where a label sits: the file's body below the fold, centred on (12, 15). */
const LABEL_TOP = 11.5;
const LABEL_HEIGHT = 7;
/** Per label length: each letter's width and the gap between letters. */
const LAYOUT = { 1: [4, 0], 2: [4, 1.5], 3: [3.2, 1] };

const round = (n) => Number(n.toFixed(3)).toString();

/** One glyph's path, its box moved to `left` and scaled to `width` × LABEL_HEIGHT. */
function placeGlyph(glyph, left, width) {
  const sx = width / 3;
  const sy = LABEL_HEIGHT / 5;
  const x = (v) => round(left + v * sx);
  const y = (v) => round(LABEL_TOP + v * sy);
  const out = [];
  for (const [, cmd, args] of glyph.matchAll(/([MLHVCZ])([^MLHVCZ]*)/g)) {
    const n = args.trim() === '' ? [] : args.trim().split(/[\s,]+/).map(Number);
    if (cmd === 'H') out.push(`H${x(n[0])}`);
    else if (cmd === 'V') out.push(`V${y(n[0])}`);
    else if (cmd === 'Z') out.push('Z');
    else {
      const pairs = [];
      for (let i = 0; i < n.length; i += 2) pairs.push(`${x(n[i])} ${y(n[i + 1])}`);
      out.push(`${cmd}${pairs.join(' ')}`);
    }
  }
  return out.join('');
}

export function drawLabelIcon(label) {
  const [width, gap] = LAYOUT[label.length] ?? LAYOUT[3];
  const total = label.length * width + (label.length - 1) * gap;
  let left = 12 - total / 2;
  const letters = [];
  for (const ch of label) {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`draw-file-label-icons: no stroke for "${ch}"`);
    letters.push(placeGlyph(glyph, left, width));
    left += width + gap;
  }
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
    ...FILE_OUTLINE.map((d) => `  <path d="${d}" />`),
    `  <path stroke-width="1.5" d="${letters.join('')}" />`,
    '</svg>',
    '',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(DRAFTS, { recursive: true });
  for (const [key, label] of LABEL_ICONS) writeFileSync(join(DRAFTS, `${key}.svg`), drawLabelIcon(label));
  console.log(`draw-file-label-icons: ${LABEL_ICONS.length} drawings → ${DRAFTS}`);
}
