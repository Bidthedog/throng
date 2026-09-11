/**
 * "Open In" — the editor targets a file can be sent to, described once and drawn twice.
 *
 * ══ WHY THIS MODULE EXISTS ══
 *
 * The file explorer has offered three targets for a file since 006: the tab's LAST ACTIVE editor
 * (006 FR-072, relabelled by 006 FR-098), a NEW dedicated editor (006 FR-072), and any OTHER TAB
 * (006 FR-030). It built them inline inside its own context-menu handler — the labels, both
 * disabled conditions, the panel-title suffix and the submenu shape all authored in one
 * `useCallback` that also did selection, terminal flavours and clipboard state.
 *
 * 043 FR-087 needs the same three targets on a Find in Files RESULT row, and its wording is a
 * constraint on the code rather than on the labels: *the same options that are available in the
 * file explorer*. Two menus computing their own labels and their own disabled conditions are two
 * implementations, and the copy is the one that drifts.
 *
 * ══ WHY THE PURE HALF IS ITS OWN MODULE ══
 *
 * Everything here is a function of plain data — no store, no DOM, no `window`, and no import that
 * reaches one. That is load-bearing twice over:
 *
 *   - It can be tested in the `unit` (node) tier with an object literal, where the whole decision
 *     is five booleans and a title. The store-touching half lives in `open-in-perform.ts`, which
 *     pulls in React and the workspace store and could not be imported here without dragging both
 *     into a node test.
 *   - The Find in Files panel deliberately holds NO workspace store — it says so where its opener
 *     is registered: "`useWorkspace()` here would make every one of this panel's component tests
 *     need a provider to assert a search term." So the shared thing cannot be a function taking a
 *     workspace. It has to be plain data the panel can receive across its own registration
 *     boundary, which is exactly what {@link OpenInFacts} and {@link OpenInTarget} are.
 */
import type { MenuAction } from '../workspace/context-menu.js';

/**
 * Which of the three a target is.
 *
 * `'tab'` carries a `tabId`; the other two act on the ACTIVE tab and carry none. A discriminated
 * kind rather than a bare tab id with two sentinel values, because "the active tab" and "some named
 * tab" are opened differently and a sentinel would make them the same type.
 */
export type OpenInTargetKind = 'lastActive' | 'new' | 'tab';

/** One target, fully described: what it is, what it says, and whether it can be chosen. */
export interface OpenInTarget {
  kind: OpenInTargetKind;
  /** Present exactly when `kind` is `'tab'`. */
  tabId?: string;
  /** The row's text, already carrying whatever the target names (a panel title, a tab title). */
  label: string;
  /**
   * Drawn and unavailable, never hidden (Constitution VI).
   *
   * An action that exists and is disabled teaches what the menu can do; one that vanishes teaches
   * nothing — the explorer's own Undo row carries that reasoning in as many words, and it applies
   * unchanged to a target that would be a no-op.
   */
  disabled: boolean;
}

/**
 * The five facts the decision turns on — and deliberately nothing else.
 *
 * Plain data because the Find in Files panel receives this across a registration boundary: its
 * chrome reads the stores, the panel draws the menu, and neither needs the other's imports.
 */
export interface OpenInFacts {
  /** `undefined` when the window has no active tab — every target is then unavailable. */
  activeTabId: string | undefined;
  /** The OTHER tabs, already filtered of the active one, in layout order. */
  otherTabs: readonly { id: string; title: string }[];
  /** The panel title of the active tab's last active editor; `undefined` when there is none. */
  lastActiveEditorTitle: string | undefined;
  /**
   * Whether that last active editor ALREADY holds this exact file, which makes opening a no-op.
   *
   * DISTINCT FROM `alreadyOpen`, and the two must stay independent: this one is about a single
   * named panel (006 FR-082), and it is the only thing that disables the last-active target while
   * leaving the others live. A file open in some OTHER editor leaves this false.
   */
  lastActiveHoldsFile: boolean;
  /**
   * Whether the file is open in ANY editor, app-wide (006 FR-011a).
   *
   * The one-buffer rule: a second buffer is never created, so both targets that would have to
   * create one are unavailable. The last-active target is NOT gated on this — it reuses an editor
   * rather than creating one, and the route it takes focuses the existing buffer instead.
   */
  alreadyOpen: boolean;
}

/**
 * Facts → targets. Pure.
 *
 * The order is the order the menu draws, and it is fixed HERE rather than at either call site: the
 * target that replicates an ordinary click first, the one that forces a new panel second, the other
 * tabs last. A caller free to re-order would put the same command in a different place depending on
 * which surface opened the menu, which is precisely the drift this module exists to prevent.
 */
export function describeOpenInTargets(facts: OpenInFacts): OpenInTarget[] {
  const { activeTabId, otherTabs, lastActiveEditorTitle, lastActiveHoldsFile, alreadyOpen } = facts;
  const noTab = activeTabId === undefined;

  const targets: OpenInTarget[] = [
    {
      kind: 'lastActive',
      // 006 FR-098 — the label NAMES the panel the file would land in when there is one to name.
      // A target whose destination is invisible is the same defect the commit rows in
      // `find-in-files/content-menu.ts` carry a comment about: a menu aimed at something the user
      // cannot see.
      label: lastActiveEditorTitle
        ? `Last Active Editor (${lastActiveEditorTitle})`
        : 'Last Active Editor',
      // 006 FR-082 — a no-op, NOT the app-wide rule. Deliberately not `alreadyOpen`.
      disabled: noTab || lastActiveHoldsFile,
    },
    {
      kind: 'new',
      label: 'New Editor',
      // 006 FR-072 with 006 FR-011a — disabled when the file is open ANYWHERE, because opening it
      // here would be the second buffer the one-buffer rule forbids.
      disabled: noTab || alreadyOpen,
    },
  ];

  // No other tabs → nothing is pushed, so `openInMenuActions` draws no parent at all. This is the
  // one place a row is ABSENT rather than disabled, and the reason is that it names a SET:
  // Constitution VI draws a temporarily-unavailable control and omits a structurally meaningless
  // one, and a flyout over an empty set is the second, not the first.
  for (const tab of otherTabs) {
    targets.push({ kind: 'tab', tabId: tab.id, label: tab.title, disabled: noTab || alreadyOpen });
  }

  return targets;
}

/**
 * Targets → menu rows. Pure.
 *
 * `pick` rather than an `onClick` bound per target, because the two callers perform a target
 * differently: the explorer holds the workspace store and performs immediately, while the Find in
 * Files panel hands the chosen target back through its registered opener. Binding the action here
 * would force the panel to import the editor, which is the dependency it does not have.
 *
 * Every Open In target takes you somewhere, so the whole group is one section and therefore
 * divider-free — `ContextMenu` derives dividers from section boundaries, and there is only one
 * boundary to derive when every row says `navigate`.
 */
export function openInMenuActions(
  targets: readonly OpenInTarget[],
  pick: (target: OpenInTarget) => void,
): MenuAction[] {
  const rows: MenuAction[] = [];
  const tabs = targets.filter((t) => t.kind === 'tab');

  for (const target of targets) {
    if (target.kind === 'tab') continue;
    rows.push({
      label: target.label,
      /*
       * NO `testId` OVERRIDE, deliberately — and this is the one place this codebase's usual rule
       * loses.
       *
       * Everywhere else a test id is derived from the ACTION rather than the label, because a label
       * naming a moving target makes the id a statement about the current layout;
       * `find-in-files/content-menu.ts` says exactly that about its commit rows, and by that rule
       * these two should read `menu-item-open-in-lastActive` and `menu-item-open-in-new`.
       *
       * They must not, because the default `menu-item-<label>` id is already load-bearing: live
       * end-to-end specs use `menu-item-New Editor` as their ROUTE to a second editor panel, and
       * the component suite asserts the composed `menu-item-Last Active Editor (Scratch)` to prove
       * the panel-title suffix is composed rather than constant. Renaming here would turn an
       * extraction into a multi-file test migration — which is the temptation `MenuAction.testId`'s
       * own doc comment exists to warn about, pointing the other way.
       */
      icon: 'add',
      section: 'navigate',
      disabled: target.disabled,
      onClick: () => pick(target),
    });
  }

  if (tabs.length > 0) {
    rows.push({
      label: 'Other Tab',
      icon: 'tab',
      section: 'navigate',
      submenu: tabs.map((target) => ({
        label: target.label,
        icon: 'tab',
        section: 'navigate' as const,
        disabled: target.disabled,
        onClick: () => pick(target),
      })),
    });
  }

  return rows;
}
