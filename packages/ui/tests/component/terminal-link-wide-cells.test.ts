import { scanLinkLine } from '@throng/core';
import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { logicalLineAt, rangeOf, trackWrittenWidths, type CellRange } from '../../src/renderer/terminal/logical-line.js';

/**
 * #526 — a terminal link's underline must cover exactly the cells of the path it names (045 FR-130,
 * FR-136), whatever else is printed on the row.
 *
 * The underline is the xterm cell range `rangeOf` returns for a span of the logical line's TEXT, which
 * assumed one UTF-16 unit per cell. Two common characters break that, and every path after one on the
 * same row was underlined in the wrong cells:
 *
 *  - a wide character (CJK) is one unit but two cells: the underline started early and stopped short;
 *  - an emoji outside the BMP (📁 🔧 🚀, common in Claude Code and CLI output) is two units but one
 *    cell: the underline missed the path's first character and ran on past its end.
 *
 * Hovering the cells the path is actually drawn in then found the link only in part.
 *
 * Layer: component — the defect is the disagreement between a REAL xterm buffer's cell layout and the
 * offsets read out of it, so a hand-built buffer would only encode the assumption under test. No
 * renderer, no daemon: the buffer is written to and read back. Each test's buffer costs milliseconds,
 * so none is shared.
 */

async function bufferOf(cols: number, text: string): Promise<Terminal> {
  const term = new Terminal({ cols, rows: 10, allowProposedApi: true });
  await new Promise<void>((resolve) => term.write(text.replace(/\n/g, '\r\n'), resolve));
  return term;
}

/** The characters drawn in the cells an underline over `range` covers, read back off the buffer. */
function cellsUnder(term: Terminal, range: CellRange): string {
  const buffer = term.buffer.active;
  let out = '';
  for (let y = range.start.y; y <= range.end.y; y += 1) {
    const row = buffer.getLine(y - 1);
    const from = y === range.start.y ? range.start.x : 1;
    const to = y === range.end.y ? range.end.x : term.cols;
    for (let x = from; x <= to; x += 1) {
      const cell = row?.getCell(x - 1);
      // The second cell of a wide character has width 0 and no characters of its own.
      if (cell?.getWidth() === 0) continue;
      out += cell?.getChars() || ' ';
    }
  }
  return out;
}

/** Each path the line holds, with the text its underline would actually cover on screen. */
async function underlines(cols: number, text: string, y = 1): Promise<{ path: string; underlined: string }[]> {
  const term = await bufferOf(cols, text);
  const line = logicalLineAt(term.buffer.active, y);
  if (line === null) return [];
  const seen = new Set<number>();
  const out: { path: string; underlined: string }[] = [];
  for (const candidate of scanLinkLine(line.text).paths) {
    if (seen.has(candidate.start)) continue; // the positioned and unpositioned readings share a span
    seen.add(candidate.start);
    out.push({ path: candidate.text, underlined: cellsUnder(term, rangeOf(line, candidate)) });
  }
  term.dispose();
  return out;
}

describe('#526 — a link is underlined over exactly its own cells', () => {
  it('a path after wide CJK characters on the same row', async () => {
    expect(await underlines(80, 'Read 日本語 src/foo/bar.ts now')).toEqual([
      { path: 'src/foo/bar.ts', underlined: 'src/foo/bar.ts' },
    ]);
  });

  it('paths after emoji outside the BMP (📁, 🔧) on the same row', async () => {
    expect(await underlines(80, '📁 src/x/y.ts and 🔧 fixed src/c/d.ts')).toEqual([
      { path: 'src/x/y.ts', underlined: 'src/x/y.ts' },
      { path: 'src/c/d.ts', underlined: 'src/c/d.ts' },
    ]);
  });

  it('a path soft-wrapped onto a second row after emoji on the first', async () => {
    // 30 columns: the path starts on row 1 behind two emoji and wraps onto row 2.
    expect(await underlines(30, '🚀🚀 see packages/ui/src/renderer/terminal/logical-line.ts')).toEqual([
      {
        path: 'packages/ui/src/renderer/terminal/logical-line.ts',
        underlined: 'packages/ui/src/renderer/terminal/logical-line.ts',
      },
    ]);
  });

  it('a path with no wide character before it is unaffected (control)', async () => {
    expect(await underlines(80, '⏺ Read src/foo/bar.ts now')).toEqual([
      { path: 'src/foo/bar.ts', underlined: 'src/foo/bar.ts' },
    ]);
  });
});

/**
 * #526 defect 2 (maintainer decision 2026-11-06, superseding FR-132 in part). Claude Code wraps its own
 * paragraphs: each row ends in a real newline and the next starts at a two-space indent, so xterm never
 * marks it wrapped. A path longer than the room left is cut mid-name — captured at 50 columns:
 *
 *   `  the provider is packages/ui/src/renderer/termina`
 *   `  l/file-link-provider.ts:120 which reads  and`
 *
 * and each half was its own link naming nothing. A row filled to its last column, followed by one at the
 * same indent, whose last word does not already end in a known extension, continues onto that row.
 */
describe('#526 — a path a program broke at the right edge is one link', () => {
  /** The links of the logical line at row `y`, with the cells under each read back WITHOUT indentation. */
  async function joined(cols: number, text: string, y: number) {
    const term = await bufferOf(cols, text);
    const line = logicalLineAt(term.buffer.active, y);
    const out = (line === null ? [] : scanLinkLine(line.text).paths)
      .filter((c, i, all) => all.findIndex((o) => o.start === c.start) === i)
      .map((c) => ({ path: c.text, position: c.position, underlined: cellsUnder(term, rangeOf(line!, c)).replace(/\n|^ +| {2,}/g, '') }));
    term.dispose();
    return out;
  }

  const CLAUDE = [
    '  the provider is packages/ui/src/renderer/termina',
    '  l/file-link-provider.ts:120 which reads it',
  ].join('\n');

  it('the path is one link, at its position, from the first row', async () => {
    expect(await joined(50, CLAUDE, 1)).toEqual([
      {
        path: 'packages/ui/src/renderer/terminal/file-link-provider.ts',
        position: { line: 120 },
        // FR-188g: the position is underlined with the path.
        underlined: 'packages/ui/src/renderer/terminal/file-link-provider.ts:120',
      },
    ]);
  });

  it('the same one link from the second row', async () => {
    expect((await joined(50, CLAUDE, 2)).map((l) => l.path)).toEqual(['packages/ui/src/renderer/terminal/file-link-provider.ts']);
  });

  it('a row that does not reach the last column is not joined', async () => {
    const text = ['  short row src/a', '  b/c.ts more'].join('\n');
    expect((await joined(50, text, 1)).map((l) => l.path)).toEqual([]);
  });

  it('a full row whose last word ends in a known extension is not joined', async () => {
    // 50 columns exactly: the row ends with `x.ts`, the next row starts a new word.
    const row = `  ${'w'.repeat(43)} x.ts`;
    expect(row.length).toBe(50);
    expect((await joined(50, `${row}\n  more/y.md`, 1)).map((l) => l.path)).toEqual(['x.ts']);
  });

  it('a row at a different indent is not joined', async () => {
    const row = `  see packages/ui/src/renderer/terminal/abcdefghij`;
    expect(row.length).toBe(50);
    expect((await joined(50, `${row}\nnext/thing.ts`, 1)).map((l) => l.path)).toEqual([]);
  });
});

/**
 * #526, maintainer hand-test 2026-11-06: "the link sections work fine until I resize the terminal window",
 * after which each half of a Claude Code path opened on its own and was `notFound`. A program's break
 * is not reflowed by xterm, so after a resize the row no longer reaches the CURRENT last column; the row
 * is full at the width it was WRITTEN at, which `trackWrittenWidths` remembers.
 */
describe('#526 — a joined path survives a resize', () => {
  const CLAUDE = [
    '  the provider is packages/ui/src/renderer/termina',
    '  l/file-link-provider.ts:120 which reads it',
  ].join('\n');

  for (const cols of [70, 40]) {
    it(`is still one link after resizing from 50 to ${cols} columns`, async () => {
      const term = new Terminal({ cols: 50, rows: 10, allowProposedApi: true });
      const widths = trackWrittenWidths(term);
      await new Promise<void>((resolve) => term.write(CLAUDE.replace(/\n/g, '\r\n'), resolve));
      term.resize(cols, 10);

      const buffer = term.buffer.active;
      const paths = new Set<string>();
      for (let y = 1; y <= buffer.length; y += 1) {
        const line = logicalLineAt(buffer, y, undefined, widths.widthsAt);
        const found = line === null ? [] : scanLinkLine(line.text).paths;
        // The first reading of each span is the link (R7); the second is the unpositioned alternative.
        for (const c of found.filter((c, i) => found.findIndex((o) => o.start === c.start) === i)) paths.add(c.text);
      }
      widths.dispose();
      term.dispose();
      expect([...paths]).toEqual(['packages/ui/src/renderer/terminal/file-link-provider.ts']);
    });
  }
});

describe('#526 — control', () => {
  it('a path with no wide character before it is unaffected', async () => {
    expect(await underlines(80, '⏺ Read src/foo/bar.ts now')).toEqual([
      { path: 'src/foo/bar.ts', underlined: 'src/foo/bar.ts' },
    ]);
  });
});
