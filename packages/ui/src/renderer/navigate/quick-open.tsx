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
 * **It implements no opening of its own either.** Every choice ends in `openFileInTab` or
 * `openFileInNewEditor` — the same two functions the file tree calls (contracts/navigation-modals.md
 * §3). That is what makes SC-004 provable rather than promised: the one-buffer rule (Q2), the
 * unsaved-changes prompt (Q3) and creating a tab's first editor (Q4) are not re-implemented here, so
 * they cannot drift from the tree's version of themselves. Re-implementing any of them is precisely
 * the defect FR-008 exists to prevent.
 *
 * ══ TYPING COSTS NOTHING ══
 *
 * The candidate array is already in memory (`useFileIndex`, R5). A keystroke filters and ranks it and
 * touches no IPC at all — `quick-open-perf.e2e.ts` counts the messages to prove it.
 */
import { useMemo, useRef, type ReactElement } from 'react';
import {
  QUICK_OPEN_MAX_ROWS,
  formatGrouped,
  rankFilePath,
  type EditorOpenTarget,
} from '@throng/core';
import { Picker, type PickerEntry } from '../common/picker.js';
import { useAppSettings } from '../config/config-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { openFileInNewEditor, openFileInTab } from '../editor/editor-open.js';
import { getLastActiveEditor } from '../editor/last-active-editor.js';
import { requestPanelFocus } from '../workspace/panel-focus.js';
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
  const openTarget = useAppSettings().editor.openTarget;

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

  const choose = (entry: PickerEntry): void => {
    const tabId = ws.layout?.activeTabId;
    // Q5 — the modal's job ends with the choice, and it closes BEFORE the open is routed: a dirty
    // target raises the shipped unsaved-changes prompt (Q3), and two focus traps on screen at once
    // is a fight neither wins.
    onDismiss();
    if (!tabId) return;

    // Q1 — the absolute path is this window's own root plus the relative path, and nothing else.
    const absPath = `${root.replace(/[\\/]+$/, '')}/${entry.id}`;

    void (async () => {
      if (invokedFrom !== null && target.current === 'new') {
        openFileInNewEditor(ws, tabId, absPath);
      } else {
        // With no target control the landing panel follows `editor.openTarget` (FR-009, FR-011);
        // with one, it follows what the control says. Both are the SAME call.
        await openFileInTab(ws, tabId, absPath, invokedFrom === null ? openTarget : 'lastActive');
      }
      /*
       * Put the caret where the file went.
       *
       * The picker restores focus to wherever the user came from as it unmounts (FR-065, and right
       * for a DISMISSAL) — but this is not a dismissal, it is a file being opened, and leaving the
       * caret behind in the terminal the user has just navigated away from would make every Quick
       * Open a two-step gesture. The landing panel is read from the tab's last-active-editor
       * registry, which every branch of the open route above has just updated, rather than guessed.
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
      entries={entries}
      rank={rankFilePath}
      maxRows={QUICK_OPEN_MAX_ROWS}
      truncatedMessage={(shown, total) =>
        `Showing ${formatGrouped(shown)} of ${formatGrouped(total)} matches`
      }
      /*
       * FR-015 / S3 — a modal opened before enumeration finishes SAYS SO, and then shows the real
       * list. It renders where results would be, so the space is never occupied by a partial list
       * presented as a whole one: while the walk is in flight there are no paths at all.
       */
      emptyMessage={
        index.status === 'ready' ? (
          'No files match'
        ) : (
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
