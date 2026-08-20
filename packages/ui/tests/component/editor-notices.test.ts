import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEditorState, removeEditorState } from '../../src/renderer/editor/editor-state.js';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { dismissEditorNotice } from '../../src/renderer/editor/editor-notice-store.js';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * The two editor notices, and the WIRING that fills them in.
 *
 * MIGRATED FROM (035 T056):
 *   `editor-external-change-named.e2e.ts:36` — the file-changed warning names the tab, panel and
 *                                              full path
 *   `editor-feedback.e2e.ts:84`             — a refused out-of-tree save shows a visible message
 *                                              and leaves the buffer unsaved
 *
 * ══ IN BOTH CASES THE ENDS WERE PROVEN AND THE MIDDLE WAS NOT ══
 *
 * `buildFileChangedNotice` is pure and covered by `unit/file-changed-notice.test.ts`, down to the
 * path split and the unpathed case. The out-of-tree REFUSAL is
 * `integration/editor-service-save.integration.test.ts:70`, which also proves nothing is written
 * outside the project.
 *
 * What neither reaches is the hop between them: that an `externalChange` broadcast calls the builder
 * with THIS panel's title, THIS tab's title and the path the document currently holds — three
 * arguments in a row, all strings, which is the shape a wiring mistake hides in best — and that a
 * refused save raises the notice at all rather than failing silently, which is the whole of FR-078.
 *
 * ══ WHY THE STORE AND NOT THE DIALOG ══
 *
 * `EditorNoticeDialog` is an ADAPTER (018 FR-051): it reads this store and re-reports it through the
 * shared notification model, and its rendering already has tests —
 * `component/notice-subject-rendering.test.ts` for the subject line, and the `editor-notice-*` test
 * ids it deliberately preserves. Asserting the store here keeps this file about the thing that had
 * no test: what the notice was FILLED IN with.
 */


/** Every notice currently on screen, as the shared notification model renders them. */
const noticeEl = (): HTMLElement | null => document.querySelector('[data-testid="editor-notice-dialog"]');
const noticeText = (): string => noticeEl()?.textContent ?? '';
const noticeFiles = (): string => document.querySelector('[data-testid="editor-notice-files"]')?.textContent ?? '';

const PANEL = 'p-ed';

afterEach(() => {
  dismissEditorNotice();
  removeEditorState(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

describe('the file-changed warning names its document (011 FR-010, migrated from editor-external-change-named.e2e.ts:36)', () => {
  it('names the file, its folder, the panel and the tab', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'original\n', version: 1, absPath: 'C:/proj/watched.txt' },
      withNotices: true,
    });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/watched.txt'));

    h.pushSync({ externalChange: true });

    await waitFor(() => expect(noticeEl()).toBeTruthy());
    expect(noticeText()).toContain('File changed on disk');
    expect(noticeFiles(), 'the file').toContain('watched.txt');
    expect(noticeFiles(), 'and the folder it is in').toContain('proj');
    expect(noticeFiles(), 'the panel').toContain('Panel: Panel 1');
    expect(noticeFiles(), 'and the containing tab').toContain('Tab:');
  });

  it('names the CURRENT path, not the one the document was opened at', async () => {
    /*
     * Three string arguments in a row is the shape a wiring mistake hides in best, and a stale path
     * is the version of it a user would actually meet: the file moves, then something else changes
     * it on disk, and the warning points at where it used to be. The migrated test opened one file
     * and never moved it, so it could not have seen this.
     */
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'original\n', version: 1, absPath: 'C:/proj/watched.txt' },
      withNotices: true,
    });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/watched.txt'));
    h.pushMoved('C:/proj/dest/watched.txt');
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/dest/watched.txt'));

    h.pushSync({ externalChange: true });

    await waitFor(() => expect(noticeEl()).toBeTruthy());
    expect(noticeFiles()).toContain('dest');
  });

  it('raises NOTHING when the sync message is not about an external change', async () => {
    // Without this, a view that raised the notice on every sync message would pass both tests above
    // and warn the user that their file changed on disk every time anything happened to it.
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'original\n', version: 1, absPath: 'C:/proj/watched.txt' },
      withNotices: true,
    });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/watched.txt'));

    h.pushSync({ dirty: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(noticeEl()).toBeNull();
  });
});

describe('a refused save says so (006 FR-078, migrated from editor-feedback.e2e.ts:84)', () => {
  it('raises a visible notice naming the project boundary, and leaves the buffer unsaved', async () => {
    /*
     * The refusal itself — and that nothing is written outside the project — is
     * `integration/editor-service-save.integration.test.ts:70`. What is here is FR-078: the refusal
     * REACHES the user. A save that failed silently would leave them believing their work was on
     * disk, which is the one failure mode worse than the refusal itself.
     */
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'data', version: 1, dirty: true, absPath: 'C:/proj/note.txt' },
      withNotices: true,
    });
    await waitFor(() => expect(getEditorActions(PANEL)).toBeTruthy());
    h.calls.save.mockResolvedValue({ ok: false, reason: 'out-of-tree', error: 'refused' });

    const saved = await getEditorActions(PANEL)!.save();

    expect(saved, 'the save reports failure to its caller').toBe(false);
    await waitFor(() => expect(noticeEl(), 'FR-078: a refused save is not a silent no-op').toBeTruthy());
    expect(noticeText()).toContain('Cannot save');
    expect(noticeText(), 'and it says WHY — the project boundary').toContain('project');
  });

  it('says something DIFFERENT for a sub-workspace editor, whose boundary is the opposite', async () => {
    /*
     * The two refusals are mirror images — a project editor may only save INSIDE its project, a
     * sub-workspace editor only OUTSIDE every project — so one wording for both would be wrong for
     * whichever half it was not written for. A single test cannot tell a correct message from a
     * hard-coded one.
     */
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'data', version: 1, dirty: true, absPath: 'C:/sub/note.txt' },
      projectRoot: null,
      rootless: true,

      withNotices: true,
    });
    await waitFor(() => expect(getEditorActions(PANEL)).toBeTruthy());
    h.calls.save.mockResolvedValue({ ok: false, reason: 'out-of-tree', error: 'refused' });

    await getEditorActions(PANEL)!.save();

    await waitFor(() => expect(noticeEl()).toBeTruthy());
    expect(noticeText()).toContain('sub-workspace');
    expect(noticeText()).toContain('OUTSIDE');
  });

  it('raises no notice at all when the save succeeds', async () => {
    // The control. A `reportSaveError` reached unconditionally would satisfy both tests above.
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'data', version: 1, dirty: true, absPath: 'C:/proj/note.txt' },
      withNotices: true,
    });
    await waitFor(() => expect(getEditorActions(PANEL)).toBeTruthy());
    h.calls.save.mockResolvedValue({ ok: true, savedText: 'data' });

    await getEditorActions(PANEL)!.save();
    await new Promise((r) => setTimeout(r, 50));

    expect(noticeEl()).toBeNull();
  });
});

// Keeps `vi` referenced when the mocks above are the only use of it.
void vi;
