import { describe, expect, it } from 'vitest';
import { LINK_TARGETS, type LinkResolutionRequest, type LinkTarget, type ResolvedLink } from '@throng/core';
import { performLinkTarget, type LinkActionDeps } from '../../src/renderer/links/link-actions.js';

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
