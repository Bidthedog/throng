import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_KEYS, ICON_KEY_DESCRIPTIONS } from '../../src/icons/icon-keys.js';
import { ICON_SETS_README } from '../../src/icons/default-icon-set.generated.js';

/**
 * 069 FR-023, FR-035 — the plain-text README throng writes into the user's icon sets folder lists
 * every icon key with its file name and description, and a build fails when the list drifts from the
 * keys throng defines. Layer: unit — plain text read from the source file.
 */
const README_PATH = new URL('../../src/icons/icon-sets-README.txt', import.meta.url);
const readme = readFileSync(README_PATH, 'utf8').replace(/\r\n/g, '\n');

const BEGIN = '---- icon keys: begin ----';
const END = '---- icon keys: end ----';

/** The lines fenced between the two markers, as `<key>.svg - <description>`. */
function fencedKeyLines(text: string): string[] {
  const lines = text.split('\n');
  const begin = lines.indexOf(BEGIN);
  const end = lines.indexOf(END);
  expect(begin, 'the README has no begin marker').toBeGreaterThanOrEqual(0);
  expect(end, 'the README has no end marker').toBeGreaterThan(begin);
  return lines.slice(begin + 1, end).filter((l) => l.trim() !== '');
}

describe('icon sets README (069 FR-023, FR-035)', () => {
  it('lists every icon key, in order, with its file name and description', () => {
    const expected = ICON_KEYS.map((key) => `${key}.svg - ${ICON_KEY_DESCRIPTIONS[key]}`);
    expect(fencedKeyLines(readme)).toEqual(expected);
  });

  it('is the text compiled into core (npm run generate:icons keeps them in step)', () => {
    expect(ICON_SETS_README).toBe(readme);
  });

  it('is plain text: no Markdown heading, emphasis, code fence or link', () => {
    for (const line of readme.split('\n')) {
      expect(line, line).not.toMatch(/^#{1,6}\s/);
      expect(line, line).not.toMatch(/\*\*|__|`|\]\(/);
      expect(line, line).not.toMatch(/^\s*[*]\s/);
    }
  });

  it('keeps every line short enough to read in a plain editor', () => {
    const keyLines = new Set(fencedKeyLines(readme));
    for (const line of readme.split('\n')) {
      if (keyLines.has(line)) continue;
      expect(line.length, line).toBeLessThanOrEqual(110);
    }
  });

  it('uses "icon set", never "pack", and no Windows-only wording', () => {
    // The key list quotes descriptions that name panes (File Explorer), so the wording check is on the prose.
    const keyLines = new Set(fencedKeyLines(readme));
    const prose = readme
      .split('\n')
      .filter((l) => !keyLines.has(l))
      .join('\n');
    expect(prose).not.toMatch(/\bpacks?\b/i);
    expect(prose).not.toMatch(/\bexplorer\b/i);
    expect(readme).not.toMatch(/\bpacks?\b/i);
  });

  it.each([
    ['creating a set', /create/i],
    ['Override this icon', /Override this icon/],
    ['the replace prompt', /replace/i],
    ['editing outside throng', /outside throng/i],
    ['removing a file', /remov|delet/i],
    ['Reload the icon sets from disk', /Reload the icon sets from disk/],
    ['every action reading the sets again (FR-041)', /reads every set again when it starts, and whenever you use any\s+of the icon set controls/],
    ['renaming and deleting a set (FR-042, FR-043)', /Rename this icon set and Delete this icon set/],
    ['resetting an icon (FR-044)', /Reset this icon to the default/],
    ['new and redrawn icons', /redrawn|newly shipped|new icons/i],
    ['migrating a backup', /\.bak/],
  ])('explains %s', (_what, pattern) => {
    expect(readme).toMatch(pattern);
  });
});
