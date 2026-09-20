import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  SHIPPED_PREVIEW_PROVIDERS,
  normaliseForCompare,
  previewSettingsDefaults,
  scanLinkLine,
  type EditorLinkSettings,
  type IFileSystem,
  type LinkResolutionRequest,
} from '@throng/core';
import { WindowsPathForms } from '@throng/platform-windows';
import { FileLinkResolver, type FileLinkResolverDeps } from '../../src/main/file-link-resolver.js';
import { linkScanOptions } from '../../src/renderer/links/link-scan-options.js';

/**
 * 045 FR-178a / FR-104 — the user's known-extension edits govern MAIN's grammar too, not only the
 * surfaces'.
 *
 * ══ WHAT THE USER SEES WITHOUT THIS ══
 *
 * They add `xyz` to `editor.links.knownFileExtensions` precisely so that a spaced path ending
 * `.xyz` is one link. A terminal prints `D:\p\my folder\notes.xyz`; the renderer scans it with the
 * resolved set, draws ONE span across the space, and the hover names the whole path. Ctrl+click
 * sends that whole text to main — which re-detects it with the SHIPPED set, does not cross the space,
 * and produces two candidates neither of which spans the text. Nothing matches, so `follow` answers
 * `notFound` naming a file that is sitting on disk, and the Link menu draws every row disabled.
 *
 * So this drives BOTH halves over one line: the renderer's scan (`scanLinkLine` through
 * `linkScanOptions`, exactly as `use-editor.ts` and `use-terminal.ts` compose it) and main's real
 * `FileLinkResolver` over a fake disk. The two must agree about where a link ENDS, in both
 * directions — a list WIDER than the shipped one, and an EMPTY list.
 *
 * ══ ROUND FIVE: THE SETTING INVERTED, AND SO DID ITS EMPTY VALUE ══
 *
 * FR-178a stored the user's edits as a delta, `{ added, removed }`, against the shipped list. The
 * setting is now the ONE list a user edits, seeded with the shipped extensions — so `added: ['xyz']`
 * becomes "the shipped list plus xyz", and the `removed: ['*']` wildcard, which existed only to empty
 * a delta's shipped half, becomes the empty list.
 *
 * The cases below are unchanged in what they assert, and the defect they exist for is unchanged. What
 * is worth carrying forward is that `[]` and `{ added: [], removed: [] }` are OPPOSITES: the old empty
 * delta meant "every shipped extension", the new empty list means "none". A fixture translated from
 * one to the other by shape alone still typechecks and silently stops detecting.
 *
 * `link-setting-live.test.ts` (T248) covers the DRAWING half being live; nothing covered the
 * FOLLOWING half, which is the defect this file exists for.
 */

const ROOT = 'D:\\p';

const DISK = new Map<string, 'file' | 'folder'>(
  [
    ['D:\\p', 'folder'],
    ['D:\\p\\my folder', 'folder'],
    ['D:\\p\\my folder\\notes.xyz', 'file'],
    ['D:\\p\\my folder\\notes.md', 'file'],
  ].map(([p, k]) => [normaliseForCompare(p!), k as 'file' | 'folder']),
);

/** The shipped list, which is what the setting holds until a user edits it. */
const SHIPPED = DEFAULT_APP_SETTINGS.editor.links.knownFileExtensions;

function settingsWith(knownFileExtensions: readonly string[]): EditorLinkSettings {
  return {
    detectInEditors: true,
    detectInTerminals: true,
    existenceCheckTimeoutMs: 2000,
    protocolAllowlist: ['mailto'],
    knownFileExtensions: [...knownFileExtensions],
  };
}

function makeResolver(links: EditorLinkSettings): FileLinkResolver {
  return new FileLinkResolver({
    fs: {
      stat: async (p: string) => {
        const kind = DISK.get(normaliseForCompare(p.replace(/[\\/]+/g, '\\')));
        if (kind === undefined) throw new Error('ENOENT');
        return { kind, isSymlink: false };
      },
    } as unknown as IFileSystem,
    pathForms: new WindowsPathForms(),
    executables: { isExecutable: () => false },
    projectRootFor: () => ROOT,
    previewRegistry: SHIPPED_PREVIEW_PROVIDERS,
    readPreviewSettings: () => previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS),
    readLinkSettings: () => links,
  } as unknown as FileLinkResolverDeps);
}

/** The one span the surfaces draw for `line`, under `links` — the text a Ctrl+click then sends. */
function drawnSpans(line: string, links: EditorLinkSettings): string[] {
  return scanLinkLine(line, linkScanOptions(links)).paths.map((c) => c.text);
}

const request = (text: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  baseDirectory: ROOT,
  panelId: 'terminal-1',
  originProjectId: 'project-1',
});

describe('FR-178a, as round five re-shapes it — a user-added extension is followable, not only drawable', () => {
  it('a list carrying xyz: the span the surfaces draw across a space is the one main opens', async () => {
    const links = settingsWith([...SHIPPED, 'xyz']);
    const line = 'see D:\\p\\my folder\\notes.xyz here';

    const drawn = drawnSpans(line, links);
    expect(drawn, 'the surfaces cross the space because `xyz` ends the scan').toEqual([
      'D:\\p\\my folder\\notes.xyz',
    ]);

    const outcome = await makeResolver(links).follow(request(drawn[0]!));

    expect(outcome, 'main must read the same span, not re-detect with the shipped set').toMatchObject({
      kind: 'openInThrong',
      link: { path: 'D:\\p\\my folder\\notes.xyz', kind: 'file', inProject: true },
    });
  });

  it('a list carrying .XYZ: the Link menu resolves the same span (FR-170a draws no disabled rows)', async () => {
    const links = settingsWith([...SHIPPED, '.XYZ']);

    const resolution = await makeResolver(links).resolve(request('D:\\p\\my folder\\notes.xyz'));

    expect(resolution).toMatchObject({ ok: true, link: { path: 'D:\\p\\my folder\\notes.xyz' } });
  });

  it('without the edit, the SAME text is two spans and main answers notFound — the state before the fix', async () => {
    const links = settingsWith(SHIPPED);
    const line = 'see D:\\p\\my folder\\notes.xyz here';

    expect(drawnSpans(line, links), 'the shipped set stops the path at the space').toEqual([
      'D:\\p\\my',
      'folder\\notes.xyz',
    ]);

    const outcome = await makeResolver(links).follow(request('D:\\p\\my folder\\notes.xyz'));

    expect(outcome).toMatchObject({ kind: 'notFound' });
  });

  it('a shipped extension keeps working alongside an added one', async () => {
    const links = settingsWith([...SHIPPED, 'xyz']);
    const line = 'see D:\\p\\my folder\\notes.md here';

    const drawn = drawnSpans(line, links);
    expect(drawn, 'adding to the list does not displace what was already in it').toEqual(['D:\\p\\my folder\\notes.md']);

    const outcome = await makeResolver(links).follow(request(drawn[0]!));

    expect(outcome).toMatchObject({
      kind: 'openInThrong',
      link: { path: 'D:\\p\\my folder\\notes.md' },
    });
  });

  it('an EMPTY list narrows main the same way it narrows the surfaces', async () => {
    const links = settingsWith([]);
    const line = 'see D:\\p\\my folder\\notes.md here';

    expect(drawnSpans(line, links), 'no extension ends a spaced scan once the list is empty').toEqual([
      'D:\\p\\my',
      'folder\\notes.md',
    ]);

    // The narrow direction is the benign one — main re-detecting a SHORTER text agrees with itself —
    // but it is pinned so a future widening of the fix cannot make main cross a space the surfaces did not.
    const outcome = await makeResolver(links).follow(request('D:\\p\\my folder\\notes.md'));

    expect(outcome, 'a text no surface could have drawn is not quietly re-read as one link').toMatchObject({
      kind: 'notFound',
    });
  });
});
