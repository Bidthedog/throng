import { describe, expect, it } from 'vitest';
import {
  createFileLinkProvider,
  type FileLinkProviderDeps,
  type LinkProviderTerminal,
} from '../../src/renderer/terminal/file-link-provider.js';
import type { TerminalLinkSite } from '../../src/renderer/terminal/terminal-link-activation.js';

/**
 * 045 — **the reported bug**: a prompt whose folder contains a space loses the last word of the path.
 *
 * The maintainer, verbatim:
 *
 *   "In PowerShell, cmd and bash prompts, the 'location' prompt does not capture spaces in the folder
 *    e.g. PS `D:\git\throng_tests\test 1>`, CMD `D:\git\throng_tests\test 1>`, Bash
 *    `Spikeh@MUHAMMAD MINGW64 /d/git/throng_tests/test 1 (master)`. The links detect, but the 1 is
 *    missed off the end. … The same happens when this same link is displayed in the Claude Code CLI
 *    header."
 *
 * ══ WHY IT IS AT THIS LAYER AND NOT IN `link-detect-spaces.test.ts` ══
 *
 * The space rule is authoritative and stays: a bare path stops at the first space unless it is
 * quoted, bracketed, ends in a separator, or reaches a known extension (FR-173/FR-179, 92 cases).
 * `test 1` is none of those, so from the TEXT ALONE the grammar is right to stop — and a core test
 * could only reproduce this by weakening it.
 *
 * What makes the prompt different is not the text, it is that the terminal already KNOWS the shell's
 * working directory: the cwd store's value, gated by `flavourReportsDirectory`, arrives at the
 * provider as `site().baseDirectory`. So the lowest layer that can show the bug is the one where
 * that value exists — here — and the assertion is the one the user makes: what the link SAYS.
 *
 * Still no disk: this is a string compared against a value throng is already holding (FR-155).
 */

const CWD = 'D:\\git\\throng_tests\\test 1';

/** The cwd as Git Bash's integration reports it — `cygpath -w "$PWD"`, so the Windows spelling. */
const BASH_SITE: TerminalLinkSite = { panelId: 'panel-1', baseDirectory: CWD };

class FakeTerminal implements LinkProviderTerminal {
  constructor(private readonly rows: readonly string[]) {}

  buffer = {
    active: {
      getLine: (index: number) =>
        this.rows[index] === undefined
          ? undefined
          : { translateToString: () => this.rows[index] as string },
    },
  };
}

function fileLinkTexts(line: string, over: Partial<FileLinkProviderDeps> = {}): string[] {
  const provider = createFileLinkProvider({
    terminal: new FakeTerminal([line]),
    detect: () => true,
    site: () => BASH_SITE,
    onHover: () => {},
    follow: () => {},
    ...over,
  });
  // xterm counts buffer lines from 1; the fake buffer's only row is index 0.
  return provider.linksOnLine(1).filter((l) => l.kind === 'file').map((l) => l.text);
}

describe('a prompt naming the terminal’s own working directory keeps the space in it', () => {
  it('PowerShell — `PS D:\\git\\throng_tests\\test 1>`', () => {
    expect(fileLinkTexts(`PS ${CWD}>`)).toEqual([CWD]);
  });

  it('cmd — `D:\\git\\throng_tests\\test 1>`', () => {
    expect(fileLinkTexts(`${CWD}>`)).toEqual([CWD]);
  });

  it('Git Bash — the POSIX drive form of the same directory', () => {
    const line = 'Spikeh@MUHAMMAD MINGW64 /d/git/throng_tests/test 1 (master)';
    expect(fileLinkTexts(line)).toEqual(['/d/git/throng_tests/test 1']);
  });

  it('the Claude Code CLI header, which prints the same directory as ordinary text', () => {
    expect(fileLinkTexts(`cwd: ${CWD}`)).toEqual([CWD]);
  });

  it('a parent of the working directory extends too, at a separator boundary', () => {
    expect(fileLinkTexts('D:\\git\\throng_tests')).toEqual(['D:\\git\\throng_tests']);
  });

  it('prose that merely starts like the directory is left exactly as the space rule leaves it', () => {
    // `D:\git\throng_tests\test` is a prefix of the cwd as a STRING, but `tester` is not the next
    // segment of it, so nothing is extended and the default (stop at the first space) stands.
    expect(fileLinkTexts('D:\\git\\throng_tests\\test tester ran')).toEqual([
      'D:\\git\\throng_tests\\test',
    ]);
  });

  it('with no working directory known, behaviour is exactly as it is today', () => {
    expect(fileLinkTexts(`PS ${CWD}>`, { site: () => ({ panelId: 'panel-1' }) })).toEqual([
      'D:\\git\\throng_tests\\test',
    ]);
  });
});
