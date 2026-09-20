import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolutionRequest, LinkTarget, ResolvedLink } from '@throng/core';
import {
  followLink,
  performLinkTarget,
  type LinkActionDeps,
  type LinkFollowDeps,
} from '../../src/renderer/links/link-actions.js';

/**
 * 045 FR-054, FR-055 — the ONE router both surfaces call.
 *
 * ══ WHY A ROUTER AT ALL ══
 *
 * FR-054 requires Open Link, Ctrl+click and the Open Link chord to do the same thing for the same
 * link, in both panel types. That is six call sites. Six call sites that each pick a destination
 * are six chances for one of them to send an out-of-project file to an editor, which is FR-055 —
 * the requirement with the sharpest consequence in the feature, because the user never sees a
 * refusal, only a file that should not have opened.
 *
 * So the routing is one function, the guard lives inside it, and the cases below assert the two
 * properties that matter: exactly one thing happens, and `editor`/`preview` are unreachable for
 * anything outside the project.
 */

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: 'D:\\p\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
  ...over,
});

const REQUEST: LinkResolutionRequest = {
  text: 'src/foo.ts',
  kind: 'detectedPath',
  baseDirectory: 'D:\\p',
  panelId: 'p1',
};

function spy() {
  const calls: { op: string; detail?: unknown }[] = [];
  const deps: LinkActionDeps = {
    openInEditor: (l, position) => void calls.push({ op: 'editor', detail: { path: l.path, position } }),
    openInPreview: (l) => void calls.push({ op: 'preview', detail: l.path }),
    revealInOsExplorer: async (r) => {
      calls.push({ op: 'osExplorer', detail: r.text });
      return { ok: true };
    },
    openInOsDefaultProgram: async (r) => {
      calls.push({ op: 'osDefaultProgram', detail: r.text });
      return { ok: true };
    },
    reportFailure: (outcome) => void calls.push({ op: 'failure', detail: outcome }),
  };
  return { deps, calls };
}

/** FR-030's order (`buildLinkMenu`'s own rows), now that `targets.ts` (T277) no longer names it. */
const LINK_TARGETS: readonly LinkTarget[] = ['editor', 'preview', 'osExplorer', 'osDefaultProgram'];

const run = (target: LinkTarget, l: ResolvedLink, deps: LinkActionDeps, position?: { line: number; column?: number }) =>
  performLinkTarget({ target, link: l, request: REQUEST, position, deps });

describe('performLinkTarget — each target performs itself, and nothing else', () => {
  it('editor', async () => {
    const { deps, calls } = spy();
    await run('editor', link(), deps);
    expect(calls.map((c) => c.op)).toEqual(['editor']);
  });

  it('preview', async () => {
    const { deps, calls } = spy();
    await run('preview', link({ preview: 'enabled' }), deps);
    expect(calls.map((c) => c.op)).toEqual(['preview']);
  });

  it('osExplorer', async () => {
    const { deps, calls } = spy();
    await run('osExplorer', link(), deps);
    expect(calls.map((c) => c.op)).toEqual(['osExplorer']);
  });

  it('osDefaultProgram', async () => {
    const { deps, calls } = spy();
    await run('osDefaultProgram', link(), deps);
    expect(calls.map((c) => c.op)).toEqual(['osDefaultProgram']);
  });

  it('no target ever performs a second one \u2014 over every target and every link shape', async () => {
    for (const target of LINK_TARGETS) {
      for (const kind of ['file', 'folder'] as const) {
        for (const inProject of [true, false]) {
          for (const preview of ['none', 'enabled', 'disabled'] as const) {
            const { deps, calls } = spy();
            await run(target, link({ kind, inProject, preview }), deps);
            const performed = calls.filter((c) => c.op !== 'failure');
            expect(performed.length, `${target}/${kind}/${inProject}/${preview}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe('performLinkTarget — FR-055: throng\u2019s own destinations are unreachable outside the project', () => {
  it('editor does nothing for an out-of-project file', async () => {
    const { deps, calls } = spy();
    await run('editor', link({ inProject: false }), deps);
    expect(calls.map((c) => c.op)).not.toContain('editor');
  });

  it('preview does nothing for an out-of-project file, however enabled its provider', async () => {
    const { deps, calls } = spy();
    await run('preview', link({ inProject: false, preview: 'enabled' }), deps);
    expect(calls.map((c) => c.op)).not.toContain('preview');
  });

  it('neither opens a FOLDER, which is not a document either', async () => {
    for (const target of ['editor', 'preview'] as const) {
      const { deps, calls } = spy();
      await run(target, link({ kind: 'folder', preview: 'enabled' }), deps);
      expect(calls.map((c) => c.op), target).not.toContain(target);
    }
  });

  it('a refused throng target is REPORTED, not silently dropped', async () => {
    // Reaching here at all means a caller offered an item FR-030 says is absent, so the user chose
    // something that cannot work. Doing nothing at all would read as a dead menu item.
    const { deps, calls } = spy();
    await run('editor', link({ inProject: false }), deps);
    expect(calls.map((c) => c.op)).toEqual(['failure']);
  });

  it('over every input, no out-of-project link reaches an editor or a preview', async () => {
    const offenders: string[] = [];
    for (const target of LINK_TARGETS) {
      for (const kind of ['file', 'folder'] as const) {
        for (const preview of ['none', 'enabled', 'disabled'] as const) {
          const { deps, calls } = spy();
          await run(target, link({ kind, preview, inProject: false }), deps);
          for (const call of calls) {
            if (call.op === 'editor' || call.op === 'preview') {
              offenders.push(`${target}/${kind}/${preview} -> ${call.op}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('performLinkTarget — what each target is given', () => {
  it('FR-033: the editor is given the position when the link carries one', async () => {
    const { deps, calls } = spy();
    await run('editor', link(), deps, { line: 42, column: 7 });
    expect(calls[0].detail).toEqual({ path: 'D:\\p\\src\\foo.ts', position: { line: 42, column: 7 } });
  });

  it('FR-034: the preview is given NO position \u2014 it cannot reveal one', async () => {
    const { deps, calls } = spy();
    await run('preview', link({ preview: 'enabled' }), deps, { line: 42, column: 7 });
    expect(calls[0]).toEqual({ op: 'preview', detail: 'D:\\p\\src\\foo.ts' });
  });

  it('FR-037: the two OS targets are given the REQUEST, never the resolved path', async () => {
    const { deps, calls } = spy();
    await run('osExplorer', link(), deps);
    await run('osDefaultProgram', link(), deps);
    expect(calls.map((c) => c.detail)).toEqual([REQUEST.text, REQUEST.text]);
  });

  it('an OS action that fails is reported once, with the outcome it returned', async () => {
    const { calls, deps } = spy();
    const failing: LinkActionDeps = {
      ...deps,
      revealInOsExplorer: async () => ({ ok: false, reason: 'gone', path: 'D:\\p\\src\\foo.ts' }),
    };
    await run('osExplorer', link(), failing);
    expect(calls).toEqual([
      { op: 'failure', detail: { ok: false, reason: 'gone', path: 'D:\\p\\src\\foo.ts' } },
    ]);
  });

  it('an OS action that succeeds reports nothing', async () => {
    const { deps, calls } = spy();
    await run('osExplorer', link(), deps);
    expect(calls.map((c) => c.op)).not.toContain('failure');
  });
});

/**
 * 045 T293 — the follow path (plan *Corrections, tenth pass*; data-model §16.18, §16.21).
 *
 * What the user meets today: a Ctrl+click follows only a link some earlier hover already resolved; a
 * click on a path nothing has asked about yet does NOTHING (FR-071's "not a link"), and the click that
 * does work makes two round trips — the resolve, then the reveal or open. FR-155 draws a link with no
 * answer at all, so the follow must stand on its own: ONE `throng:links:follow` request, main resolves
 * and reveals within one deadline, and the renderer acts on the `LinkFollowOutcome` it gets back.
 */
describe('T293 — followLink sends ONE follow and acts on its LinkFollowOutcome', () => {
  const inProject = link({ path: 'D:\\p\\src\\foo.ts', preview: 'enabled' });
  let sent: { channel: string; request: LinkResolutionRequest }[];
  let answer: unknown;

  beforeEach(() => {
    sent = [];
    const record = (channel: string) => (request: LinkResolutionRequest) => {
      sent.push({ channel, request });
      return Promise.resolve(channel === 'follow' ? answer : { ok: true });
    };
    (window as unknown as { throng: unknown }).throng = {
      links: { follow: record('follow'), resolve: record('resolve'), reveal: record('reveal'), open: record('open') },
    };
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'throng');
    vi.restoreAllMocks();
  });

  function followDeps(over: Partial<LinkFollowDeps> = {}) {
    const calls: { op: string; detail?: unknown }[] = [];
    const deps: LinkFollowDeps = {
      openInEditor: (l, position) => void calls.push({ op: 'editor', detail: { path: l.path, position } }),
      openInPreview: (l) => void calls.push({ op: 'preview', detail: l.path }),
      reportFailure: (outcome) => void calls.push({ op: 'failure', detail: outcome }),
      ...over,
    };
    return { deps, calls };
  }

  const follow = (deps: LinkFollowDeps, position?: { line: number; column?: number }) =>
    (followLink as unknown as (a: unknown) => Promise<void>)({
      request: REQUEST,
      ...(position === undefined ? {} : { position }),
      deps,
    });

  it('sends exactly ONE main request per follow, and it is `follow` — no resolve, no second pass', async () => {
    answer = { kind: 'revealed' };
    await follow(followDeps().deps);
    expect(sent).toEqual([{ channel: 'follow', request: REQUEST }]);
  });

  it('openInThrong → opens in throng by the click rule, the position kept', async () => {
    answer = { kind: 'openInThrong', link: inProject };
    const { deps, calls } = followDeps();
    await follow(deps, { line: 42, column: 7 });
    expect(calls).toEqual([{ op: 'editor', detail: { path: inProject.path, position: { line: 42, column: 7 } } }]);
  });

  it('openInThrong on a file whose default open action is Preview, with no position → the preview', async () => {
    answer = { kind: 'openInThrong', link: inProject };
    const { deps, calls } = followDeps({ previewIsDefault: () => true });
    await follow(deps);
    expect(calls).toEqual([{ op: 'preview', detail: inProject.path }]);
  });

  it('revealed → nothing more: no open, no notice', async () => {
    answer = { kind: 'revealed' };
    const { deps, calls } = followDeps();
    await follow(deps);
    expect(calls).toEqual([]);
  });

  it('notFound → FR-160’s ONE notice, naming the path; no editor, no preview', async () => {
    answer = { kind: 'notFound', path: 'D:\\p\\src\\missing.ts' };
    const { deps, calls } = followDeps();
    await follow(deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'failure', detail: { path: 'D:\\p\\src\\missing.ts' } });
    expect(calls[0]!.detail, 'its own condition, not "refused"').not.toMatchObject({ reason: 'refused' });
  });

  it('unreachable → FR-124’s ONE "did not answer" notice', async () => {
    answer = { kind: 'unreachable', path: '\\\\fileserver\\home\\a.txt' };
    const { deps, calls } = followDeps();
    await follow(deps);
    expect(calls).toEqual([
      { op: 'failure', detail: { ok: false, reason: 'unreachable', path: '\\\\fileserver\\home\\a.txt' } },
    ]);
  });

  it('refused → FR-036’s ONE notice, carrying the OS’s reason', async () => {
    answer = { kind: 'refused', path: 'D:\\p\\a.txt', osReason: 'Access is denied.' };
    const { deps, calls } = followDeps();
    await follow(deps);
    expect(calls).toEqual([
      { op: 'failure', detail: { ok: false, reason: 'refused', path: 'D:\\p\\a.txt', osReason: 'Access is denied.' } },
    ]);
  });

  it('failed → exactly ONE failure notice naming the path', async () => {
    answer = { kind: 'failed', path: 'src/foo.ts', message: 'boom' };
    const { deps, calls } = followDeps();
    await follow(deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'failure', detail: { path: 'src/foo.ts' } });
  });

  it('rejected → no notice (no gesture can build one) and ONE logged diagnostic', async () => {
    answer = { kind: 'rejected' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps, calls } = followDeps();
    await follow(deps);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('with no bridge at all, the follow is reported once rather than doing nothing silently', async () => {
    Reflect.deleteProperty(window, 'throng');
    const { deps, calls } = followDeps();
    await follow(deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('failure');
  });
});
