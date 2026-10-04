import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInAppMoveCallbacks } from '../../src/main/in-app-moves.js';
import type { MovePair } from '../../src/main/files-service.js';
import { disposeHarness, makeHarness, put, type Harness } from './helpers/transfer-harness.js';

/**
 * A cross-project cut reaches every consumer an in-project move does (050 FR-016, T033).
 *
 * The transfer engine opens and closes `FilesService`'s move bracket, and `FilesService` holds the ONE
 * pair of callbacks `createInAppMoveCallbacks` builds — so open editors, previews, navigation history
 * and the File Explorer clipboard follow a file between roots by exactly the path a move within one
 * project takes. Composed here with the REAL callback order over recording doubles.
 */

type Call = { who: string; what: string; arg: unknown; aExists?: boolean; bExists?: boolean };

let h: Harness;
let calls: Call[];
let src: { file: string; folder: string; openInFolder: string };
let dest: { file: string; folder: string };

beforeEach(async () => {
  h = await makeHarness();
  src = {
    file: join(h.rootA, 'a.txt'),
    folder: join(h.rootA, 'pack'),
    openInFolder: join(h.rootA, 'pack', 'open.md'),
  };
  dest = { file: join(h.rootB, 'a.txt'), folder: join(h.rootB, 'pack') };
  await put(src.file, 'a');
  await put(src.openInFolder, 'open');
  calls = [];
  const where = (): Pick<Call, 'aExists' | 'bExists'> => ({
    aExists: existsSync(src.file),
    bExists: existsSync(dest.file),
  });
  const callbacks = createInAppMoveCallbacks({
    coordinator: {
      beginMove: (p) => calls.push({ who: 'coordinator', what: 'beginMove', arg: p, ...where() }),
      markMoved: (m) => calls.push({ who: 'coordinator', what: 'markMoved', arg: m, ...where() }),
    },
    previews: {
      beginMove: (p) => calls.push({ who: 'previews', what: 'beginMove', arg: p }),
      moved: (m) => {
        calls.push({ who: 'previews', what: 'moved', arg: m });
        return [];
      },
      announcePath: () => {},
    },
    history: {
      rewritePaths: (m) => calls.push({ who: 'history', what: 'rewritePaths', arg: m }),
      announce: () => {},
    },
    broadcastFilesMoved: (m) => calls.push({ who: 'broadcast', what: 'filesMoved', arg: m }),
    clipboard: { followMoves: (m) => calls.push({ who: 'clipboard', what: 'followMoves', arg: m }) },
  });
  h.files.setOnMoveStarted(callbacks.started);
  h.files.setOnMoved(callbacks.moved);
});
afterEach(async () => {
  await disposeHarness(h);
});

describe('a cross-project cut follows open documents (FR-016)', () => {
  it('beginMove before the first change, markMoved with the exact pairs after, then every consumer once', async () => {
    const r = await h.svc.paste(1, h.rootB, {
      mode: 'cut',
      items: [src.file, src.folder].map((absPath) => ({ absPath, projectId: 'A', projectRoot: h.rootA })),
    }).result;
    expect(r.failures).toEqual([]);
    const pairs: MovePair[] = [
      { from: src.file, to: dest.file },
      { from: src.folder, to: dest.folder },
    ];
    expect(calls.map((c) => `${c.who}.${c.what}`)).toEqual([
      'coordinator.beginMove',
      'previews.beginMove',
      'coordinator.markMoved',
      'previews.moved',
      'history.rewritePaths',
      'broadcast.filesMoved',
      'clipboard.followMoves',
    ]);
    // Opened over every source while they were all still in A.
    expect(calls[0]).toMatchObject({ arg: [src.file, src.folder], aExists: true, bExists: false });
    // Closed once everything had landed in B, naming exactly what moved.
    expect(calls[2]).toMatchObject({ arg: pairs, aExists: false, bExists: true });
    for (const c of calls.slice(3)) if (c.what !== 'beginMove') expect(c.arg).toEqual(pairs);
    // The file open inside the moved folder is covered by the folder's pair (019 FR-005's prefix rule).
    expect(existsSync(join(dest.folder, 'open.md'))).toBe(true);
  });
});
