/**
 * "Open In" — reading the facts from the live stores, and performing a chosen target.
 *
 * The half of 043 FR-087 that touches the workspace store, the editor state and `openFileInTab`.
 * `open-in-targets.ts` holds the pure half and imports none of this: the split is what lets the
 * decision be unit-tested with an object literal, and what lets the Find in Files panel — which
 * deliberately holds no workspace store — receive plain data across its own registration boundary
 * instead of calling in here.
 */
import { collectPanels, normaliseFolder } from '@throng/core';
import { openFileInTab } from './editor-open.js';
import { getEditorState } from './editor-state.js';
import { getLastActiveEditor } from './last-active-editor.js';
import type { OpenInFacts, OpenInTarget } from './open-in-targets.js';
import type { RevealRange } from './reveal-range.js';

/** The workspace slice this needs — whatever `openFileInTab` takes, and nothing more. */
export type OpenInWorkspace = Parameters<typeof openFileInTab>[0];

/**
 * Read the five facts from the live stores.
 *
 * SYNCHRONOUS ON PURPOSE, with `alreadyOpen` passed in rather than awaited here. That question goes
 * to main — the one-buffer rule is app-wide, so a file open in ANOTHER window must disable the two
 * targets that would create a second copy in this one — and awaiting it in the middle of this
 * function would put an `await` between reading the layout and reading the editor state, which is a
 * window in which the layout can move. The caller awaits it first and hands the answer in, so every
 * fact below is sampled from one consistent moment.
 */
export function readOpenInFacts(
  ws: OpenInWorkspace,
  absPath: string,
  alreadyOpen: boolean,
): OpenInFacts {
  const layout = ws.layout;
  const activeTabId = layout?.activeTabId;
  const tabs = layout?.tabs ?? [];
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const lastActiveEditor = activeTabId ? getLastActiveEditor(activeTabId) : undefined;
  // The panel the STORE says was last active, which is not the same as the tab's `activePanelId` —
  // `explorer-open-in-target.test.ts` pins that difference deliberately.
  const panel =
    lastActiveEditor && activeTab
      ? collectPanels(activeTab.root).find((p) => p.id === lastActiveEditor)
      : undefined;

  const heldPath = lastActiveEditor ? getEditorState(lastActiveEditor)?.filePath : undefined;

  return {
    activeTabId: activeTabId ?? undefined,
    otherTabs: tabs.filter((t) => t.id !== activeTabId).map((t) => ({ id: t.id, title: t.title })),
    lastActiveEditorTitle: panel?.title,
    // `normaliseFolder` on BOTH sides: one path came out of a store and the other was built by
    // string concatenation from a project root, so on Windows they genuinely differ in separator
    // and case while naming the same file. There is a test that pins exactly that.
    lastActiveHoldsFile: heldPath != null && normaliseFolder(heldPath) === normaliseFolder(absPath),
    alreadyOpen,
  };
}

/**
 * Perform a chosen target.
 *
 * ALL THREE GO THROUGH `openFileInTab`, INCLUDING "NEW EDITOR" (043 FR-089). That is not a
 * shortcut. It is the route that already performs, in order: the app-wide one-buffer check, a
 * REFUSED open (041 FR-013, #327), focusing an editor that already holds the file, activating the
 * destination tab, forcing a brand-new dedicated editor when the target says so, the four-choice
 * prompt over a dirty editor, and revealing `range` in whichever panel the file actually landed in.
 *
 * The explorer used to hand-roll the first three of those around `openFileInNewEditor`, because
 * that function is synchronous and asks nothing — which is precisely how it came to bypass the
 * refusal check and become #327. 041 FR-013d answered that by requiring a gate AT THE CALL SITE,
 * *because* it was the one caller not routing through `openFileInTab`. Routing through it removes
 * the premise rather than disagreeing with the rule: `openFileInNewEditor` then has no caller left
 * but `openFileInTab` itself, and it stays synchronous and ungated exactly as FR-013d requires.
 *
 * `range` is 043's addition. A result row names a place INSIDE the file, and the reveal has to
 * happen in the panel the open chose — which is the one thing the caller cannot know, because it is
 * decided branch by branch in there.
 */
export async function performOpenIn(args: {
  ws: OpenInWorkspace;
  absPath: string;
  target: OpenInTarget;
  range?: RevealRange;
}): Promise<boolean> {
  const { ws, absPath, target, range } = args;

  if (target.kind === 'tab') {
    // A named tab reuses THAT tab's last active editor, which is what the explorer's Other Tab has
    // always done. `openFileInTab` activates the tab on the way.
    return target.tabId ? openFileInTab(ws, target.tabId, absPath, 'lastActive', range) : false;
  }

  const activeTabId = ws.layout?.activeTabId;
  if (!activeTabId) return false;
  return openFileInTab(ws, activeTabId, absPath, target.kind === 'new' ? 'new' : 'lastActive', range);
}
