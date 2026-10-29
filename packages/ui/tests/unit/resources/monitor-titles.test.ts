/**
 * A hover title in the Resource Monitor names a thing and never holds a live figure (055 FR-095).
 *
 * Chromium closes a native tooltip whose text changes, so a title carrying a figure flashes up and
 * disappears every capture under a resting pointer. This guards the SOURCES, because the failure is a
 * habit — a new row, tile or bar reaching for `valueText` — not a state a component test would think to
 * look for. The status bar's own item (`status-resources.tsx`) is the main window's, not the monitor's.
 *
 * Layer: unit — reads source text only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../src/renderer/resources');
const NOT_THE_MONITOR = new Set(['status-resources.tsx', 'use-resource-summary.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !NOT_THE_MONITOR.has(name) ? [path] : [];
  });
}

/** The expression of every `title={…}` in `text`, braces balanced (a template literal's `${}` nests). */
export function titleExpressions(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\btitle=\{/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    found.push(text.slice(start, i - 1));
  }
  return found;
}

/** Anything that puts a measured number or its text into a string. */
const LIVE = /valueText|cellTitle|\.text\b|formatBytes|formatPercent|formatRate|formatGrouped|figureOf|figuresOf|\.value\b/;

describe('hover titles carry no live figure (FR-095)', () => {
  it('finds the titles it is meant to guard', () => {
    expect(titleExpressions('<a title={`Open ${label}`} b title="x" c title={y}/>')).toEqual(['`Open ${label}`', 'y']);
  });

  it('has none in the monitor that is built from a figure', () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      for (const expression of titleExpressions(readFileSync(file, 'utf8'))) {
        if (LIVE.test(expression)) offenders.push(`${file.slice(ROOT.length + 1)}: title={${expression.trim().slice(0, 80)}}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
