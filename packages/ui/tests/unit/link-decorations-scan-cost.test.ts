import { EditorState } from '@codemirror/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanOptions } from '@throng/core';

/*
 * 045 FR-073, Principle XII — what a viewport move costs the editor's link scan.
 *
 * The marks are rebuilt over the visible lines on every viewport change, and an editor scrolled in step with a CSV
 * preview changes its viewport every frame. The maintainer's linked pair (2026-11-21) lagged on a CSV of ~2 KB JSON
 * records: with word wrap off, ~45 such lines are in view, and every frame scanned all of them again although only the
 * few lines that scrolled in were new. A line's links are a pure function of its text and the scan options, so a line
 * already scanned with the same options is not scanned again.
 *
 * Layer: unit — the subject is `buildLinkDecorations` over a SUPPLIED visible range (jsdom has no viewport), counting
 * core's `scanLinkLine`.
 */
const scanned: string[] = [];
vi.mock('@throng/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@throng/core')>();
  return {
    ...real,
    scanLinkLine: (line: string, options?: ScanOptions) => {
      scanned.push(line);
      return real.scanLinkLine(line, options);
    },
  };
});

const { buildLinkDecorations } = await import('../../src/renderer/editor/link-decorations.js');

const site = { panelId: 'panel-1', originProjectId: 'project-1', baseDirectory: 'D:\\project' };
const OPTIONS: ScanOptions = {};
const deps = (options: ScanOptions = OPTIONS) => ({ site: () => site, scanOptions: () => options, follow: vi.fn() });

const DOC = Array.from({ length: 200 }, (_, i) => `row ${i} see src/file${i}.ts and https://example.com/${i}`).join('\n');
const state = EditorState.create({ doc: DOC });
/** Lines `first..last` (1-based, inclusive) as the visible range. */
const lines = (first: number, last: number) => ({
  state,
  visibleRanges: [{ from: state.doc.line(first).from, to: state.doc.line(last).to }],
});

beforeEach(() => void (scanned.length = 0));

describe('the editor link scan across a viewport move (045 FR-073, Principle XII)', () => {
  it('scans only the lines that scrolled into view, and draws the same marks as a fresh scan', () => {
    buildLinkDecorations(lines(101, 145), deps());
    scanned.length = 0;
    const moved = buildLinkDecorations(lines(106, 150), deps());
    expect(scanned).toEqual([146, 147, 148, 149, 150].map((n) => state.doc.line(n).text));
    // The cached lines draw exactly what scanning them would: compare with a scan under fresh options.
    const fresh = buildLinkDecorations(lines(106, 150), deps({}));
    expect(moved.size).toBeGreaterThan(0);
    expect(moved.size).toBe(fresh.size);
  });

  it('scans every line again when the scan options change (a settings edit)', () => {
    buildLinkDecorations(lines(1, 10), deps());
    scanned.length = 0;
    buildLinkDecorations(lines(1, 10), deps({ knownExtensions: new Set(['ts']) }));
    expect(scanned).toHaveLength(10);
  });
});
