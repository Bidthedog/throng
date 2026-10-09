import { act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { MovedPathSync } from '../../src/renderer/editor/moved-path-sync.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';
import { getEditorState, removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { getPanelLanguage, removePanelLanguage } from '../../src/renderer/editor/editor-language.js';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * A moved file: the view follows its document's PATH, and nothing else changes (019 FR-002, AC1).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-move-repoint.e2e.ts:178` (035 T056) — `test('AC1 — a
 * cut+paste move re-points the editor; it does not go dirty and raises no notice')`.
 *
 * ══ THREE OF ITS FOUR ASSERTIONS ALREADY HAD A HOME ══
 *
 * `integration/editor-move.integration.test.ts:158` — "a clean move is not news: no dirty, no
 * delete, no notice, and no recovery snapshot (FR-003/AC5)" — is the same claim about the same
 * event, made against the authority that decides it, and `:99`/`:122`/`:138` add the dirty-document
 * case, the once-per-window broadcast, and the registry and folder watch following.
 *
 * ══ THE FOURTH HAD NO TEST AT ANY LAYER ══
 *
 * The panel header's FILE PILL. `panel-placeholder.tsx:670` renders `editorUi.filePath`, and
 * `use-editor.ts:1086` is what puts the new path there — the comment beside it names this exact
 * test ("what the header's file pill renders (AC1)"). Nothing below E2E had ever driven a
 * `movedTo`, so the hop from the broadcast to the store was untested in both directions: a view
 * that ignored the message would leave the pill and a subsequent Ctrl+S pointed at a path the file
 * has left.
 *
 * A LANGUAGE change comes with it, and it is the half that is easy to forget: a move can rename the
 * extension, so `notes.txt` becoming `notes.py` must highlight as Python there and then.
 */

const PANEL = 'p-ed';

afterEach(() => {
  removeEditorState(PANEL);
  removePanelLanguage(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

describe('a moved document (AC1, migrated from editor-move-repoint.e2e.ts:178)', () => {
  it('re-points the view’s path, which is what the file pill renders', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MOVE-ME-BODY\n', version: 1, absPath: 'C:/proj/note.txt' },
    });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/note.txt'));

    h.pushMoved('C:/proj/dest/note.txt');

    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/dest/note.txt'));
  });

  it('does not dirty the document — the user asked for the move', async () => {
    /*
     * The symptom a user actually sees, and the one the migrated test gathered softly alongside the
     * cause. A move that dirtied the buffer would offer to save on close, and the save would
     * re-create the file at the path the move had just emptied.
     */
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MOVE-ME-BODY\n', version: 1, absPath: 'C:/proj/note.txt' },
    });
    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/note.txt'));

    h.pushMoved('C:/proj/dest/note.txt');

    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/dest/note.txt'));
    expect(getEditorState(PANEL)?.dirty, 'a move is not an edit').toBeFalsy();
  });

  it('does not RELOAD the document — it is the same buffer at a new path', async () => {
    // `markMoved` re-points; it does not re-read. A view that treated the message as a reason to
    // reload would drop unsaved work on a move the user performed deliberately.
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'MOVE-ME-BODY\n', version: 1, absPath: 'C:/proj/note.txt' },
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('MOVE-ME-BODY\n'));

    h.pushMoved('C:/proj/dest/note.txt');

    await waitFor(() => expect(getEditorState(PANEL)?.filePath).toBe('C:/proj/dest/note.txt'));
    expect(h.view().state.doc.toString()).toBe('MOVE-ME-BODY\n');
  });

  it('renames what the tab and the pill DISPLAY', async () => {
    // `displayName` follows `configRef.current.filePath`, so this is the same hop as the first test
    // seen from the surface the user reads. Kept separate because it is a different consumer: the
    // pill takes the full path, the tab takes the name.
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'x = 1\n', version: 1, absPath: 'C:/proj/notes.txt' },
    });
    await waitFor(() => expect(getEditorState(PANEL)?.displayName).toBe('notes.txt'));

    h.pushMoved('C:/proj/renamed.txt');

    await waitFor(() => expect(getEditorState(PANEL)?.displayName).toBe('renamed.txt'));
  });

  it('re-derives the LANGUAGE, because a move can rename the extension (FR-002a)', async () => {
    /*
     * `notes.txt` renamed to `notes.py` must highlight as Python there and then — the file's NAME is
     * what decides its language, and a move is the one event that changes the name without changing
     * the document.
     *
     * Asserted on `getPanelLanguage`, and the first draft was not: it read `displayName`, which
     * follows the PATH rather than the language, so deleting the `refreshLanguage()` call beside the
     * re-point left it perfectly green. Two consumers of one field are not two tests; the language
     * has its own store and that is what has to be read.
     */
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'x = 1\n', version: 1, absPath: 'C:/proj/notes.txt' },
    });
    await waitFor(() => expect(getPanelLanguage(PANEL)?.languageId).toBe('plaintext'));

    h.pushMoved('C:/proj/notes.py');

    await waitFor(() => expect(getPanelLanguage(PANEL)?.languageId).toBe('python'));
  });
});

/*
 * 052 T012 (FR-007, US2 scenario 1, research R5): an editor in a tab that has never mounted has no coordinator
 * document, so it never hears `movedTo`. The window follows `throng:files:moved` for every editor panel its layout
 * holds, shown or not, and the next `workspace.save` carries the new path.
 */
describe('an editor panel nobody has mounted follows a move (052 T012)', () => {
  const PROJECT = 'proj';
  const OLD = 'D:/proj/a.md';
  const NEW = 'D:/proj/renamed.md';
  let m: MountedWorkspace | undefined;
  let listeners: ((evt: { moves: { from: string; to: string }[] }) => void)[] = [];

  const layout = (): WorkspaceLayout => {
    const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p0' });
    const ed: Panel = { type: 'panel', id: 'ed', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: OLD } };
    l.tabs.push({ id: 't2', title: 'Tab 2', root: ed, activePanelId: 'ed' });
    return l;
  };
  const pathOf = (): unknown =>
    (m!.ws().layout!.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === 'ed')?.config as
      | { filePath?: string }
      | undefined)?.filePath;
  const moved = (moves: { from: string; to: string }[]): void => act(() => listeners.forEach((l) => l({ moves })));

  const mount = async (): Promise<void> => {
    listeners = [];
    m = await mountWorkspace(layout(), {
      extras: [createElement(MovedPathSync, { key: 'sync' })],
      throng: {
        files: {
          onMoved: (cb: (evt: { moves: { from: string; to: string }[] }) => void) => {
            listeners.push(cb);
            return () => (listeners = listeners.filter((l) => l !== cb));
          },
        },
      },
    });
  };

  afterEach(() => {
    removeEditorState('ed');
    m?.unmount();
    m = undefined;
  });

  it('leaves a panel with a live editor state alone: a REPLACED one keeps its own path (052 R6)', async () => {
    // The authority tells every panel that has a document through `movedTo`. A replaced document has none —
    // its path is another file's now — so a layout pass by path would point it at that file's NEW name, and a
    // restart would open two buffers on one file.
    await mount();
    setEditorState('ed', { filePath: OLD, displayName: 'a.md', dirty: true, replaced: true });
    moved([{ from: OLD, to: NEW }]);
    expect(pathOf()).toBe(OLD);
  });

  it('rewrites filePath with no movedTo relay, and the next save carries it', async () => {
    await mount();
    moved([{ from: OLD, to: NEW }]);
    expect(pathOf()).toBe(NEW);
    await waitFor(() => {
      const last = m!.saves.mock.calls.at(-1)?.[0] as { layout: WorkspaceLayout } | undefined;
      const saved = last?.layout.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === 'ed');
      expect((saved?.config as { filePath?: string } | undefined)?.filePath).toBe(NEW);
    });
  });

  it('is idempotent: an editor already at the new path writes nothing', async () => {
    await mount();
    moved([{ from: OLD, to: NEW }]);
    const after = m!.ws().layout;
    moved([{ from: OLD, to: NEW }]);
    expect(m!.ws().layout).toBe(after);
  });

  it('a move touching none of its panels writes nothing', async () => {
    await mount();
    const before = m!.ws().layout;
    moved([{ from: 'D:/proj/else.md', to: 'D:/proj/else2.md' }]);
    expect(m!.ws().layout).toBe(before);
  });
});
