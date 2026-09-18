import { describe, expect, it } from 'vitest';
import { fileLinkMenuItems } from '../../src/links/menu.js';
import type { ResolvedLink } from '../../src/links/types.js';

/**
 * 045 FR-031 (as amended 2026-09-18), FR-013, FR-046 — `contracts/menus-and-gestures.md` §1 and §4.
 *
 * SC-009 asks for "exactly the items FR-030 and FR-031 prescribe, with no extra, missing or wrongly
 * enabled items", so these cases assert the whole run in order rather than probing for one item.
 *
 * The chord case is the amendment's: **Open Link shows its chord only where one is bound.** The
 * terminal caller passes none, because `COMMAND_SCOPES['preview.followLink'].has('terminal')` is
 * false (FR-046), and drawing `Ctrl+Enter` there would advertise a key that in fact reaches the
 * shell.
 */

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: 'C:\\throng\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

const labels = (l: ResolvedLink | null, chord?: string): string[] =>
  fileLinkMenuItems(l, chord).map((i) => i.label);

describe('fileLinkMenuItems — FR-031: the run, in order', () => {
  it('an in-project file with an enabled provider gets all six items', () => {
    expect(labels(link({ preview: 'enabled' }))).toEqual([
      'Open Link',
      'Open in Editor',
      'Open in Preview',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link Address',
    ]);
  });

  it('an item that is absent for the link is not drawn at all', () => {
    expect(labels(link())).toEqual([
      'Open Link',
      'Open in Editor',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link Address',
    ]);
  });

  it('a folder loses the editor, the preview and the default program', () => {
    expect(labels(link({ kind: 'folder' }))).toEqual([
      'Open Link',
      'Open in OS Explorer',
      'Copy Link Address',
    ]);
  });

  it('a file outside the project loses both of throng\u2019s own destinations', () => {
    expect(labels(link({ inProject: false, preview: 'enabled' }))).toEqual([
      'Open Link',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link Address',
    ]);
  });

  it('Open Link and Copy Link Address bracket the run, always', () => {
    for (const l of [link(), link({ kind: 'folder' }), link({ inProject: false })]) {
      const got = labels(l);
      expect(got[0]).toBe('Open Link');
      expect(got[got.length - 1]).toBe('Copy Link Address');
    }
  });
});

describe('fileLinkMenuItems — every item is in the contextual section', () => {
  it('so the run LEADS the menu (Principle VI section 0)', () => {
    for (const item of fileLinkMenuItems(link({ preview: 'enabled' }))) {
      expect(item.section).toBe('contextual');
    }
  });
});

describe('fileLinkMenuItems — disabled is for the preview and nothing else', () => {
  it('a disabled provider draws Open in Preview disabled rather than hiding it', () => {
    const items = fileLinkMenuItems(link({ preview: 'disabled' }));
    const preview = items.find((i) => i.label === 'Open in Preview');
    expect(preview?.disabled).toBe(true);
    for (const item of items) {
      if (item.label !== 'Open in Preview') expect(item.disabled).toBe(false);
    }
  });

  it('an enabled provider draws it enabled', () => {
    const items = fileLinkMenuItems(link({ preview: 'enabled' }));
    expect(items.find((i) => i.label === 'Open in Preview')?.disabled).toBe(false);
  });

  it('an executable is offered every item, and none of them is disabled (FR-039 is not a menu rule)', () => {
    const items = fileLinkMenuItems(link({ executable: true }));
    expect(items.map((i) => i.label)).toContain('Open in OS Default Program');
    expect(items.every((i) => !i.disabled)).toBe(true);
  });
});

describe("fileLinkMenuItems — the chord, only where one is bound (FR-031 as amended, R10b)", () => {
  it('shows the chord on Open Link when the caller passes one', () => {
    const items = fileLinkMenuItems(link(), 'Ctrl+Enter');
    expect(items.find((i) => i.label === 'Open Link')?.shortcut).toBe('Ctrl+Enter');
  });

  it('shows NO chord when the caller passes none — the terminal (FR-046)', () => {
    const items = fileLinkMenuItems(link());
    expect(items.find((i) => i.label === 'Open Link')?.shortcut).toBeUndefined();
  });

  it('never puts the chord on any item but Open Link', () => {
    for (const item of fileLinkMenuItems(link({ preview: 'enabled' }), 'Ctrl+Enter')) {
      if (item.label !== 'Open Link') expect(item.shortcut).toBeUndefined();
    }
  });

  it('an empty chord is the same as no chord, not an empty bracket', () => {
    expect(fileLinkMenuItems(link(), '')[0].shortcut).toBeUndefined();
  });
});

describe('fileLinkMenuItems — FR-013: a link that resolves to nothing contributes NO items', () => {
  it('not six disabled ones', () => {
    expect(fileLinkMenuItems(null)).toEqual([]);
    expect(fileLinkMenuItems(null, 'Ctrl+Enter')).toEqual([]);
  });
});

describe('fileLinkMenuItems — each item names the target it performs', () => {
  it('so a caller routes by id rather than by matching a label', () => {
    const items = fileLinkMenuItems(link({ preview: 'enabled' }));
    expect(items.map((i) => i.id)).toEqual([
      'openLink',
      'editor',
      'preview',
      'osExplorer',
      'osDefaultProgram',
      'copyLinkAddress',
    ]);
  });
});
