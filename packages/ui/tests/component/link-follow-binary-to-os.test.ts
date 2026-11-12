/**
 * 067 T137 (FR-131, extending FR-116/FR-117) — Ctrl+click on a link to a file throng cannot open (binary)
 * opens it as a File Explorer double-click does: in the OS default program, with the preference
 * `explorer.openUnsupportedInOs` on. Off, the editor's own "cannot open" message stands. A file outside
 * every project, and one whose default open action is its preview, keep today's behaviour.
 *
 * `followLink` is the one route the editor's and the terminal's Ctrl+click share, so it is driven here
 * with the performers injected, exactly as both surfaces build them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolutionRequest, OpenDecision, ResolvedLink } from '@throng/core';
import { followLink, type LinkFollowDeps } from '../../src/renderer/links/link-actions.js';
import { refusedAsBinaryToOs } from '../../src/renderer/links/open-unsupported-in-os.js';

const ROOT = '/p';
const BIN = `${ROOT}/img/logo.png`;
const TS = `${ROOT}/src/a.ts`;
const MD = `${ROOT}/docs/a.md`;

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: BIN,
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

const request = (text: string): LinkResolutionRequest => ({
  text,
  kind: 'detectedPath',
  baseDirectory: ROOT,
  panelId: 'panel-1',
  originProjectId: 'project-1',
});

let mainLink: ResolvedLink;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  mainLink = link();
  Reflect.set(window, 'throng', {
    links: {
      follow: () =>
        Promise.resolve(
          mainLink.kind === 'file' && mainLink.inProject
            ? { kind: 'openInThrong' as const, link: mainLink }
            : { kind: 'revealed' as const },
        ),
      reveal: () => Promise.resolve({ ok: true as const }),
      open: (r: LinkResolutionRequest) => {
        calls.push(`os:${r.text}`);
        return Promise.resolve({ ok: true as const });
      },
    },
  });
});

function deps(over: Partial<LinkFollowDeps> = {}): LinkFollowDeps {
  return {
    openInEditor: (l, position) => void calls.push(position ? `editor@${position.line}:${l.path}` : `editor:${l.path}`),
    openInPreview: (l) => void calls.push(`preview:${l.path}`),
    reportFailure: (o) => void calls.push(`failure:${o.reason}`),
    ...over,
  };
}

describe('followLink sends a binary in-project file to the OS (FR-131)', () => {
  it('on: the OS default program gets the request; the editor is not opened', async () => {
    await followLink({ request: request('img/logo.png'), deps: deps({ opensInOs: () => true }) });
    expect(calls).toEqual(['os:img/logo.png']);
  });

  it('on, with a position in the link: still the OS (the editor would have refused the file)', async () => {
    await followLink({
      request: request('img/logo.png'),
      position: { line: 3 },
      deps: deps({ opensInOs: () => true }),
    });
    expect(calls).toEqual(['os:img/logo.png']);
  });

  it('the OS’s own refusal raises the one notice', async () => {
    Reflect.set(window, 'throng', {
      links: {
        follow: () => Promise.resolve({ kind: 'openInThrong' as const, link: mainLink }),
        open: () => Promise.resolve({ ok: false as const, reason: 'refused' as const, path: BIN, osReason: 'no program' }),
      },
    });
    await followLink({ request: request('img/logo.png'), deps: deps({ opensInOs: () => true }) });
    expect(calls).toEqual(['failure:refused']);
  });

  it('off (or a file the editor can open): today’s behaviour, the editor', async () => {
    const asks = vi.fn(() => false);
    await followLink({ request: request('img/logo.png'), deps: deps({ opensInOs: asks }) });
    expect(calls).toEqual([`editor:${BIN}`]);
    expect(asks).toHaveBeenCalledTimes(1);
  });

  it('no reader supplied: today’s behaviour', async () => {
    await followLink({ request: request('img/logo.png'), deps: deps() });
    expect(calls).toEqual([`editor:${BIN}`]);
  });

  it('a file outside every project keeps today’s route (main reveals it) and is never asked about', async () => {
    mainLink = link({ path: '/elsewhere/logo.png', inProject: false });
    const asks = vi.fn(() => true);
    await followLink({ request: request('/elsewhere/logo.png'), deps: deps({ opensInOs: asks }) });
    expect(calls).toEqual([]);
    expect(asks).not.toHaveBeenCalled();
  });

  it('a file whose default open action is its preview keeps today’s behaviour and is never asked about', async () => {
    mainLink = link({ path: MD, preview: 'enabled' });
    const asks = vi.fn(() => true);
    await followLink({
      request: request('docs/a.md'),
      deps: deps({ opensInOs: asks, previewIsDefault: () => true }),
    });
    expect(calls).toEqual([`preview:${MD}`]);
    expect(asks).not.toHaveBeenCalled();
  });

  it('the same file with a position stays in the editor under a preview default, as FR-052 has it', async () => {
    mainLink = link({ path: MD, preview: 'enabled' });
    const asks = vi.fn(() => true);
    await followLink({
      request: request('docs/a.md'),
      position: { line: 4 },
      deps: deps({ opensInOs: asks, previewIsDefault: () => true }),
    });
    expect(calls).toEqual([`editor@4:${MD}`]);
    expect(asks).not.toHaveBeenCalled();
  });
});

describe('refusedAsBinaryToOs (the reader both surfaces build)', () => {
  function bridge(decision: OpenDecision | undefined) {
    const openInto = vi.fn(() => Promise.resolve(decision));
    Reflect.set(window, 'throng', { editor: { openInto } });
    return openInto;
  }
  const ws = { layout: { projectId: 'project-1' } } as never;
  const reader = (enabled: boolean, ownerProjectId?: string) =>
    refusedAsBinaryToOs(() => ({ enabled, ws, ...(ownerProjectId ? { ownerProjectId } : {}) }));

  it('is true for a file main refuses as binary, with the preference on', async () => {
    const openInto = bridge({ action: 'refuse', reason: 'binary' });
    expect(await reader(true, 'project-2')(link())).toBe(true);
    expect(openInto).toHaveBeenCalledWith({ absPath: BIN, ownerKind: 'project', ownerProjectId: 'project-2' });
  });

  it('is false with the preference off, and does not even ask main', async () => {
    const openInto = bridge({ action: 'refuse', reason: 'binary' });
    expect(await reader(false)(link())).toBe(false);
    expect(openInto).not.toHaveBeenCalled();
  });

  it('is false for a file the editor can open, one open already, a too-large one, and no bridge', async () => {
    for (const decision of [
      { action: 'open' },
      { action: 'focus', panelId: 'p', windowId: 'w' },
      { action: 'refuse', reason: 'tooLarge' },
    ] as unknown as OpenDecision[]) {
      bridge(decision);
      expect(await reader(true)(link({ path: TS }))).toBe(false);
    }
    Reflect.set(window, 'throng', {});
    expect(await reader(true)(link())).toBe(false);
  });
});
