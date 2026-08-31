/**
 * REPRO for #273 at the caller — "Open in OS Explorer" acts on the Panel's OWN file.
 *
 * This is the test that fails against the pre-fix code, and it is here rather than in the
 * integration suite because the defect lived in the CALLER: `panel-placeholder.tsx` held the
 * panel's absolute path and threw it away to build a root-relative one, which the main process then
 * resolved against whichever root the main window's explorer last set.
 *
 * Two symptoms, both reachable from a menu item that `panel-header-menu.ts:198` shows and enables
 * whenever the panel has a file path:
 *
 *   1. A Panel torn out of project B into a sub-workspace, while the main window has moved to
 *      project A, asked for B's RELATIVE path — which resolved under A. Wrong file, silently,
 *      whenever the same relative path existed there.
 *   2. A Panel created INSIDE a sub-workspace is ROOTLESS: it can open a file anywhere on the
 *      workstation and has no `ownerRoot`. No relative path could be derived, so the call was
 *      skipped and the menu item did nothing at all.
 *
 * Verified red before the fix: with the old body restored, case 2 asserts a call that never happens
 * and case 1 asserts an ABSOLUTE argument against a relative one.
 *
 * Layer: component (jsdom, no app, no daemon). The subject is a pure function over the bridge, so
 * nothing cheaper is available and nothing more expensive is warranted — what the OS file manager
 * then does with the path is `files-reveal-document.integration.test.ts`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { revealPanelFile } from '../../src/renderer/workspace/reveal-panel-file.js';

let asked: string[] = [];
const bridge = {
  revealDocument: async (absPath: string) => {
    asked.push(absPath);
  },
};

beforeEach(() => {
  asked = [];
});

describe('#273 — revealPanelFile', () => {
  it('a torn-out Panel asks for its own ABSOLUTE path, not one relative to the active project', () => {
    // The panel belongs to project B; the main window is on project A. The old route sent
    // 'notes.md', which A resolved against its own root.
    revealPanelFile('D:\\projects\\b\\notes.md', bridge);

    expect(asked).toEqual(['D:\\projects\\b\\notes.md']);
  });

  it('a ROOTLESS sub-workspace Panel asks for its file, which is under no project', () => {
    // `ownerRoot` is null for such a panel, so the old route derived no relative path and made no
    // call — the menu item was shown, enabled, and silent.
    revealPanelFile('C:\\Users\\someone\\Desktop\\scratch.txt', bridge);

    expect(asked).toEqual(['C:\\Users\\someone\\Desktop\\scratch.txt']);
  });

  it('a POSIX path outside every project is passed through unchanged', () => {
    revealPanelFile('/home/u/notes/scratch.md', bridge);

    expect(asked).toEqual(['/home/u/notes/scratch.md']);
  });

  it('a Panel with no file has nothing to reveal', () => {
    revealPanelFile(null, bridge);
    revealPanelFile(undefined, bridge);
    revealPanelFile('', bridge);

    expect(asked).toEqual([]);
  });

  it('survives a bridge that does not expose the channel', () => {
    expect(() => revealPanelFile('D:\\a\\b.md', undefined)).not.toThrow();
    expect(() => revealPanelFile('D:\\a\\b.md', {})).not.toThrow();
  });
});
