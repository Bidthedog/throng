import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';
import { PreviewService } from '../../src/main/preview-service.js';
import { lateListener, liveSettings, manualWatcher, recordingPush, recordingWindows } from './helpers/preview-harness.js';

/**
 * T062 (047 US6, R12) — `resolveWikiTargets`: candidates in order (`+.md`, `+.markdown`, exact), rooted
 * from the run's OWN project (never a root the renderer supplies — Principle I), a sub-workspace run
 * (no project) answers a rooted target `null` (FR-052b), and a call over 500 targets answers the first
 * 500 and leaves the rest `null` (contracts/preview-ipc-047.md §3). Also: following a resolved wiki
 * target through `navigate` is the ordinary `link` path — nothing new there once the renderer has an
 * absolute path (research R12, "everything after resolution is the ordinary link path").
 *
 * BLOCKED on `core`'s `wiki-links.ts` (T059/T060, `wikiCandidates`) — this file is written against the
 * names data-model.md and the contract already give it, per the brief's "write failing tests against
 * the names ... until then". It is expected to fail to even import until core lands that module.
 */

const fs = new NodeFileSystem(async () => {});

const VIEWER = 7;

let root: string;
/** A SECOND project root, for proving resolution follows the RUN's own project, never a fixed one. */
let rootQ: string;
let recoveryDir: string;
let coord: EditorCoordinator;
let previews: PreviewService;

async function file(relPath: string, text = '# x\n', under = root): Promise<string> {
  const path = join(under, relPath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
  return path;
}

async function attach(panelId: string, filePath: string, projectId = 'P') {
  const res = await previews.attach(VIEWER, { panelId, projectId, filePath });
  if (!res.ok) throw new Error(`attach refused: ${res.reason}`);
  return res.update;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'throng-wiki-links-'));
  rootQ = await mkdtemp(join(tmpdir(), 'throng-wiki-links-q-'));
  recoveryDir = await mkdtemp(join(tmpdir(), 'throng-wiki-links-rec-'));
  const relay = lateListener();
  const service = new EditorService(fs, () => liveSettings().current);
  coord = new EditorCoordinator(service, new EditorRecovery(recoveryDir), {
    recoveryDebounceMs: 10_000,
    relaySync: () => {},
    persistUndoHistory: () => false,
    documentLifecycle: relay,
  });
  previews = new PreviewService({
    documents: coord,
    reader: service,
    fs,
    fileWatcher: manualWatcher(),
    settings: liveSettings().get,
    registry: SHIPPED_PREVIEW_PROVIDERS,
    // 'P' and 'Q' are real, DIFFERENT projects; 'SUB' answers undefined — the sub-workspace stand-in
    // (FR-052b). Two real roots let a test prove resolution follows the ATTACHED run's own project.
    projectRoot: async (id) => (id === 'P' ? root : id === 'Q' ? rootQ : undefined),
    push: recordingPush(),
    windows: recordingWindows(),
  });
  relay.bind(previews);
});

afterEach(async () => {
  for (const id of ['v1', 'v2']) previews.destroyed(id);
  for (const dir of [root, rootQ, recoveryDir]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe('resolveWikiTargets (047 US6, R12, contracts/preview-ipc-047.md §3)', () => {
  it('resolves candidates in order: +.md, +.markdown, exact — from the DOCUMENT folder', async () => {
    await mkdir(join(root, 'docs'), { recursive: true });
    const withMd = await file('docs/setup.md');
    await attach('v1', await file('index.md', '[[setup]]\n'));

    const res = await previews.resolveWikiTargets('v1', [{ path: 'docs/setup', rooted: false }]);

    expect(res).toEqual({ resolved: [withMd] });
  });

  it('prefers +.md over +.markdown when both exist, and exact when the target already has an extension', async () => {
    const md = await file('a.md');
    await file('a.markdown');
    await attach('v1', await file('index.md'));

    const res = await previews.resolveWikiTargets('v1', [
      { path: 'a', rooted: false },
      { path: 'a.markdown', rooted: false }, // has its own extension: exact only, never +.md prepended
    ]);

    expect(res.resolved[0]).toBe(md);
    expect(res.resolved[1]).toBe(join(root, 'a.markdown'));
  });

  it('a rooted target resolves from the PROJECT root, not the document folder', async () => {
    const top = await file('top.md');
    await attach('v1', await file('docs/nested.md'));

    const res = await previews.resolveWikiTargets('v1', [{ path: '/top', rooted: true }]);

    expect(res).toEqual({ resolved: [top] });
  });

  it('a target naming no existing file, under any candidate, resolves null', async () => {
    await attach('v1', await file('index.md'));

    const res = await previews.resolveWikiTargets('v1', [{ path: 'nowhere', rooted: false }]);

    expect(res).toEqual({ resolved: [null] });
  });

  it('a ROOTED target in a run with NO project (sub-workspace) resolves null (FR-052b)', async () => {
    await previews.attach(VIEWER, { panelId: 'v2', projectId: 'SUB', filePath: await file('sub/index.md') });

    const res = await previews.resolveWikiTargets('v2', [{ path: '/top', rooted: true }]);

    expect(res).toEqual({ resolved: [null] });
  });

  it("uses the ATTACHED run's own project as root — never a fixed or renderer-named one (Principle I)", async () => {
    // Two runs, attached under DIFFERENT real projects. There is no root anywhere in a
    // `resolveWikiTargets` REQUEST for a renderer to name (the wire shape is `{path, rooted}` only) —
    // this proves the root main actually uses tracks the run it was given, not a fixed default or
    // whatever the FIRST attach happened to establish.
    const topP = await file('top.md', '# P\n', root);
    const topQ = await file('top.md', '# Q\n', rootQ);
    await attach('v1', await file('index.md', '# x\n', root), 'P');
    await attach('v2', await file('index.md', '# x\n', rootQ), 'Q');

    const resP = await previews.resolveWikiTargets('v1', [{ path: '/top', rooted: true }]);
    const resQ = await previews.resolveWikiTargets('v2', [{ path: '/top', rooted: true }]);

    expect(resP).toEqual({ resolved: [topP] });
    expect(resQ).toEqual({ resolved: [topQ] });
    expect(topP).not.toBe(topQ); // two different files, two different roots — not one shared default
  });

  it('caps a call at 500: the first 500 answered, the rest null', async () => {
    await attach('v1', await file('index.md'));
    const targets = Array.from({ length: 520 }, (_, i) => ({ path: `missing-${i}`, rooted: false }));

    const res = await previews.resolveWikiTargets('v1', targets);

    expect(res.resolved).toHaveLength(520);
    expect(res.resolved.slice(500)).toEqual(Array(20).fill(null));
  });

  it('a target OUTSIDE the project is never looked up, and follows as an outside link (FR-054)', async () => {
    // `rootQ` is a sibling of `root`, so `../<rootQ>/secret` climbs out of project P. Main must not
    // answer whether a file exists there (Principle I); the link is an ordinary outside link instead —
    // rendered as a working link, refused with 044 FR-090e's outside notice when followed.
    const outsideDir = rootQ.slice(rootQ.lastIndexOf(rootQ.includes('\\') ? '\\' : '/') + 1);
    await attach('v1', await file('index.md'));

    const { resolved } = await previews.resolveWikiTargets('v1', [{ path: `../${outsideDir}/secret`, rooted: false }]);

    expect(resolved[0]).toBe(join(rootQ, 'secret.md'));
    const nav = await previews.navigate(VIEWER, { panelId: 'v1', target: { absPath: resolved[0]! }, intent: { kind: 'link' } });
    expect(nav).toMatchObject({ kind: 'refused', notice: { kind: 'link-outside' } });
  });

  it('a panelId with no run resolves every target null, never throws', async () => {
    const res = await previews.resolveWikiTargets('no-such-panel', [{ path: 'a', rooted: false }]);
    expect(res).toEqual({ resolved: [null] });
  });
});

describe('following a resolved wiki target is the ordinary link path (R12)', () => {
  it('navigate with the resolved absolute path behaves exactly as an ordinary link follow', async () => {
    await mkdir(join(root, 'docs'), { recursive: true });
    const target = await file('docs/setup.md');
    await attach('v1', await file('index.md'));

    const { resolved } = await previews.resolveWikiTargets('v1', [{ path: 'docs/setup', rooted: false }]);
    expect(resolved[0]).toBe(target);

    const nav = await previews.navigate(VIEWER, {
      panelId: 'v1',
      target: { absPath: resolved[0]! },
      intent: { kind: 'link' },
    });

    expect(nav).toMatchObject({ kind: 'shown', update: { filePath: target } });
  });
});
