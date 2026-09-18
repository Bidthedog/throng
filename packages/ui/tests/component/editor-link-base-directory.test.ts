import { describe, expect, it } from 'vitest';
import { editorLinkSiteFor } from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 FR-022 — what an editor measures a relative path against (T100).
 *
 * ══ THE OPEN FILE'S OWN FOLDER, FIRST ══
 *
 * `docs/a.md` naming `./b.md` means the `b.md` beside it, and naming `packages/core/x.ts` means the
 * one at the project root. Both are ordinary, both appear in the same document, and only the base
 * directory tells them apart — so the editor supplies its own folder and the resolver tries that
 * before the root (R10, US3 scenarios 1 and 2). This is the editor's half of the pair FR-023 states
 * for terminals, where the base is the shell's live working directory instead.
 *
 * ══ AN UNTITLED BUFFER HAS NO FOLDER, AND SAYS SO BY OMISSION ══
 *
 * Not the project root, and not the empty string: an ABSENT `baseDirectory` is what makes the
 * resolver try the project root alone (R11's neighbour, `link-resolve.test.ts` R10). Sending the
 * project root as the base would make the two attempts identical and hide a real distinction behind
 * an answer that happens to be the same most of the time.
 */

describe('the editor’s link site (FR-022)', () => {
  it('bases a relative path on the open file’s own folder', () => {
    const site = editorLinkSiteFor({
      panelId: 'panel-1',
      filePath: 'D:\\project\\docs\\a.md',
      originProjectId: 'project-1',
    });

    expect(site.baseDirectory).toBe('D:\\project\\docs');
    expect(site.panelId).toBe('panel-1');
    expect(site.originProjectId).toBe('project-1');
  });

  it('handles a forward-slash path the same way', () => {
    expect(
      editorLinkSiteFor({ panelId: 'p', filePath: 'D:/project/docs/a.md' }).baseDirectory,
    ).toBe('D:/project/docs');
  });

  it('an UNTITLED buffer supplies no base directory at all', () => {
    const site = editorLinkSiteFor({ panelId: 'panel-1', filePath: null });

    expect(site.baseDirectory).toBeUndefined();
    expect('baseDirectory' in site, 'absent, not an empty string').toBe(false);
  });

  it('a panel with no owning project names none, so everything is judged outside one (M3)', () => {
    const site = editorLinkSiteFor({ panelId: 'panel-1', filePath: 'D:\\elsewhere\\x.txt' });

    expect('originProjectId' in site).toBe(false);
  });

  it('a file at a drive root still yields a folder rather than nothing', () => {
    expect(editorLinkSiteFor({ panelId: 'p', filePath: 'D:\\x.txt' }).baseDirectory).toBe('D:\\');
  });
});
