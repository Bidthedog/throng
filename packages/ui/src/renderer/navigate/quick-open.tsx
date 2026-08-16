/**
 * Quick Open (033 US1, #219) — the seeding of the shared picker with this project's file paths.
 *
 * ══ WHAT THIS FILE DOES NOT DO, AND WHY THAT IS THE REQUIREMENT ══
 *
 * **It implements no modal behaviour of its own.** FR-065 asks for focus on open, Escape to dismiss
 * and focus restored to wherever the user came from — and all three are inherited from
 * `common/picker.tsx`, which has carried them since 031 behind `useFocusTrap` and its render-phase
 * capture of `document.activeElement`. Written down here because an inherited requirement with
 * nothing said about it reads at review as an unmet one, and the next author's instinct on finding
 * no focus code is to add some.
 *
 * **It implements no opening of its own either.** Every choice ends in `openFileInTab` — the same
 * function the file tree calls (contracts/navigation-modals.md §3), and the one that decides between
 * reusing an editor and creating one. That is what makes SC-004 provable rather than promised: the
 * one-buffer rule (Q2), the unsaved-changes prompt (Q3) and creating a tab's first editor (Q4) are
 * not re-implemented here, so they cannot drift from the tree's version of themselves.
 * Re-implementing any of them is precisely the defect FR-008 exists to prevent.
 *
 * That was stated here before it was true of the `new` target, which called `openFileInNewEditor`
 * directly and so skipped the one-buffer gate — see the note on `choose` below. Reaching PAST the
 * router for one branch is the same defect as re-implementing it, and it reads as neither.
 *
 * ══ TYPING COSTS NOTHING ══
 *
 * The candidate array is already in memory (`useFileIndex`, R5). A keystroke filters and ranks it and
 * touches no IPC at all — `quick-open-perf.e2e.ts` counts the messages to prove it.
 */
import { useMemo, useRef, useState, type ReactElement } from 'react';
import {
  QUICK_OPEN_MAX_ROWS,
  formatGrouped,
  rankFilePath,
  type EditorOpenTarget,
} from '@throng/core';
import { Picker, type PickerEntry } from '../common/picker.js';
import { useAppSettings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { openFileInTab } from '../editor/editor-open.js';
import { getLastActiveEditor } from '../editor/last-active-editor.js';
import { requestPanelFocus } from '../workspace/panel-focus.js';
import { rememberQuickOpenQuery, rememberedInput } from './navigation-store.js';
import type { FileIndexView } from './use-file-index.js';
import { QuickOpenTarget } from './quick-open-target.js';
import { QuickOpenHidden } from './quick-open-hidden.js';

export function QuickOpen({
  root,
  index,
  invokedFrom,
  includeHidden,
  onIncludeHiddenChange,
  onDismiss,
}: {
  /** This window's project root, absolute and OS-form. Never null — A5 refuses to open without one. */
  root: string;
  /**
   * The candidate set, subscribed by `NavigationChrome` for as long as the window has a root.
   *
   * Passed IN rather than subscribed here, and the reason is behavioural rather than structural: a
   * subscription scoped to this component's lifetime is dropped every time the modal closes, and
   * UI-main disposes a root's index on its last unsubscribe (S9) — so every invocation would pay
   * for a fresh walk of the whole project. On a large one that is a visible stall each time the
   * chord is pressed, which is the opposite of what FR-013 promises; on a small one it is a race
   * between the walk and the user's first keystroke, which is worse, because it passes.
   */
  index: FileIndexView;
  /** The editor panel the chord came from, or `null` from a terminal, the tree or a placeholder. */
  invokedFrom: { editorPanelId: string } | null;
  /**
   * FR-069 — is this search seeing what the project hides?
   *
   * Held by `NavigationChrome` rather than here, because it selects WHICH INDEX the window mirrors
   * (`index` above is already the one it chose). A copy in this component would be a second source
   * of truth for a question main is answering, and the two would disagree for one render every time
   * the toggle moved.
   */
  includeHidden: boolean;
  onIncludeHiddenChange: (next: boolean) => void;
  onDismiss: () => void;
}): ReactElement {
  const ws = useWorkspace();
  const settings = useAppSettings();
  const openTarget = settings.editor.openTarget;
  // FR-058 — read LIVE, so a toggle takes effect at the next invocation with nothing to notify.
  const remember = settings.editor.navigation.rememberQuickOpenQuery;

  /*
   * The target control's value, in a REF rather than in state.
   *
   * It is read once, at the moment a row is chosen, and nothing else depends on it — so holding it
   * in React state would re-render the whole list (up to 200 rows) every time the user toggled the
   * control. The control redraws itself from its own state; this is only the value the choice reads.
   */
  const target = useRef<EditorOpenTarget>(openTarget);

  /*
   * One entry per indexed path, with `id`, `text` and `label` all the root-relative POSIX path
   * (data-model.md §4). `text === label` is deliberate and load-bearing: the picker computes its
   * marked runs against the LABEL, so a label that differed from the matched text would mark the
   * wrong characters or none at all.
   */
  const entries = useMemo<PickerEntry[]>(
    () => index.paths.map((path) => ({ id: path, text: path, label: path })),
    [index.paths],
  );

  /*
   * FR-057 / FR-060 — the seeded query, read ONCE at mount.
   *
   * `useState`'s initialiser rather than a plain read, so a re-render (a keystroke, an index delta,
   * the toggle moving) cannot re-seed the picker from under a query the user is halfway through
   * typing. The settings are read live, which is what makes FR-063's "takes effect at the next
   * invocation" true without anything having to be notified: this component mounts per invocation.
   *
   * When the setting is off this is `''`, and `Picker` treats an empty seed as no seed at all — so
   * the shipped default (FR-057) costs no branch here.
   */
  const [initialQuery] = useState(() =>
    remember ? (rememberedInput().quickOpenQuery ?? '') : '',
  );

  const choose = (entry: PickerEntry, query: string): void => {
    const tabId = ws.layout?.activeTabId;
    // Q5 — the modal's job ends with the choice, and it closes BEFORE the open is routed: a dirty
    // target raises the shipped unsaved-changes prompt (Q3), and two focus traps on screen at once
    // is a fight neither wins.
    onDismiss();
    if (!tabId) return;

    // Q1 — the absolute path is this window's own root plus the relative path, and nothing else.
    const absPath = `${root.replace(/[\\/]+$/, '')}/${entry.id}`;

    void (async () => {
      /*
       * ONE call, for both target values — FR-008.
       *
       * With no target control the landing panel follows `editor.openTarget` (FR-009, FR-011); with
       * one, it follows what the control says. `openFileInTab` takes the value either way and owns
       * the routing, which is the whole of FR-008: "the same path the tree already uses, inheriting
       * every check it makes".
       *
       * It used to call `openFileInNewEditor` directly for the `new` case, and that skipped the
       * FIRST of those checks. That function is documented as a FORCE — "the caller gates on the
       * file not already being open anywhere (app-wide one-buffer, FR-011a)" — and the tree, its
       * only other caller, honours the contract by DISABLING the menu item when the file is open.
       * Quick Open inherited the route without the precondition, so choosing an already-open file
       * with the control on "a new editor panel" opened a second editor on it: two panels, two
       * views, one file — exactly what FR-011a and AS-9 forbid, and reported from hand-testing.
       *
       * The gate is fixed HERE rather than inside `openFileInNewEditor` deliberately. That function
       * means "force a new panel"; making it silently not force would change a shipped contract
       * under a caller that has already done the check, and would turn a synchronous call into an
       * asynchronous one for both. The defect is that Quick Open bypassed the router, so the fix is
       * to stop bypassing it — after which `openFileInTab`'s own `openTarget === 'new'` branch calls
       * `openFileInNewEditor`, on the far side of the one-buffer gate, exactly as it always has.
       */
      const opened = await openFileInTab(
        ws,
        tabId,
        absPath,
        invokedFrom === null ? openTarget : target.current,
      );

      /*
       * FR-061 — the query is ACCEPTED here, and nowhere else.
       *
       * "Accepted" is a file having OPENED, which is why this sits after the await and reads the
       * router's answer rather than running before it. Choosing a row is not enough: the route asks
       * about unsaved changes (Q3), and a user who says Cancel — or chooses Save and watches the
       * save fail — has opened nothing. Recording above the await remembered the query for a file
       * that never appeared, which contradicts FR-061 and, more visibly, the sentence the user reads
       * in the settings editor: "the last query that actually opened a file".
       *
       * The property that made the original placement good is kept intact: a DISMISSAL still has no
       * code path to `rememberQuickOpenQuery` at all. `choose` is reachable only from Enter-on-input
       * and a row `mousedown`; Escape, the scrim and the slot being taken by Go To Line never enter
       * this function. Nothing here filters a dismissal out — there is nothing to filter.
       *
       * Gated on the SETTING as well, so that at the shipped defaults this store holds nothing at all
       * rather than holding something it declines to show. The consequence is deliberate: switching
       * the setting on mid-session starts remembering from the next accepted query, and never
       * resurfaces one from before the switch — which is the same promise FR-063 makes in the other
       * direction, and the one a user who has just changed their mind about this would expect.
       */
      if (!opened) return;
      if (remember) rememberQuickOpenQuery(query, root);

      /*
       * Put the caret where the file went.
       *
       * The picker restores focus to wherever the user came from as it unmounts (FR-065, and right
       * for a DISMISSAL) — but this is not a dismissal, it is a file being opened, and leaving the
       * caret behind in the terminal the user has just navigated away from would make every Quick
       * Open a two-step gesture. The landing panel is read from the tab's last-active-editor
       * registry, which every branch of the open route above has just updated, rather than guessed.
       *
       * Behind the `!opened` return above, so it too is a consequence of a file having opened. A
       * cancelled open leaves the caret where the picker put it back, which is the same place a
       * dismissal leaves it — nothing opened, so nothing moves.
       */
      const landed = getLastActiveEditor(tabId);
      if (landed) requestPanelFocus(landed);
    })();
  };

  return (
    <Picker
      title="Quick Open"
      /*
       * `quickopen`, one word — matching `tabpicker`'s precedent (031) and leaving
       * `[data-testid^="quick-"]` free. Fixed by contracts/picker-extensions.md §5, not chosen here:
       * four E2E specs already select on the ids this prefix derives.
       */
      testId="quickopen"
      placeholder="Type part of a file path…"
      /*
       * FR-060 — the restored query is seeded into the CONTROL, not merely into the input.
       *
       * That is the whole point of using `initialQuery` rather than setting the field's text: the
       * picker filters, ranks and marks from its own query state, so the modal opens showing that
       * query's RESULTS (P5/P6) instead of a full list with stale text above it. The selection is
       * the picker's too — it selects a seeded query on first focus, so the first keystroke replaces
       * it outright and no keystroke is spent clearing it.
       */
      initialQuery={initialQuery}
      entries={entries}
      rank={rankFilePath}
      maxRows={QUICK_OPEN_MAX_ROWS}
      truncatedMessage={(shown, total) =>
        `Showing ${formatGrouped(shown)} of ${formatGrouped(total)} matches`
      }
      emptyMessage="No files match"
      /*
       * FR-015 / S3 / FR-069d — a candidate set that is still being built SAYS SO, whether or not
       * there are rows underneath it.
       *
       * It was `emptyMessage` until it had to cover both cases, and that was wrong in a way only the
       * second case showed. Opened mid-walk there are no paths at all, so an either/or with the rows
       * looked identical to this — but flipping the exclusion toggle borrows the previous list while
       * the wider one builds (`navigation-chrome.tsx`), and the rows it borrows are one filter
       * NARROWER than the ones asked for. With the line rendering only at zero rows the borrow was
       * silent: a partial list presented as whole, which is the single thing FR-069d prohibits.
       *
       * `undefined` — not an empty string — once the index is ready, so the picker's own K12 "No
       * files match" comes back for a query that genuinely matches nothing.
       */
      notice={
        index.status === 'ready' ? undefined : (
          <span className="picker__building" data-testid="quickopen-building">
            Still listing this project’s files…
          </span>
        )
      }
      /*
       * The header row, built UNCONDITIONALLY (FR-069).
       *
       * It used to be `undefined` whenever the chord did not come from an editor, because the target
       * control was its only occupant. The exclusion toggle is drawn ALWAYS — a project's hidden
       * files are no more relevant from an editor than from the tree — so the row exists whenever
       * the modal does, and FR-011 now governs one control inside it rather than the row itself.
       */
      header={
        <div className="picker__header">
          {/*
           * The toggle is FIRST, and the order is a keyboard decision rather than a visual one.
           *
           * `Shift+Tab` from the query input reaches the LAST control in the header, and E5 / AS-11b
           * fix that as the target button — a shipped behaviour with a shipped assertion. Drawing the
           * new control after it would have quietly re-pointed that chord at something else, which is
           * the sort of change that passes review because nobody thinks of tab order as an interface.
           * Reading order follows: scope first ("which files am I searching?"), destination second
           * ("where does the one I pick land?").
           */}
          <QuickOpenHidden includeHidden={includeHidden} onChange={onIncludeHiddenChange} />
          {/* T3 / FR-011 — "the currently active editor" has no meaning from a terminal or the
              tree, so this half stays conditional. */}
          {invokedFrom === null ? null : (
            <QuickOpenTarget
              initial={openTarget}
              // FR-068 — the button names its destination panel, so it needs to know which one.
              panelId={invokedFrom.editorPanelId}
              onChange={(next) => {
                target.current = next;
              }}
            />
          )}
        </div>
      }
      onChoose={choose}
      onDismiss={onDismiss}
    />
  );
}
