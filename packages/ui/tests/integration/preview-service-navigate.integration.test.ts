import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_HISTORY,
  SHIPPED_PREVIEW_PROVIDERS,
  canGoBack,
  type EditorOwnerKind,
  type PreviewNavigateRequest,
  type PreviewUpdate,
} from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator, type DocMeta } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService, type PreviewHistoryHooks } from '../../src/main/preview-service.js';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * 044 T092 — `navigate` with a LINK intent, over a real `EditorCoordinator`, a real `EditorService` and
 * a temp tree (FR-090a – FR-090e, FR-025, SC-006; contracts/preview-ipc.md §1 `navigate`).
 *
 * Main decides four things about a followed link and nothing about headings: whether the target is
 * inside the project and exists (else `refused`), whether an enabled provider claims it (else
 * `openedInEditor`), whether another preview already shows it (`focusedOther`), and otherwise rebinds the
 * run in place (`shown`). A fragment is passed through unjudged — the renderer is the one with a
 * rendered document to look for the heading in.
 *
 * The trap on this path is the same as the standalone read path's (Finding 5): showing a file must not
 * OPEN it. Every scenario that shows a file with no editor asserts the coordinator saw nothing.
 */

const fs = new NodeFileSystem(async () => {});

let root: string;
let outside: string;
let recoveryDir: string;
let push: ReturnType<typeof recordingPush>;
let windows: ReturnType<typeof recordingWindows>;
let settings: ReturnType<typeof liveSettings>;
let coord: EditorCoordinator;
let previews: PreviewService;
let history: { calls: Array<[string, ...unknown[]]> } & PreviewHistoryHooks;
/** Runs inside `EditorService.load`, before it reads — after main's `stat` has already said "a file". */
let beforeRead: ((absPath: string) => Promise<void>) | null = null;
/** Every path the preview service asked its reader for — the "file-read spy". */
let reads: string[] = [];
/** A service over the same coordinator, push and reader, with the history hooks a test chooses. */
let build: (hooks: PreviewHistoryHooks) => PreviewService;

const VIEWER = 7;
const OTHER_WINDOW = 9;

let readme: string;
let setup: string;
let app: string;

function meta(panelId: string, absPath: string, ownerKind: EditorOwnerKind = 'project'): DocMeta {
  return {
    panelId,
    windowId: String(VIEWER),
    ownerKind,
    ownerProjectId: 'P',
    ownerRoot: root,
    allProjectRoots: [root],
    tabId: 't1',
    absPath,
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
  };
}

async function openEditor(panelId: string, path: string): Promise<void> {
  const res = await coord.load(meta(panelId, path));
  expect(res.ok).toBe(true);
}

async function attach(panelId: string, filePath: string, viewer = VIEWER): Promise<PreviewUpdate> {
  const res = await previews.attach(viewer, { panelId, projectId: 'P', filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

const link = (panelId: string, absPath: string, fragment?: string, leavingViewState?: unknown) =>
  previews.navigate(VIEWER, {
    panelId,
    target: fragment === undefined ? { absPath } : { absPath, fragment },
    intent: { kind: 'link' },
    ...(leavingViewState !== undefined ? { leavingViewState } : {}),
  });

const updatesFor = (panelId: string) => push.updates.filter((u) => u.update.panelId === panelId).map((u) => u.update);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-preview-navigate-'));
  outside = await mkdtemp(join(tmpdir(), 'throng-preview-navigate-outside-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-preview-navigate-rec-'));
  await mkdir(join(root, 'docs'));
  await mkdir(join(root, 'src'));
  readme = join(root, 'README.md');
  setup = join(root, 'docs', 'setup.md');
  app = join(root, 'src', 'app.ts');
  await writeFile(readme, '# Readme\n\n[Setup](docs/setup.md#install)\n');
  await writeFile(setup, '# Setup\n\n## Install\n\nSteps.\n');
  await writeFile(app, 'export const app = 1;\n');
  await writeFile(join(outside, 'secret.md'), '# Not yours\n');

  push = recordingPush();
  windows = recordingWindows();
  settings = liveSettings();
  const relay = lateListener();
  const service = new EditorService(fs, settings.get);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  const calls: Array<[string, ...unknown[]]> = [];
  history = {
    calls,
    recordJump: (panelId, leaving, arriving) => void calls.push(['recordJump', panelId, leaving, arriving]),
    attach: (panelId, kind, h) => {
      calls.push(['attach', panelId, kind, h]);
      return EMPTY_HISTORY;
    },
    get: () => undefined,
    rewriteCurrent: (panelId, filePath) => void calls.push(['rewriteCurrent', panelId, filePath]),
    purge: (panelId) => void calls.push(['purge', panelId]),
    recordOpen: (panelId, filePath) => void calls.push(['recordOpen', panelId, filePath]),
    moveTo: (panelId, index, filePath) => {
      calls.push(['moveTo', panelId, index, filePath]);
      return false;
    },
    setCurrentViewState: (panelId, viewState) => void calls.push(['setCurrentViewState', panelId, viewState]),
  };
  beforeRead = null;
  reads = [];
  build = (hooks) =>
    new PreviewService({
      documents: coord,
      // The real read path, with a seam a test uses to act between main's `stat` and its read.
      reader: {
        load: async (req) => {
          reads.push(req.absPath);
          await beforeRead?.(req.absPath);
          return service.load(req);
        },
      },
      fs,
      fileWatcher: manualWatcher(),
      settings: settings.get,
      registry: SHIPPED_PREVIEW_PROVIDERS,
      projectRoot: async (id) => (id === 'P' ? root : undefined),
      push,
      windows,
      history: hooks,
    });
  previews = build(history);
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['v1', 'v2']) previews.destroyed(id);
  for (const dir of [root, outside, recoveryDir]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('shown — the run is rebound to the target, in place (FR-090a)', () => {
  /*
   * 044 T177 (FR-024) — a navigation counts. Every update carries the run's navigation count, and only a
   * navigation moves it: that is how the renderer tells a followed link from a re-point (a rename, a move,
   * a Save As), which shows the same document under a new path and must keep the reader's place.
   */
  it('a link navigation raises the run’s navigation count; an ordinary update leaves it', async () => {
    const attached = await attach('v1', readme);
    expect(attached.navigationSeq).toBe(0);

    const res = await link('v1', setup);
    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(res.update.navigationSeq).toBe(1);

    const refreshed = await previews.refresh('v1');
    expect(refreshed.update?.navigationSeq ?? attached.navigationSeq).toBe(1);
  });

  it('shows the target from the disk, re-keys the open path and broadcasts pathChanged', async () => {
    await attach('v1', readme);
    push.clear();

    const res = await link('v1', setup);

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(res.update).toMatchObject({
      panelId: 'v1',
      filePath: setup,
      providerId: 'markdown',
      content: { kind: 'text', text: '# Setup\n\n## Install\n\nSteps.\n' },
      parent: null,
      dirty: false,
      notice: null,
    });
    expect(previews.run('v1')?.filePath).toBe(setup);
    expect(previews.isOpen(setup)).toBe(true);
    expect(previews.isOpen(readme)).toBe(false);
    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: setup }]);
    // Every viewer, the invoking window included, gets the same revision.
    expect(updatesFor('v1').at(-1)).toEqual(res.update);
  });

  it('a preview parented to README stops being parented, and the target’s own editor parents it', async () => {
    await openEditor('ed-readme', readme);
    const first = await attach('v1', readme);
    expect(first.parent).toMatchObject({ panelId: 'ed-readme' });

    const toSetup = await link('v1', setup);
    expect(toSetup.kind === 'shown' && toSetup.update.parent).toBeNull();

    await writeFile(join(root, 'docs', 'install.md'), '# Install\n');
    await openEditor('ed-install', join(root, 'docs', 'install.md'));
    const toInstall = await link('v1', join(root, 'docs', 'install.md'));
    expect(toInstall.kind).toBe('shown');
    if (toInstall.kind !== 'shown') return;
    expect(toInstall.update.parent).toMatchObject({ panelId: 'ed-install' });
    expect(toInstall.update.content).toEqual({ kind: 'text', text: '# Install\n' });
  });

  it('passes the fragment back untouched — even one that names no heading, which is still shown (FR-090b, FR-090e)', async () => {
    await attach('v1', readme);

    const named = await link('v1', setup, 'install');
    expect(named).toMatchObject({ kind: 'shown', fragment: 'install' });

    const missing = await link('v1', readme, 'there-is-no-such-heading');
    expect(missing).toMatchObject({ kind: 'shown', fragment: 'there-is-no-such-heading' });
    expect(previews.run('v1')?.filePath).toBe(readme);
  });

  it('stores the leaving view state on the entry being left, then records the open', async () => {
    await attach('v1', readme);
    history.calls.length = 0;

    await link('v1', setup, undefined, { line: 4, offsetRatio: 0.5 });

    expect(history.calls).toEqual([
      ['setCurrentViewState', 'v1', { line: 4, offsetRatio: 0.5 }],
      ['recordOpen', 'v1', setup],
    ]);
  });

  it('a link to the file the run already shows moves nothing and records nothing', async () => {
    await attach('v1', readme);
    history.calls.length = 0;
    push.clear();

    const res = await link('v1', readme, 'readme');

    expect(res).toMatchObject({ kind: 'shown', fragment: 'readme' });
    expect(push.pathChanged).toEqual([]);
    // Not a jump either (FR-115): only a `heading` intent, sent after the renderer found and scrolled, is one.
    expect(history.calls.filter(([name]) => name === 'recordOpen' || name === 'recordJump')).toEqual([]);
  });

  it('following a link to a file NOT open in any editor opens no document (FR-025, SC-006)', async () => {
    await openEditor('ed-readme', readme);
    await attach('v1', readme);
    const listBefore = coord.list();

    await link('v1', setup);

    expect(coord.list()).toEqual(listBefore);
    expect(coord.isOpen(setup)).toBe(false);
    expect(coord.documentFor(setup)).toBeNull();
    // And the file it left keeps its one document, untouched.
    expect(coord.documentFor(readme)).toMatchObject({ panelId: 'ed-readme' });
  });
});

describe('focusedOther — another preview already shows the target (FR-090c)', () => {
  it('focuses that preview’s window with the link’s fragment and leaves this preview unchanged', async () => {
    await attach('v1', readme);
    await attach('v2', setup, OTHER_WINDOW);
    push.clear();
    history.calls.length = 0;

    const res = await link('v1', setup, 'install');

    expect(res).toEqual({ kind: 'focusedOther', panelId: 'v2' });
    expect(windows.raised).toContain(OTHER_WINDOW);
    expect(push.focus).toEqual([{ to: OTHER_WINDOW, payload: { panelId: 'v2', fragment: 'install' } }]);
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(push.updates).toEqual([]);
    expect(push.pathChanged).toEqual([]);
    expect(history.calls).toEqual([]);
  });

  it('sends no fragment when the link has none', async () => {
    await attach('v1', readme);
    await attach('v2', setup, OTHER_WINDOW);
    push.clear();
    await link('v1', setup);
    expect(push.focus).toEqual([{ to: OTHER_WINDOW, payload: { panelId: 'v2' } }]);
  });
});

describe('openedInEditor — no enabled provider claims the target (FR-090d)', () => {
  it('for a file no provider claims', async () => {
    await attach('v1', readme);
    push.clear();
    expect(await link('v1', app, 'main')).toEqual({ kind: 'openedInEditor' });
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(push.updates).toEqual([]);
    expect(coord.isOpen(app)).toBe(false);
  });

  it('for a Markdown file while the Markdown provider is turned off', async () => {
    await attach('v1', readme);
    settings.current.editor.previews.providers.markdown.enabled = false;
    expect(await link('v1', setup)).toEqual({ kind: 'openedInEditor' });
    expect(previews.run('v1')?.filePath).toBe(readme);
  });
});

describe('refused — the preview stays, and no file is created (FR-090e)', () => {
  it('link-missing-file for a target that does not exist', async () => {
    await attach('v1', readme);
    push.clear();
    const missing = join(root, 'docs', 'missing.md');

    expect(await link('v1', missing)).toEqual({
      kind: 'refused',
      notice: { kind: 'link-missing-file', target: missing },
    });
    expect(existsSync(missing)).toBe(false);
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(push.updates).toEqual([]);
    expect(push.pathChanged).toEqual([]);
  });

  it('link-missing-file for a missing file no provider claims either — existence is decided first', async () => {
    await attach('v1', readme);
    const missing = join(root, 'src', 'missing.ts');
    expect(await link('v1', missing)).toMatchObject({ kind: 'refused', notice: { kind: 'link-missing-file' } });
    expect(existsSync(missing)).toBe(false);
  });

  it('link-missing-file for a folder', async () => {
    await attach('v1', readme);
    expect(await link('v1', join(root, 'docs'))).toMatchObject({ kind: 'refused', notice: { kind: 'link-missing-file' } });
  });

  it('link-outside for an existing file outside the project, whatever the renderer said (Principle I)', async () => {
    await attach('v1', readme);
    const secret = join(outside, 'secret.md');
    expect(await link('v1', secret)).toEqual({ kind: 'refused', notice: { kind: 'link-outside', target: secret } });
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(previews.isOpen(secret)).toBe(false);
  });

  it('link-outside for a missing file outside the project — nothing is created there either', async () => {
    await attach('v1', readme);
    const ghost = join(outside, 'ghost.md');
    expect(await link('v1', ghost)).toMatchObject({ kind: 'refused', notice: { kind: 'link-outside' } });
    expect(existsSync(ghost)).toBe(false);
  });

  it('a navigate for a panel with no run is refused', async () => {
    expect(await link('nobody', setup)).toMatchObject({ kind: 'refused' });
  });
});

/** A directory link from `link` to `target`: a symlink where permitted, else a junction (no elevation). */
async function linkDirectory(target: string, link: string): Promise<boolean> {
  for (const type of ['dir', 'junction'] as const) {
    try {
      await symlink(target, link, type);
      return true;
    } catch (error) {
      if (type === 'dir' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
  }
  return false;
}

describe('fix round 1 — real-path containment on the link path (Principle I, FR-090e)', () => {
  it('refuses a link inside the project by SPELLING whose real path is outside it', async (ctx) => {
    const linked = join(root, 'linked');
    if (!(await linkDirectory(outside, linked))) ctx.skip();
    await attach('v1', readme);
    push.clear();
    history.calls.length = 0;
    const secret = join(linked, 'secret.md');

    expect(await link('v1', secret)).toEqual({ kind: 'refused', notice: { kind: 'link-outside', target: secret } });
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(previews.isOpen(secret)).toBe(false);
    expect(push.pathChanged).toEqual([]);
    expect(push.updates).toEqual([]);
    expect(history.calls).toEqual([]);
  });
});

describe('fix round 1 — a target that cannot be read never shows the previous document under its path', () => {
  /*
   * FR-090a binds the preview to the target once the link is followed, and FR-026 says a file that is too
   * large, not text or unreadable is shown as ONE notice. So main shows the target — its content
   * explicitly cleared, never "unchanged" — with that notice. A target gone between `stat` and the read
   * does not exist, which is FR-090e: refused, and the preview stays where it was.
   */
  it('too large → shown, with content cleared (not null, not README) and the too-large notice', async () => {
    const big = join(root, 'docs', 'big.md');
    await writeFile(big, `# Big\n\n${'x'.repeat(4096)}\n`);
    await attach('v1', readme);
    settings.current.editor.maxOpenFileBytes = 1024;

    const res = await link('v1', big);

    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    expect(res.update.filePath).toBe(big);
    expect(res.update.content).not.toBeNull();
    expect(res.update.content).toEqual({ kind: 'text', text: '' });
    expect(res.update.notice).toEqual({ kind: 'too-large' });
    for (const { update } of push.updates.filter((u) => u.update.panelId === 'v1' && u.update.filePath === big)) {
      expect(update.content).not.toBeNull();
    }
  });

  it('not text → shown, content cleared, not-text notice', async () => {
    const bin = join(root, 'docs', 'bin.md');
    await writeFile(bin, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00, 0x00, 0x10]));
    await attach('v1', readme);

    const res = await link('v1', bin);
    expect(res).toMatchObject({ kind: 'shown', update: { filePath: bin, content: { kind: 'text', text: '' }, notice: { kind: 'not-text' } } });
  });

  it('deleted between stat and read → refused link-missing-file; the preview stays on README', async () => {
    await attach('v1', readme);
    push.clear();
    history.calls.length = 0;
    beforeRead = async (absPath) => {
      if (absPath === setup) await unlink(setup);
    };

    expect(await link('v1', setup)).toEqual({ kind: 'refused', notice: { kind: 'link-missing-file', target: setup } });
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(previews.isOpen(setup)).toBe(false);
    expect(push.pathChanged).toEqual([]);
    expect(push.updates).toEqual([]);
    expect(history.calls.filter(([name]) => name === 'recordOpen')).toEqual([]);
    expect(existsSync(setup)).toBe(false);
  });

  it('two links followed within one read: no update ever pairs a path with stale content, and the second wins', async () => {
    const install = join(root, 'docs', 'install.md');
    await writeFile(install, '# Install\n');
    await attach('v1', readme);
    push.clear();
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstReading!: () => void;
    const reached = new Promise<void>((resolve) => {
      firstReading = resolve;
    });
    beforeRead = async (absPath) => {
      if (absPath !== setup) return;
      firstReading();
      await firstHeld;
    };

    const first = link('v1', setup);
    // The first navigate is INSIDE its read — past every check — before the second starts.
    await reached;
    const second = await link('v1', install);
    releaseFirst();
    const firstRes = await first;

    expect(second).toMatchObject({ kind: 'shown', update: { filePath: install, content: { kind: 'text', text: '# Install\n' } } });
    expect(previews.run('v1')?.filePath).toBe(install);
    for (const { update } of push.updates.filter((u) => u.update.panelId === 'v1')) {
      expect(update.content, `revision ${update.revision} for ${update.filePath}`).not.toBeNull();
    }
    // The overtaken navigate hands back nothing a renderer would apply over the second.
    expect(second.kind).toBe('shown');
    expect(firstRes.kind).toBe('shown');
    if (firstRes.kind !== 'shown' || second.kind !== 'shown') return;
    // The run as it stands — the SECOND target — at a revision the renderer has already applied, with no
    // fragment: the renderer recognises it as overtaken by its path, which is not the link's (round 2).
    expect(firstRes.update.revision).toBeLessThanOrEqual(second.update.revision);
    expect(firstRes.update.filePath).toBe(install);
    expect(firstRes).not.toHaveProperty('fragment');
  });
});

/*
 * 044 T191 (2) — FR-115: a same-document heading is a history entry in a PREVIEW, and a step between two
 * places in the file the run already shows is only a change of place (contracts/preview-ipc.md §1
 * `navigate`, `intent: 'heading'` and the same-file history bullet; navigation-history.md §3 and §8).
 * Over the REAL NavigationHistoryService, so what is asserted is the record the windows mirror.
 */
describe('heading intent and same-file history steps (FR-115)', () => {
  const TOP = { line: 0, offsetRatio: 0 };
  const AT_4 = { line: 4, offsetRatio: 0 };
  const AT_8 = { line: 8, offsetRatio: 0.25 };
  let real: NavigationHistoryService;

  beforeEach(() => {
    real = new NavigationHistoryService({ cap: () => 10, broadcastChanged: () => {} });
    previews = build(real);
  });

  const heading = (panelId: string, absPath: string, fragment: string, leaving: unknown, arriving: unknown) =>
    previews.navigate(VIEWER, {
      panelId,
      target: { absPath, fragment },
      intent: { kind: 'heading' },
      leavingViewState: leaving,
      arrivingViewState: arriving,
    } as PreviewNavigateRequest);

  const step = (panelId: string, absPath: string, index: number, leavingViewState?: unknown) =>
    previews.navigate(VIEWER, {
      panelId,
      target: { absPath },
      intent: { kind: 'history', index },
      ...(leavingViewState !== undefined ? { leavingViewState } : {}),
    });

  it('for the run’s current file: records the jump, reads nothing, and answers shown with the UNCHANGED snapshot', async () => {
    const attached = await attach('v1', readme);
    push.clear();
    reads.length = 0;

    const res = await heading('v1', readme, 'readme', TOP, AT_4);

    expect(real.get('v1')).toEqual({
      entries: [{ filePath: readme, viewState: TOP }, { filePath: readme, viewState: AT_4 }],
      index: 1,
    });
    expect(reads).toEqual([]);
    expect(res.kind).toBe('shown');
    if (res.kind !== 'shown') return;
    // Same revision, no place and no fragment: the renderer's revision check drops it, and the reader stays
    // where the jump put them.
    expect(res.update.revision).toBe(attached.revision);
    expect(res.update.filePath).toBe(readme);
    expect(res.update).not.toHaveProperty('viewState');
    expect(res).not.toHaveProperty('fragment');
    expect(push.updates).toEqual([]);
    expect(push.pathChanged).toEqual([]);
  });

  it('for a spelling of the current file that differs only in case and separators, still records it (samePath)', async () => {
    await attach('v1', readme);
    await heading('v1', readme.toUpperCase().replace(/\\/g, '/'), 'readme', TOP, AT_4);
    expect(real.get('v1')!.entries).toHaveLength(2);
  });

  it('naming ANOTHER file (overtaken): records nothing, reads nothing, and answers the unchanged snapshot', async () => {
    const attached = await attach('v1', readme);
    const before = real.get('v1');
    push.clear();
    reads.length = 0;

    const res = await heading('v1', setup, 'install', TOP, AT_4);

    expect(real.get('v1')).toBe(before);
    expect(reads).toEqual([]);
    expect(previews.run('v1')?.filePath).toBe(readme);
    expect(res).toEqual({ kind: 'shown', update: expect.objectContaining({ filePath: readme, revision: attached.revision }) });
    expect(res).not.toHaveProperty('fragment');
    expect(push.updates).toEqual([]);
    expect(push.pathChanged).toEqual([]);
  });

  it('an equal jump (arriving where the reader already is) adds no entry and is still shown', async () => {
    await attach('v1', readme);
    const res = await heading('v1', readme, 'readme', AT_4, AT_4);
    expect(res.kind).toBe('shown');
    expect(real.get('v1')).toEqual({ entries: [{ filePath: readme, viewState: AT_4 }], index: 0 });
  });

  it('a history step onto an entry of the run’s current file moves the place to EVERY viewer — no re-read, no pathChanged', async () => {
    await attach('v1', readme);
    // A heading emits nothing, so the revision the second window attached at is still the run's.
    const { revision } = await attach('v1', readme, OTHER_WINDOW);
    await heading('v1', readme, 'readme', TOP, AT_4);
    push.clear();
    reads.length = 0;

    const back = await step('v1', readme, 0, AT_8);

    expect(real.get('v1')).toEqual({
      entries: [{ filePath: readme, viewState: TOP }, { filePath: readme, viewState: AT_8 }],
      index: 0,
    });
    expect(reads).toEqual([]);
    expect(push.pathChanged).toEqual([]);
    expect(back.kind).toBe('shown');
    if (back.kind !== 'shown') return;
    expect(back.update).toMatchObject({ filePath: readme, revision: revision + 1, viewState: TOP, content: null });
    expect(push.updates.map((u) => u.to).sort()).toEqual([VIEWER, OTHER_WINDOW].sort());
    for (const { update } of push.updates) expect(update).toEqual(back.update);

    // Forward returns to the place the reader left, which Back stored on that entry.
    const forward = await step('v1', readme, 1);
    expect(forward).toMatchObject({ kind: 'shown', update: { viewState: AT_8, content: null } });
    expect(real.get('v1')!.index).toBe(1);
    expect(reads).toEqual([]);
  });

  /*
   * ══ T219 — A BACK PRESS THAT IS ENABLED, ACCEPTED, AND CHANGES NOTHING ══
   *
   * FR-115's fourth sentence is unconditional, and it was enforced only inside `recordJump`. These two
   * cases are the routes that reach `setCurrentViewState` WITHOUT one, and they exist here rather than
   * only at the unit layer because the defect is in the SEQUENCE — which reducer this service calls,
   * with what, and in what order. `navigation-history.test.ts` can compose the reducers by hand and
   * prove the composition is sound; it cannot show that these are the calls `PreviewService` makes.
   *
   * Both were observed failing against `recordCurrentPlace` reduced to a bare `setCurrentViewState`:
   * the list came out with the duplicate pair, and Back stayed enabled on an entry showing the same
   * file at the same place.
   */
  it('T219 — a link followed after scrolling back to an earlier jump’s place leaves no dead Back', async () => {
    await attach('v1', readme);
    // Ctrl+click a contents link: `[readme@TOP, readme@AT_4]`, the reader now at AT_4.
    await heading('v1', readme, 'install', TOP, AT_4);
    // …then scroll back to the top by hand and follow a link to another file.
    await link('v1', setup, undefined, TOP);

    // The entry the reader was on became the entry before it, so it is not recorded twice.
    expect(real.get('v1')).toEqual({
      entries: [{ filePath: readme, viewState: TOP }, { filePath: setup }],
      index: 1,
    });

    // ONE Back, and it shows a different file. Before the fix this took two, and the second was dead.
    const back = await step('v1', readme, 0, TOP);
    expect(back).toMatchObject({ kind: 'shown', update: { filePath: readme, viewState: TOP } });
    expect(real.get('v1')!.index).toBe(0);
    expect(canGoBack(real.get('v1')!)).toBe(false);
  });

  it('T219 — the detaching view’s report alone (a tab switch) is enough, with no navigate at all', async () => {
    await attach('v1', readme);
    await heading('v1', readme, 'install', TOP, AT_4);

    /*
     * The third route, and the cheapest one for a reader to hit: `preview-panel.tsx`'s detaching-view
     * effect sends `throng:history:setViewState`, whose handler calls exactly this. No link, no step,
     * nothing else — switching to another tab is the whole of the user's action.
     */
    real.setCurrentViewState('v1', TOP);

    expect(real.get('v1')).toEqual({ entries: [{ filePath: readme, viewState: TOP }], index: 0 });
    // The button is disabled rather than lying: there is nowhere the press could take the reader.
    expect(canGoBack(real.get('v1')!)).toBe(false);
  });

  it('Back past the first jump in a document takes the ordinary cross-file path to the previous document (US7 scenario 7)', async () => {
    await attach('v1', readme);
    await link('v1', setup, undefined, AT_8);
    await heading('v1', setup, 'install', TOP, AT_4);
    await step('v1', setup, 1);
    reads.length = 0;
    push.pathChanged.length = 0;

    const toReadme = await step('v1', readme, 0, TOP);

    expect(toReadme).toMatchObject({ kind: 'shown', update: { filePath: readme, viewState: AT_8 } });
    expect(reads).toEqual([readme]);
    expect(push.pathChanged).toEqual([{ panelId: 'v1', filePath: readme }]);
    expect(real.get('v1')!.index).toBe(0);
  });

  /*
   * ══ 044 T233 — A HISTORY STEP ALWAYS NAMES ITS PLACE, EVEN WHEN THERE IS NONE (FR-121e) ══
   *
   * contracts/preview-ipc.md §2 `update.viewState`, research R32. A step onto an entry with no saved place
   * used to arrive exactly like a followed link — no `viewState`, `navigationSeq` moved — and FR-121e
   * (the editor's line) and FR-121f (the preview's start drives the editor) want opposite outcomes for the
   * two. So on a `history` navigate main sends the target's place or `null`, to the answer AND to every
   * viewer: a panel shown in two windows learns of the step only as a push. The KEY is the fact, so the
   * present cases assert `'viewState' in update` as well as the value, and the absent cases assert
   * `not.toHaveProperty` rather than an `undefined` value.
   */
  describe('T233 — the wire half of FR-121e', () => {
    it('a cross-file step onto an entry with no place answers, and pushes to every viewer, viewState: null', async () => {
      await attach('v1', readme);
      await attach('v1', readme, OTHER_WINDOW);
      // `[readme (no place), setup]` — nothing stored the reader's place in README.
      await link('v1', setup);
      expect(real.get('v1')!.entries[0]).toEqual({ filePath: readme });
      push.clear();

      const back = await step('v1', readme, 0);

      expect(back.kind).toBe('shown');
      if (back.kind !== 'shown') return;
      expect(back.update.filePath).toBe(readme);
      expect('viewState' in back.update).toBe(true);
      expect(back.update.viewState).toBeNull();
      const pushed = updatesFor('v1');
      expect(push.updates.map((u) => u.to).sort()).toEqual([VIEWER, OTHER_WINDOW].sort());
      for (const update of pushed) {
        expect('viewState' in update).toBe(true);
        expect(update.viewState).toBeNull();
      }
    });

    it('a same-file step onto an entry with no place answers, and pushes to every viewer, viewState: null', async () => {
      await attach('v1', readme);
      await attach('v1', readme, OTHER_WINDOW);
      // A jump with no leaving place: `[readme (no place), readme@AT_4]`.
      await heading('v1', readme, 'readme', undefined, AT_4);
      expect(real.get('v1')!.entries).toEqual([{ filePath: readme }, { filePath: readme, viewState: AT_4 }]);
      push.clear();

      const back = await step('v1', readme, 0);

      expect(back.kind).toBe('shown');
      if (back.kind !== 'shown') return;
      expect(back.update).toMatchObject({ filePath: readme, content: null });
      expect('viewState' in back.update).toBe(true);
      expect(back.update.viewState).toBeNull();
      expect(push.updates.map((u) => u.to).sort()).toEqual([VIEWER, OTHER_WINDOW].sort());
      for (const { update } of push.updates) expect(update).toEqual(back.update);
    });

    it('a step onto an entry WITH a place still sends that place, unchanged', async () => {
      await attach('v1', readme);
      await link('v1', setup, undefined, AT_8);
      push.clear();

      const back = await step('v1', readme, 0);

      expect(back).toMatchObject({ kind: 'shown', update: { filePath: readme, viewState: AT_8 } });
      for (const update of updatesFor('v1')) expect(update.viewState).toEqual(AT_8);
    });

    it('a followed link’s update carries NO viewState key — answer or push', async () => {
      await attach('v1', readme);
      push.clear();

      const res = await link('v1', setup);

      expect(res.kind).toBe('shown');
      if (res.kind !== 'shown') return;
      expect(res.update).not.toHaveProperty('viewState');
      expect(updatesFor('v1').length).toBeGreaterThan(0);
      for (const update of updatesFor('v1')) expect(update).not.toHaveProperty('viewState');
    });

    it('a stale history intent’s unchanged snapshot carries no viewState key', async () => {
      await attach('v1', readme);
      await link('v1', setup);
      push.clear();

      // Index 0 names README, not app.ts: the renderer read a history that has since changed.
      const res = await step('v1', app, 0);

      expect(res.kind).toBe('shown');
      if (res.kind !== 'shown') return;
      expect(res.update.filePath).toBe(setup);
      expect(res.update).not.toHaveProperty('viewState');
      expect(push.updates).toEqual([]);
    });

    it('an attach onto an entry with no place carries no viewState key', async () => {
      const attached = await attach('v1', readme);
      expect(attached).not.toHaveProperty('viewState');
    });
  });

  /*
   * Analyze item — "a heading link clicked while the preview is still redrawing records no entry". Main's
   * half: a heading intent is judged against the run's current file AS IT STANDS, not against whether a
   * navigate is in flight, so main records it whenever it arrives. What decides whether one is sent is the
   * renderer's (its deferred scroll, `pendingFragment` → `onDrawn`), which is U3b's.
   */
  it('a heading intent that arrives while a link of the same run is still reading is recorded against the current file', async () => {
    await attach('v1', readme);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading!: () => void;
    const reached = new Promise<void>((resolve) => {
      reading = resolve;
    });
    beforeRead = async (absPath) => {
      if (absPath !== setup) return;
      reading();
      await held;
    };

    const toSetup = link('v1', setup);
    await reached;
    const jump = await heading('v1', readme, 'readme', TOP, AT_4);
    release();
    await toSetup;

    expect(jump).toMatchObject({ kind: 'shown', update: { filePath: readme } });
    expect(real.get('v1')!.entries.map((e) => [e.filePath, e.viewState])).toEqual([
      [readme, TOP],
      [readme, AT_4],
      [setup, undefined],
    ]);
  });
});
