/**
 * 041 FR-018/FR-018a — WHAT A PANEL-LESS NOTICE ROW RENDERS.
 *
 * A row for a refused open has no panel, so it cannot render a panel name; it renders the path. And
 * it renders the path RELATIVE to the project root, because the notice's heading already names the
 * project (030 FR-031) — the same eliding principle 030 FR-022a applies to the project and tab parts
 * of a panel name. The ABSOLUTE form stays in the row's `detail`, for Copy and the log (FR-018c):
 * narrowing what is shown, never what is recoverable.
 *
 * FR-018a is the case that has to be got right rather than assumed: a subject OUTSIDE the root has no
 * relative form at all. Returning something relative-looking for it — `../../elsewhere/a.bin` — would
 * be a path the user cannot act on and cannot recognise, so the absolute form is used instead.
 */
import { describe, expect, it } from 'vitest';
import { relativeToRoot } from '../../../src/index.js';

describe('relativeToRoot', () => {
  it('elides the root, because the notice heading already names the project', () => {
    expect(relativeToRoot('D:/proj/src/big.bin', 'D:/proj')).toBe('src/big.bin');
  });

  it('handles a file directly in the root', () => {
    expect(relativeToRoot('D:/proj/big.bin', 'D:/proj')).toBe('big.bin');
  });

  it('matches case-insensitively, because Windows roots do', () => {
    expect(relativeToRoot('D:/Proj/src/big.bin', 'd:/proj')).toBe('src/big.bin');
  });

  it('accepts either separator on either side, since a stored root may use either', () => {
    expect(relativeToRoot('D:\\proj\\src\\big.bin', 'D:/proj')).toBe('src/big.bin');
    expect(relativeToRoot('D:/proj/src/big.bin', 'D:\\proj')).toBe('src/big.bin');
  });

  it('returns the path unchanged when it is OUTSIDE the root (FR-018a)', () => {
    // No relative form exists. A `../..`-style answer would be a path the user can neither recognise
    // nor act on, which is worse than the absolute one it replaced.
    expect(relativeToRoot('D:/elsewhere/big.bin', 'D:/proj')).toBe('D:/elsewhere/big.bin');
  });

  it('returns the path unchanged when there is no root to be relative to', () => {
    expect(relativeToRoot('D:/proj/big.bin', undefined)).toBe('D:/proj/big.bin');
    expect(relativeToRoot('D:/proj/big.bin', '')).toBe('D:/proj/big.bin');
  });

  it('does not treat a sibling folder with a shared prefix as inside the root', () => {
    // `D:/project-two` starts with `D:/proj`, and a naive prefix check would strip it to
    // `ect-two/big.bin` — a nonsense path presented as though it were inside the project.
    expect(relativeToRoot('D:/project-two/big.bin', 'D:/proj')).toBe('D:/project-two/big.bin');
  });
});
