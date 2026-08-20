import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { DirtyCloseDialog } from '../../src/renderer/editor/dirty-close-dialog.js';
import {
  __resetDirtyCloseStore,
  promptDirtyClose,
  type DirtyCloseChoice,
} from '../../src/renderer/editor/dirty-close-store.js';

/**
 * The save/discard/cancel prompt that stands between a user and their unsaved work.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-menus.e2e.ts:98` (035 T055) — the dialog half.
 *
 * ══ NOTHING TESTED THIS BELOW E2E, AND ONE OF ITS RULES IS A SAFETY RULE ══
 *
 * `dirty-close-store.ts` had no test of any kind. The E2E reached this dialog by creating a project,
 * opening an editor on a real file, typing into a real CodeMirror to make it dirty, right-clicking
 * the panel header and choosing Destroy Panel — and then asserted the dialog appeared.
 *
 * The rule most worth having is written in `dirty-close-dialog.tsx` and was asserted nowhere:
 *
 * > A dismissal (overlay click / Escape) is a CANCEL — the safe answer. It must never be read as
 * > consent to discard someone's unsaved work.
 *
 * That is the difference between a stray Escape closing a panel and a stray Escape doing nothing.
 * It is one `?? 'cancel'` in the source, and it is exactly the kind of line that survives a refactor
 * only if something is watching.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * That the panel-header Destroy actually RAISES this prompt, and that discarding then removes the
 * panel. Those are the workspace's, and `editor-menus.e2e.ts` keeps them.
 */

function mount() {
  render(
    createElement(
      ConfirmProvider,
      null,
      createElement(Fragment, null, createElement(DirtyCloseDialog, null)),
    ),
  );
  return { user: userEvent.setup() };
}

/** Raise the prompt and hand back the pending choice, without awaiting it. */
function ask(targetLabel = 'Panel 1', files: string[] = ['notes.txt']): Promise<DirtyCloseChoice> {
  return promptDirtyClose(targetLabel, files);
}

/*
 * Several tests below raise a prompt and never answer it — deliberately, because what they assert
 * is what the prompt SAYS, not what answering it does. The request is module state, so an
 * unanswered one is still there when the next test renders, and that test then reads the previous
 * test's dialog for as long as it takes React to flush the new request. It is a race, so it passes
 * on a quiet machine and fails on a busy one; this is what makes each test start from no prompt.
 */
afterEach(() => {
  __resetDirtyCloseStore();
});

describe('the prompt names what is about to be lost', () => {
  it('shows the target and the file, with the file set apart', async () => {
    /*
     * The file names are the part of the sentence a user must actually read before answering — they
     * are what is about to be lost — so they are emphasised rather than buried mid-paragraph. The
     * `.modal__name` assertion is that emphasis, not decoration: it is the difference between a
     * sentence someone skims and one they parse.
     */
    mount();
    void ask('Panel 1', ['notes.txt']);

    const dialog = await screen.findByTestId('dirty-close-dialog');
    expect(dialog).toHaveTextContent('Panel 1');
    expect(dialog).toHaveTextContent('notes.txt');
    expect(dialog.querySelector('.modal__name')?.textContent).toBe('notes.txt');
  });

  it('lists SEVERAL files rather than saying "some files"', async () => {
    mount();
    void ask('Tab 2', ['a.txt', 'b.txt', 'c.txt']);

    const dialog = await screen.findByTestId('dirty-close-dialog');
    for (const file of ['a.txt', 'b.txt', 'c.txt']) expect(dialog).toHaveTextContent(file);
    expect(dialog.querySelectorAll('.modal__name')).toHaveLength(3);
  });

  it('still asks when it has no file names to show', async () => {
    // A dirty buffer that was never saved has no name yet. The prompt must still appear — losing the
    // work silently because the sentence would read awkwardly is the wrong trade.
    mount();
    void ask('Panel 1', []);

    const dialog = await screen.findByTestId('dirty-close-dialog');
    expect(dialog).toHaveTextContent('unsaved changes');
    expect(dialog.querySelectorAll('.modal__name')).toHaveLength(0);
  });
});

describe('every answer resolves to the choice the user made', () => {
  it('Cancel resolves cancel', async () => {
    const { user } = mount();
    const choice = ask();
    await screen.findByTestId('dirty-close-dialog');

    await user.click(screen.getByTestId('dirty-close-cancel'));

    await expect(choice).resolves.toBe('cancel');
  });

  it('Discard & close resolves discard', async () => {
    const { user } = mount();
    const choice = ask();
    await screen.findByTestId('dirty-close-dialog');

    await user.click(screen.getByTestId('dirty-close-discard'));

    await expect(choice).resolves.toBe('discard');
  });

  it('Save & close resolves save', async () => {
    const { user } = mount();
    const choice = ask();
    await screen.findByTestId('dirty-close-dialog');

    await user.click(screen.getByTestId('dirty-close-save'));

    await expect(choice).resolves.toBe('save');
  });

  it('offers Discard as the DANGEROUS one, so it does not read as the default', async () => {
    /*
     * Three buttons, one of which destroys work. It carries `danger: true`, and that is the only
     * thing on screen distinguishing "close and lose it" from "close and keep it".
     */
    mount();
    void ask();
    await screen.findByTestId('dirty-close-dialog');

    const discard = screen.getByTestId('dirty-close-discard');
    expect(discard.className, 'Discard must be marked dangerous').toMatch(/danger/);
    expect(screen.getByTestId('dirty-close-save').className).not.toMatch(/danger/);
  });
});

describe('a dismissal is a cancel, never a discard', () => {
  it('Escape resolves cancel — it is not consent to lose the work', async () => {
    /*
     * THE SAFETY RULE, and the one thing here that would be expensive to get wrong: a stray Escape
     * must not close a panel and take unsaved work with it. The source says so in as many words; it
     * comes down to one `?? 'cancel'`, and nothing was watching it.
     */
    const { user } = mount();
    const choice = ask();
    await screen.findByTestId('dirty-close-dialog');

    await user.keyboard('{Escape}');

    await expect(choice).resolves.toBe('cancel');
    await waitFor(() => expect(screen.queryByTestId('dirty-close-dialog')).toBeNull());
  });
});
