import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * A panel whose open had not answered when the missing-file scan sampled (#369).
 *
 * ══ WHY THIS IS NOT IN `missing-file-watcher.test.ts` ══
 *
 * That file drives `MissingFileWatcher` against a hand-written `editor-state` fixture, which is the
 * right shape for every claim it makes — and exactly the wrong shape for this one. The defect is
 * about a panel whose initial open HAS NOT DECIDED ANYTHING YET, and today nothing in `EditorUiState`
 * can say so: `fileMissing: false, unloadable: false` is what a healthy panel publishes and what a
 * still-loading one publishes. A fixture that writes those two flags by hand can only reproduce the
 * ambiguity by asserting it, which would pass for a fix that merely guessed.
 *
 * So the pending state has to be produced by production code. `mountEditor` runs the real
 * `use-editor` mount: `getContent` answers, `initialise` publishes the adopted state, and the
 * verdict `verifyPath` asked for arrives afterwards on the sync channel — which is the sequence a
 * restore into a project whose root was renamed away actually takes.
 *
 * ══ WHAT THE USER SEES (issue #369) ══
 *
 * Two per-panel "This file could not be read" banners and the file tree's "Couldn't list the
 * contents of <folder>", and NO consolidated notice — the one that names which panels the absent
 * folder took with it, and which 030 FR-034a requires to supersede the tree's report. So the user is
 * told the folder is gone twice, in two vocabularies, and never told what it broke.
 *
 * Reproduced 3/3 on the self-hosted gate runner (~2.5x slower than the reference workstation, cold
 * disk), where `notice-a11y.e2e.ts:115` waited the full 90s for `panel-failure-notice`. It does not
 * reproduce on the reference workstation, where the open answers well inside the scan's 300 ms.
 *
 * ══ THE COUNTERPART THAT KEEPS A FIX HONEST ══
 *
 * `missing-file-watcher.test.ts:234` — a file that goes missing under a tab the user is already
 * looking at must stay SILENT (FR-105). That sequence and this one are the same shape today, and
 * telling them apart is the whole of the fix; a change that reddens that test has not fixed this
 * one, it has traded it.
 */

/**
 * Longer than the scan's own `SCAN_DELAY_MS` (300), so the scan has provably sampled and finished
 * before the verdict lands.
 *
 * A real wait rather than a fake clock because THE WAIT IS THE SCENARIO: the bug is that the open
 * answered late, and the mount that answers it is a chain of real promises across two channels. It
 * is not a guess at a duration — it is a fixed delay either side of a fixed constant, and the test
 * that follows it waits on an observable rather than on more time.
 */
const PAST_THE_SCAN_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const notice = (): HTMLElement | null => screen.queryByTestId('panel-failure-notice');

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('the consolidated notice names a panel whose open answered late (#369)', () => {
  it('reports the panel when the authority’s verdict arrives after the scan sampled', async () => {
    /*
     * The restore, exactly as `use-editor.ts:1431` takes it: `getContent` answers with the
     * authority's state, in which NOTHING has read the disk yet — so both flags are false, and the
     * panel is indistinguishable from a healthy one. `verifyPath` is then asked for the verdict.
     */
    const h = mountEditor({
      doc: {
        text: '',
        version: 1,
        absPath: 'C:/proj/renamed-away.txt',
        fileMissing: false,
        unloadable: false,
      },
      withMissingFileWatcher: true,
    });

    await waitFor(() => expect(h.calls.verifyPath).toHaveBeenCalled());

    // …and the scan samples, finding two false flags on a panel that has decided nothing.
    await sleep(PAST_THE_SCAN_MS);
    expect(notice(), 'nothing is wrong yet — the verdict has not come back').toBeNull();

    // The verdict, late: the path cannot be read. This is what raises the per-panel banner the user
    // can see, and it is the moment the consolidated notice owes them an explanation.
    h.pushSync({ unloadable: true });

    /*
     * The banner the user CAN see, asserted first — so a red below is the missing notice and not a
     * verdict that never landed. This pair is the reported symptom in miniature: the per-panel
     * banner arrives, the consolidated notice does not.
     */
    await waitFor(() =>
      expect(screen.queryByTestId('panel-failure-p-ed'), 'the verdict reached the panel').not.toBeNull(),
    );

    await waitFor(
      () => expect(notice(), 'the panel was pending when the scan ran, so it was never reported').not.toBeNull(),
      { timeout: 2000 },
    );
  });
});
