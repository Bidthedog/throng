import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedLink } from '@throng/core';
import { copyLinkAddress } from '../../src/renderer/links/link-actions.js';

/**
 * 045 FR-032 — what Copy Link Address puts on the clipboard (T082).
 *
 * ══ THE RESOLVED PATH, NOT THE TEXT THAT WAS CLICKED ══
 *
 * A terminal prints `src/foo.ts` and an editor writes `./b.md`; neither is any use pasted into a
 * shell, an issue or another editor. What the user asked for is the location, and throng has already
 * worked it out — so the item copies `D:\project\src\foo.ts`, which is what makes it worth having
 * beside the OS targets rather than a synonym for selecting the text.
 *
 * ══ AND THE POSITION IN THE FORM IT WAS WRITTEN ══
 *
 * `foo.ts:42:7` and `foo.ts(42,7)` are the two conventions the tools that print them use, and a
 * copy that normalised one into the other would paste something the originating tool cannot read
 * back. `positionText` is carried verbatim from detection for exactly this.
 *
 * ══ WHERE THIS DIFFERS FROM 044 FR-116 ══
 *
 * 044's Copy Link Address refuses a target outside the project, because a preview link that leaves
 * the project is a link the app will not follow. 045's copies it: the OS targets will act on it, the
 * user can see the path in the tooltip already, and a copy that silently produced nothing for
 * exactly the links the user most needs to name would read as a broken item.
 */

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: 'D:\\project\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

let write: ReturnType<typeof vi.fn>;

beforeEach(() => {
  write = vi.fn(async () => {});
  (window as unknown as { throng?: unknown }).throng = { clipboard: { write } };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

describe('Copy Link Address (FR-032)', () => {
  it('copies the RESOLVED absolute path, as plain text', async () => {
    await copyLinkAddress({ link: link() });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ text: 'D:\\project\\src\\foo.ts', mode: 'verbatim' });
  });

  it('appends the position in the form it was written — the colon form', async () => {
    await copyLinkAddress({ link: link(), positionText: ':42:7' });

    expect(write).toHaveBeenCalledWith({
      text: 'D:\\project\\src\\foo.ts:42:7',
      mode: 'verbatim',
    });
  });

  it('…and the parenthesised form, unchanged rather than normalised', async () => {
    await copyLinkAddress({ link: link(), positionText: '(42,7)' });

    expect(write).toHaveBeenCalledWith({
      text: 'D:\\project\\src\\foo.ts(42,7)',
      mode: 'verbatim',
    });
  });

  it('copies a resolved path for a target OUTSIDE the project too', async () => {
    await copyLinkAddress({
      link: link({ path: 'D:\\elsewhere\\notes.txt', inProject: false }),
    });

    expect(write).toHaveBeenCalledWith({ text: 'D:\\elsewhere\\notes.txt', mode: 'verbatim' });
  });

  it('copies a folder’s path, which has no position to carry', async () => {
    await copyLinkAddress({ link: link({ path: 'D:\\project\\src', kind: 'folder' }) });

    expect(write).toHaveBeenCalledWith({ text: 'D:\\project\\src', mode: 'verbatim' });
  });

  it('does nothing, and throws nothing, when the clipboard seam is absent', async () => {
    delete (window as unknown as { throng?: unknown }).throng;
    await expect(copyLinkAddress({ link: link() })).resolves.toBeUndefined();
  });
});
