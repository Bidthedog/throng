import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClipboardItem, IFileSystem } from '@throng/core';
import { FileClipboardService } from '../../src/main/file-clipboard.js';
import { disposeHarness, FsDecorator, gate, makeHarness, put, settle, type Harness } from './helpers/transfer-harness.js';

/**
 * What a paste leaves on the clipboard (050 R7, FR-006, data-model transitions — T035).
 *
 * The clipboard is wired exactly as main wires it: it follows the move bracket (`followMoves` from the
 * in-app move callback), and the engine applies `afterRun` itself. That composition is the trap — the
 * bracket's close re-points moved items to their NEW paths, after which they no longer equal the run's
 * snapshot — so it is what is tested, not the rule in isolation.
 */

let h: Harness;
let clipboard: FileClipboardService;

async function setup(wrapFs?: (fs: IFileSystem) => IFileSystem): Promise<void> {
  clipboard = new FileClipboardService(() => {});
  h = await makeHarness({ wrapFs, answer: () => ({ choice: 'skip', applyToAll: false }), deps: { clipboard } });
  h.files.setOnMoved((moves) => clipboard.followMoves(moves));
  await put(join(h.rootA, 'a.txt'), 'a');
  await put(join(h.rootA, 'b.txt'), 'b-incoming');
  await put(join(h.rootB, 'b.txt'), 'b-existing');
}

const itemsA = (...names: string[]): ClipboardItem[] =>
  names.map((n) => ({ absPath: join(h.rootA, n), projectId: 'A', projectRoot: h.rootA }));

/** Cut or copy in A, as the IPC does it, and paste into B's root as the snapshot. */
async function pasteFromA(mode: 'cut' | 'copy', ...names: string[]) {
  clipboard.setFromRelative(mode, names, h.rootA, 'A');
  return h.svc.paste(1, h.rootB, clipboard.get()!);
}

afterEach(async () => {
  await disposeHarness(h);
});

describe('the clipboard after a paste (FR-006)', () => {
  it('a cut in which everything moved leaves it EMPTY — not holding the moved items at their new paths', async () => {
    await setup();
    await (await pasteFromA('cut', 'a.txt')).result;
    expect(clipboard.get()).toBeNull();
  });

  it('a cut keeps exactly the items that did not move — skipped and failed — at their ORIGINAL paths', async () => {
    await setup();
    const r = await (await pasteFromA('cut', 'a.txt', 'b.txt', 'missing.txt')).result;
    expect(r.failures.map((f) => f.name)).toContain('missing.txt');
    expect(clipboard.get()).toEqual({ mode: 'cut', items: itemsA('b.txt', 'missing.txt') });
  });

  it('a copy leaves it unchanged', async () => {
    await setup();
    clipboard.setFromRelative('copy', ['a.txt'], h.rootA, 'A');
    const before = clipboard.get();
    await h.svc.paste(1, h.rootB, before!).result;
    expect(clipboard.get()).toBe(before);
  });

  it('a clipboard the user replaced while the job ran is left alone', async () => {
    const g = gate();
    class Slow extends FsDecorator {
      override async move(s: string, d: string): Promise<string> {
        await g.promise;
        return super.move(s, d);
      }
    }
    await setup((fs) => new Slow(fs));
    const run = await pasteFromA('cut', 'a.txt');
    await settle();
    clipboard.setFromRelative('copy', ['b.txt'], h.rootA, 'A');
    const replaced = clipboard.get();
    g.open();
    await run.result;
    expect(clipboard.get()).toEqual(replaced);
  });
});
