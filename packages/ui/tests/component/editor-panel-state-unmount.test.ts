import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPanelLanguage,
  removePanelLanguage,
} from '../../src/renderer/editor/editor-language.js';
import { setDocumentOverride } from '../../src/renderer/editor/language-override.js';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * The editor panel's half of #295 — does state that belongs to the SESSION survive a view unmount?
 *
 * ══ WHY THIS IS THE SAME BUG AND NOT AN ANALOGY ══
 *
 * `use-editor.ts:1277` calls `removePanelLanguage(panelId)` from the attach effect's cleanup — the
 * same lifecycle event, in the same position, as the terminal's `clearTerminalTitle`. And the file
 * already knows this is the wrong place for teardown: eight lines below, `disposeEditor()` exists
 * for exactly that and is documented as "called on explicit Panel destroy", while the cleanup
 * itself ends with a comment saying the document "survives a remount … Explicit teardown happens on
 * Panel destroy". The language did not get that treatment.
 *
 * ══ WHY IT USUALLY DOESN'T SHOW, AND WHEN IT DOES ══
 *
 * `setDocumentOverride` persists the choice (`documents.setState(projectId, relPath, languageId)`),
 * so for an ordinary project file a remount re-reads it from the database and the loss is invisible.
 * But that write is guarded:
 *
 *     if (!projectId || !relPath) return; // nothing to key the row against
 *
 * A ROOTLESS panel — a sub-workspace editor — has no project to key a row against, so the store is
 * the only copy of the user's choice. Unmounting the view destroys it permanently, and the document
 * silently reverts to whatever its filename implies. That is the terminal-title defect exactly, on
 * a surface where nothing else can restore the value.
 *
 * The second test pins the invariant that already holds, so a fix to the first cannot quietly
 * trade one for the other.
 */

const PANEL = 'p-ed';

/**
 * Let the mount's own language resolution finish before the user overrides it.
 *
 * Mounting kicks off a load that derives the language from the filename. Overriding while that is
 * still in flight is a legitimate scenario — `claimLanguage` exists for exactly it — but it is not
 * THIS test's scenario, and letting the two overlap made the override look as though it had never
 * applied. A precondition that fails for a timing reason is indistinguishable from the defect.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** No database in a rootless panel — the override has nowhere to be written, by design. */
const noDocuments = {
  setState: vi.fn(() => Promise.resolve()),
} as unknown as Parameters<typeof setDocumentOverride>[0]['documents'];

afterEach(() => {
  removePanelLanguage(PANEL);
  vi.clearAllMocks();
});

describe('an editor panel in a sub-workspace, where nothing else remembers the choice', () => {
  it("KEEPS the language the user picked when its view unmounts (#295's editor half)", async () => {
    mountEditor({ doc: { text: 'print(1)\n', version: 1, absPath: 'C:/tmp/scratch.txt' }, rootless: true });
    await settle();

    // The user picks "Python" for a file whose name says otherwise. Rootless, so `projectId` is
    // undefined and the write is skipped — this store IS the record of their decision.
    await setDocumentOverride({
      panelId: PANEL,
      projectId: undefined,
      relPath: undefined,
      languageId: 'python',
      documents: noDocuments,
    });
    expect(getPanelLanguage(PANEL)?.languageId, 'precondition: the override was applied').toBe(
      'python',
    );
    expect(noDocuments.setState, 'precondition: nothing was persisted').not.toHaveBeenCalled();

    cleanup(); // a tab switch, a project switch — anything that unmounts the view

    expect(
      getPanelLanguage(PANEL)?.languageId,
      'the panel silently reverts to the language its filename implies, and the user picks again',
    ).toBe('python');
  });

  it('still forgets it when the panel is DESTROYED, so a recycled id inherits nothing', async () => {
    mountEditor({ doc: { text: 'print(1)\n', version: 1, absPath: 'C:/tmp/scratch.txt' }, rootless: true });
    await settle();
    await setDocumentOverride({
      panelId: PANEL,
      projectId: undefined,
      relPath: undefined,
      languageId: 'python',
      documents: noDocuments,
    });

    // `disposeEditor` is the destroy path; `removePanelLanguage` is the part of it under test here.
    removePanelLanguage(PANEL);
    cleanup();

    expect(getPanelLanguage(PANEL), 'a destroyed panel must not leave its language behind').toBe(
      undefined,
    );
  });
});
