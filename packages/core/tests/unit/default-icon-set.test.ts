import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ICON_SET, ICON_KEYS, sanitiseSvg } from '../../src/index.js';
// @ts-expect-error -- a plain .mjs build script with no type declarations
import { generateModule } from '../../../../scripts/generate-default-icon-set.mjs';

/**
 * Spec 069: the default icon set's vendored art (FR-002 to FR-009). The files under
 * `src/icons/default-set/` are what the generator compiles into the app, so these rules hold for
 * every icon throng ships.
 */
const SET_DIR = fileURLToPath(new URL('../../src/icons/default-set/', import.meta.url));
const sources = JSON.parse(readFileSync(`${SET_DIR}SOURCES.json`, 'utf8')) as {
  lucideVersion: string;
  sameAction: string[][];
  keys: Record<string, { lucide: string } | { throng: string }>;
};
// A Windows checkout gives the SVGs CRLF; the generator compiles them with LF, so compare the same.
const art = (key: string) => readFileSync(`${SET_DIR}${key}.svg`, 'utf8').replace(/\r\n/g, '\n');

/** FR-009: the pairs and families that appear together and must look different. */
const FR009_GROUPS = [
  ['save', 'saveAs'],
  ['expand', 'collapse'],
  ['expandAll', 'collapseAll'],
  ['findNext', 'findPrevious'],
  ['moveUp', 'moveDown'],
  ['zoomIn', 'zoomOut', 'zoomReset'],
  ['folder', 'folderOpen'],
  ['windowMaximise', 'windowRestore'],
  ['panelMaximise', 'panelRestore'],
  ['undo', 'redo'],
  ['navigateBack', 'navigateForward'],
];

describe('default icon set art (069)', () => {
  it('has exactly one SVG and one SOURCES.json entry per key, and nothing else (FR-004)', () => {
    const svgs = readdirSync(SET_DIR).filter((f) => f.endsWith('.svg'));
    expect(svgs.map((f) => f.slice(0, -4)).sort()).toEqual([...ICON_KEYS].sort());
    expect(Object.keys(sources.keys).sort()).toEqual([...ICON_KEYS].sort());
    expect(readdirSync(SET_DIR).filter((f) => !f.endsWith('.svg')).sort()).toEqual(['LICENSE', 'SOURCES.json']);
  });

  it('takes art only from Lucide, at the pinned version, or drawn for throng with a reason (FR-002, FR-003)', () => {
    expect(sources.lucideVersion).toBe('1.66.0');
    for (const [key, entry] of Object.entries(sources.keys)) {
      const lucide = 'lucide' in entry ? entry.lucide : undefined;
      const throng = 'throng' in entry ? entry.throng : undefined;
      expect(Boolean(lucide) !== Boolean(throng), key).toBe(true);
      if (throng) expect(throng.length, key).toBeGreaterThan(20);
    }
  });

  it('keeps Lucide’s licence, with its Feather notice, beside the art (FR-022)', () => {
    const licence = readFileSync(`${SET_DIR}LICENSE`, 'utf8');
    expect(licence.startsWith('ISC License')).toBe(true);
    expect(licence).toContain('Lucide Icons and Contributors');
    expect(licence).toContain('Cole Bemis');
  });

  it.each([...ICON_KEYS])('%s is sanitiser-clean single-colour line art on a 24 grid (FR-005 to FR-007)', (key) => {
    const svg = art(key);
    expect(sanitiseSvg(svg)?.trim()).toBe(svg.trim());
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).not.toMatch(/<(text|image|foreignObject)\b/i);
    for (const [, value] of svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) {
      expect(['none', 'currentColor'], `${key}: ${value}`).toContain(value);
    }
  });

  it('shares art only within a declared same-action group (FR-008)', () => {
    const byArt = new Map<string, string[]>();
    for (const key of ICON_KEYS) byArt.set(art(key), [...(byArt.get(art(key)) ?? []), key]);
    const declared = (keys: string[]) => sources.sameAction.some((group) => keys.every((k) => group.includes(k)));
    for (const keys of byArt.values()) {
      if (keys.length > 1) expect(declared(keys), keys.join(', ')).toBe(true);
    }
  });

  it.each(FR009_GROUPS)('draws %s and its partners differently (FR-009)', (...group) => {
    expect(new Set(group.map(art)).size).toBe(group.length);
  });
});

describe('the compiled default icon set (069 research R2, FR-021)', () => {
  it('is exactly what the generator makes from the vendored art (run `npm run generate:icons`)', () => {
    const onDisk = readFileSync(fileURLToPath(new URL('../../src/icons/default-icon-set.generated.ts', import.meta.url)), 'utf8');
    expect(onDisk.replace(/\r\n/g, '\n')).toBe((generateModule as () => string)());
  });

  it('holds markup for every key', () => {
    expect(Object.keys(DEFAULT_ICON_SET).sort()).toEqual([...ICON_KEYS].sort());
    for (const key of ICON_KEYS) expect(DEFAULT_ICON_SET[key], key).toBe(art(key).trim());
  });

  it('keeps the vendored SVG files out of every installer', () => {
    const builder = readFileSync(fileURLToPath(new URL('../../../../electron-builder.yml', import.meta.url)), 'utf8');
    expect(builder).toContain("'!**/src/icons/default-set/**'");
  });
});
