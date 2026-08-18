/**
 * 033 US1 (#219) — Quick Open’s toolbar button, in the one state no lower layer can reach.
 *
 * ONE test is left, and it is FR-018c / FR-074 / A5 asked of a REAL APPLICATION IN WHICH NO
 * PROJECT HAS EVER BEEN OPENED: the button is drawn and disabled, the chord opens nothing, and
 * both come alive the moment a project exists. The chord half is `app.tsx`’s window-level
 * capture listener and `NavigationChrome`’s conditional registration, and nothing else in the
 * repository asserts it in either direction. Its tooltip assertions are now duplicated one layer
 * down (see below) and could be pruned; the declaration cannot go, because a partial replacement
 * is not a replacement (034 FR-047).
 *
 * ══ THE THREE THAT LEFT (034 FR-045 / FR-046a) ══
 *
 * `:209` — the toolbar’s SHAPE and its tooltip →
 *   `packages/ui/tests/component/explorer-toolbar.test.ts`, which was written as its replacement
 *   and says so in its own header. Assertion for assertion: the ordered control list
 *   (`['Expand', 'Collapse all', 'Quick Open', 'New folder', 'Delete']`), one `.icon` per button
 *   with no text outside it, the title naming the action and the live chord, and the click going
 *   through the ONE registered opener rather than opening a modal of its own. That last one is
 *   the same `requestQuickOpen` the chord uses, and the opener→modal half is asserted by
 *   `window-chord-resolution.e2e.ts:203` and by every `openQuickOpen()` in this feature.
 *
 * `:260` — the Key Bindings ROW → three covering tests, because it was three claims:
 *   `core/tests/unit/keybindings-metadata.test.ts` requires a non-empty label AND description of
 *   every descriptor, `navigate.quickOpen` included; `core/tests/unit/keybindings-scope.test.ts`
 *   asserts `COMMAND_SCOPES['navigate.quickOpen']` is all three scopes — which is what the
 *   `Everywhere` pill renders — and resolves the chord from each of them; and the ROW RENDERING
 *   itself (label, description, chord and scope cells) is `preferences-keybindings.e2e.ts:246`
 *   and `:257`, which stay. Nothing about that row was specific to Quick Open.
 *
 * `:287` — the rebind journey → the three-way split `tasks.md` prescribed, whose component half
 *   had already landed. The TITLE following a rebind is `explorer-toolbar.test.ts`’s "follows a
 *   REBIND, because it is computed from the bindings it is given", which also asserts the OLD
 *   chord GOES — a title built by appending would pass the first half and fail the second, and
 *   the user-visible defect is a tooltip advertising a shortcut that no longer works. The
 *   JOURNEY — preferences window, chord capture, pill removal, config hot-reload, both chords at
 *   a real surface — is `goto-line-keybinding.e2e.ts:152`, kept as the one journey precisely
 *   because it is the richer of the pair: it also proves the retired chord is INERT rather than
 *   merely quiet (the caret does not move). Both commands sit in the same `HANDLED` set in
 *   `app.tsx` and resolve through the same `resolveScoped` over the same live `useKeybindings()`,
 *   so there is one hot-reload path here, not two.
 *
 * That removes a whole `runOwnApp` launch and, with it, every preferences window this file used
 * to open — which was also the reason it is registered in the SERIAL tier. Whether it now belongs
 * in the parallel one is a `parallel-plan.json` decision and is not made here.
 *
 * ══ WHY THE BUTTON IS LOCATED BY ITS ACCESSIBLE NAME ══
 *
 * `helpers/navigation.ts` owns the locator and explains it: V3 requires the button’s `title` to
 * carry the command’s LIVE chord, so the title changes the moment the binding changes and a
 * title-based locator would break on the very rebind AS-17 is about. The `aria-label` is the
 * stable half.
 */
import { test, expect } from '@playwright/test';
import { runApp as runOwnApp, createProject as newProject, settle } from './harness.js';
import { createDeepTree, cleanupDeepTree } from './helpers/deep-tree.js';
import {
  QUICK_OPEN_CHORD,
  openQuickOpen,
  quickOpenToolbarButton,
} from './helpers/navigation.js';

/*
 * No shared app, because there is nothing left to share: the one test needs an application in
 * which NO PROJECT HAS EVER BEEN OPENED, and that state cannot be recovered from a shared one.
 */
test.describe.configure({ mode: 'serial' });

test('with no project open the button is DRAWN AND DISABLED, its tooltip says why and names no chord, and the chord opens nothing — and all three come alive once a project is opened (FR-018, FR-018c, FR-074, V4, A5)', { tag: ['@extended', '@editor'] }, async () => {
  const tree = createDeepTree('throng-qtb-noproject-');
  try {
    // Its OWN app, and this is the state that needs one: a shared app has had a project opened by
    // whichever test ran first, and "no project has ever been opened" cannot be recovered from that.
    await runOwnApp(async (_app, win) => {
      await settle(win);
      /*
       * The Files & Folders pane defaults to COLLAPSED when no project is open
       * (`throng.explorerVisibleNoProject`, app.tsx) — "the user may still expand it to its empty
       * placeholder". Expanding it is the state FR-018c is about: a button nobody can see is
       * neither drawn nor disabled, and the requirement is about what the user finds when they look.
       */
      await win.getByTestId('pane-show-right').click();
      await expect(win.getByTestId('file-explorer-empty')).toBeVisible();

      /*
       * DRAWN and DISABLED, not hidden (FR-018c, and the 2026-08-15 clarification that settles
       * "absent or disabled" for the temporarily-unavailable case). A control that vanishes teaches
       * the user nothing; one that is visibly unavailable explains itself in its hover title.
       */
      await expect(quickOpenToolbarButton(win)).toBeVisible();
      await expect(quickOpenToolbarButton(win)).toBeDisabled();

      /*
       * FR-074 — and the DISABLED tooltip says WHY, and names NO chord.
       *
       * FR-018a on its own requires the title to carry the command's current chord; FR-074 narrows
       * that to "whenever the button can act", because a disabled control should answer "why can I
       * not use this?" rather than recite a shortcut that would do nothing. Both halves are asserted,
       * because either alone passes for the wrong reason: a title that merely omitted the chord could
       * be empty, and a title that merely explained itself could still trail "(Ctrl+Shift+T)".
       *
       * The chord is read from `QUICK_OPEN_CHORD` in the form the tooltip renders it, so a rebind of
       * the default cannot leave this assertion checking a string nothing produces any more.
       */
      const disabledTitle = (await quickOpenToolbarButton(win).getAttribute('title')) ?? '';
      const shownChord = QUICK_OPEN_CHORD.replace('Control', 'Ctrl');
      expect(disabledTitle, 'the disabled tooltip must still name the action').toContain(
        'Quick Open',
      );
      expect(
        disabledTitle,
        'FR-074 — a disabled Quick Open button must say WHY it cannot be used',
      ).toContain('no project is open');
      expect(
        disabledTitle,
        'FR-074 — a disabled button must NOT recite a chord that would do nothing',
      ).not.toContain(shownChord);

      // A5 — the chord opens nothing either, and never lists a previous project's files.
      await win.keyboard.press(QUICK_OPEN_CHORD);
      await expect(win.getByTestId('quickopen')).toHaveCount(0);

      /*
       * …and the SAME chord, in the SAME app, opens the modal once a project exists.
       *
       * This half is what makes the half above evidence. A `toHaveCount(0)` on its own is satisfied
       * by a chord nothing has ever bound, by a window that is not listening, and by a test that
       * mistyped the chord — all three look identical. Proving the chord is live here rules them
       * out without waiting on a clock.
       */
      await newProject(win, 'QOToolbarNoProject', tree.root);
      await expect(quickOpenToolbarButton(win)).toBeEnabled();

      /*
       * FR-074's OTHER half, on the SAME button in the SAME app: once it can act, the chord is back.
       *
       * Without this the disabled assertion above is indistinguishable from a tooltip that never
       * names a chord at all — which would satisfy "a disabled button says why" while breaking
       * FR-018a everywhere else. The pair is what makes FR-074 a narrowing rather than a removal.
       */
      await expect(quickOpenToolbarButton(win)).toHaveAttribute(
        'title',
        new RegExp(shownChord.replace(/\+/g, '\\+')),
      );
      await expect(quickOpenToolbarButton(win)).not.toHaveAttribute('title', /no project is open/);

      await openQuickOpen(win);
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});
