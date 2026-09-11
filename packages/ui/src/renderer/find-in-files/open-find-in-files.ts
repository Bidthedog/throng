/**
 * Opening — or reusing — a Find in Files panel (043 T069, FR-020/FR-021/FR-022, FR-029d, FR-031a–c).
 *
 * ══ WHY THE ROUTE IS PART OF THE REQUEST ══
 *
 * Three gestures reach this file: the two chords, the explorer-toolbar control (FR-029a) and the
 * tree's Open In → Search submenu (FR-090, which replaced FR-029b's folder row). They open the same
 * panel by the same rules. They differed in exactly one thing until round five — whether the input is
 * SEEDED from the focused panel's selection — and now differ in a second: the tree's route RESETS the
 * panel rather than running a search (FR-091). On seeding, FR-031a says
 * the chord seeds; FR-031b says the other two must not, because neither is invoked from a text
 * selection and seeding from a stale one would overwrite the live term of a panel being reused.
 *
 * So the route travels with the request rather than the seed doing. A caller that passed a seed
 * would be making that decision at three call sites, and the third one added later would get it
 * wrong silently — the user would right-click a folder and find their search term replaced by
 * whatever happened to be selected in an editor behind them.
 *
 * ══ WHY THE OPENER IS REGISTERED RATHER THAN CALLED ══
 *
 * Exactly `navigate/navigation-store.ts`'s reason. Opening needs the workspace store, the project
 * list and the live settings, and two of the three call sites have none of them: the window-level
 * chord listener in `app.tsx` has no route into a component's state, and the explorer toolbar is
 * rendered by a pane that has no workspace store. `FindInFilesChrome` holds all three and registers
 * how to open; everyone else asks.
 *
 * ══ WHY THE STORE STATE IS CREATED HERE AND NOT LEFT TO THE PANEL ══
 *
 * A new panel is created by a LAYOUT mutation, and its React component mounts a commit later. Until
 * then `find-in-files-store.ts` holds nothing for that id, so `invokeFindInFiles` — which refuses to
 * resurrect a panel that does not exist — would drop the seed, the scope and the run on the floor.
 * `ensureFindInFilesPanel` is idempotent, so creating the state here and letting the component's own
 * call find it already there is the same panel either way.
 */
import {
  collectPanels,
  effectiveActivePanelId,
  FIND_IN_FILES_KIND,
  isPanel,
  type FindInFilesPanelConfig,
  type Grouping,
  type PanelConfig,
  type PanelKind,
  type WorkspaceLayout,
} from '@throng/core';
import { getPanelSearch } from '../search/search-controller.js';
import {
  ensureFindInFilesPanel,
  invokeFindInFiles,
  resetFindInFilesPanel,
  setFindInFilesReplaceEnabled,
  setFindInFilesScope,
} from './find-in-files-store.js';
import { getLastActiveFindInFiles, setLastActiveFindInFiles } from './last-active-find-in-files.js';

/** Where the request came from. It decides seeding and nothing else (FR-031a, FR-031b). */
export type FindInFilesRoute = 'chord' | 'toolbar' | 'contextMenu';

export interface FindInFilesRequest {
  route: FindInFilesRoute;
  /**
   * FR-029d / FR-077 — replace in files is the SAME command with replace pre-enabled, not a second
   * panel model. It reuses a panel by the same rules, and the chord DECIDES the disclosure in both
   * directions: replace in files leaves the row shown, find in files leaves it hidden.
   */
  replace: boolean;
  /**
   * Where the search will look, root-relative, `''` for the whole project — or absent to leave a
   * reused panel's scope as it is, which only the chord does.
   *
   * The tree's route (043 FR-090) sends the right-clicked FILE or folder; the toolbar sends `''`
   * (FR-029a). The toolbar used to send nothing, and a reused panel then went on searching whatever
   * folder it last had — against FR-029a's "a search over the whole project".
   */
  scopeSubPath?: string;
}

/**
 * The slice of the workspace store this file needs.
 *
 * Named structurally rather than importing `WorkspaceContextValue`, so the pure opener below can be
 * driven from a test with a handful of spies instead of a mounted provider. The real store
 * satisfies it by having the same members.
 */
export interface FindInFilesWorkspace {
  layout: WorkspaceLayout | null;
  addPanel(tabId: string): string;
  clearLastAddedPanel(): void;
  setPanelType(panelId: string, kind: PanelKind, config: PanelConfig): void;
  setActivePanel(tabId: string, panelId: string): void;
}

export interface OpenFindInFilesArgs extends FindInFilesRequest {
  ws: FindInFilesWorkspace;
  /** The project this panel will search. `null` — no project open — makes the whole call inert. */
  projectId: string | null;
  projectRoot: string | null;
  /** `search.inFiles.openTarget` (FR-021), evaluated within the current Tab only (FR-022). */
  openTarget: 'lastActive' | 'new';
  /** What a freshly-created panel groups by (FR-033a/FR-033b), resolved by the caller. */
  grouping: Grouping;
}

/**
 * Open or reuse a Find in Files panel in the CURRENT tab, and invoke a search in it.
 *
 * Returns the panel it acted on, or `null` when there was nothing to act on — no layout, no active
 * tab, or no project (FR-029e, where the chord must do nothing and raise no notice).
 */
export function openFindInFiles(args: OpenFindInFilesArgs): string | null {
  const { ws, projectId, projectRoot, openTarget, grouping, route, replace } = args;
  const layout = ws.layout;
  if (!layout) return null;
  const tabId = layout.activeTabId;
  if (tabId === null || tabId === undefined) return null;
  const tab = layout.tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  /*
   * FR-029e — with no project open BOTH chords do nothing, and no notice is raised. There is
   * nothing to search: every Find in Files panel belongs to exactly one project (FR-018), so a
   * panel opened here would have nowhere to look and no way to say so. A disabled control has
   * already said why nothing happened on the two visible routes; a chord says it by doing nothing.
   */
  if (projectRoot === null || projectRoot === '') return null;

  /*
   * FR-031a — the seed, and ONLY on a chord.
   *
   * Read through the panel search registry rather than from the DOM, so a single-line selection in
   * an editor and one in a terminal are answered by the same question the find bar asks (013
   * FR-002b, applied unchanged to this surface rather than restated as a second seeding rule).
   */
  const seedTerm =
    route === 'chord' ? (getPanelSearch(effectiveActivePanelId(tab) ?? '')?.seedFromSelection() ?? '') : '';

  const targetId = existingPanel(tab, openTarget) ?? createPanel(ws, tabId, projectId);

  /*
   * The store state, before anything is asked of it — see the header. A panel created a moment ago
   * has no React component yet, and `invokeFindInFiles` will not resurrect a panel it cannot find.
   */
  ensureFindInFilesPanel(targetId, { projectId, projectRoot, grouping });
  setLastActiveFindInFiles(tabId, targetId);
  ws.setActivePanel(tabId, targetId);

  /*
   * 043 FR-091 — the tree's *Open In → Search* route does not invoke a search. It RESETS the panel.
   *
   * It used to take the path below like every other route: retarget the scope, keep the term, and
   * re-run it (FR-043a). The request asked for the opposite — the boxes and the results cleared and
   * the scope filled — so this route ends here, in one state whether the panel was reused or made a
   * moment ago. The chord and the toolbar are untouched and still re-run a reused panel's term.
   *
   * `''` for an absent scope rather than "leave it": the route always names a node, and the root
   * node's path IS `''`, so an absent scope on this route could only be a caller's mistake — and
   * the safe reading of a mistake here is the whole project, not whatever the panel last searched.
   */
  if (route === 'contextMenu') {
    resetFindInFilesPanel(targetId, { scopeSubPath: args.scopeSubPath ?? '', replace });
    return targetId;
  }

  // FR-029a — a route that NAMES a scope sets it: the toolbar names the whole project, `''`. The
  // chord names none and leaves a reused panel's scope alone. Retargeting starts nothing on its own,
  // which is why it is set BEFORE the invocation rather than after it. (This was FR-029b's folder,
  // until round five moved that route into the reset above.)
  if (args.scopeSubPath !== undefined) setFindInFilesScope(targetId, args.scopeSubPath);
  /*
   * FR-029d + FR-077 — the disclosure follows the CHORD, in both directions.
   *
   * This was `if (replace) …`, with a comment declining the off-direction on the grounds that find
   * in files is not a command to put replace away. FR-077 decides the other way, and the argument
   * that changed is about what the two chords ARE: they are one command with one difference, so a
   * panel reached by find and a panel reached by replace should be distinguishable by looking at
   * them. Under the old asymmetry a panel that had once been reached by replace stayed disclosed
   * forever, and pressing find gave the user a replace row they had not asked for over results they
   * had — with the caret in the search field above it.
   *
   * Nothing is lost by hiding, which is what makes the symmetry affordable: the replacement TEXT
   * stays in this panel's state, FR-027b restores the toggle across a restart, and FR-046's own
   * control is still how a user discloses the row deliberately. Only what is on screen changes.
   */
  setFindInFilesReplaceEnabled(targetId, replace);

  invokeFindInFiles(targetId, { seedTerm, focus: replace ? 'replacement' : 'search' });
  return targetId;
}

/**
 * The panel FR-021 would reuse, or `undefined` when there is none to reuse.
 *
 * FR-022 is the whole of why this looks only inside `tab`: the preference is evaluated within the
 * CURRENT Tab, so a tab holding no Find in Files panel gets a new one whatever the preference says,
 * and a panel in another tab never receives the search.
 */
function existingPanel(
  tab: WorkspaceLayout['tabs'][number],
  openTarget: 'lastActive' | 'new',
): string | undefined {
  if (openTarget === 'new') return undefined;
  const here = collectPanels(tab.root).filter((p) => isPanel(p) && p.kind === FIND_IN_FILES_KIND);
  if (here.length === 0) return undefined;
  const ids = here.map((p) => p.id);
  /*
   * "Last active" in three readings, narrowest first: the tab's ACTIVE panel when that is one of
   * ours, then the last one this opener acted on, then the last in document order. The first is
   * what makes clicking into a panel and pressing the chord reuse the panel the user is looking at,
   * without this module having to observe every focus change to find that out.
   */
  const active = effectiveActivePanelId(tab);
  if (active !== null && active !== undefined && ids.includes(active)) return active;
  const remembered = getLastActiveFindInFiles(tab.id);
  if (remembered !== undefined && ids.includes(remembered)) return remembered;
  return ids[ids.length - 1];
}

/**
 * Create the panel, in `createDedicatedEditor`'s sequence and for its reasons.
 *
 * `clearLastAddedPanel` is the load-bearing step: only a USER-added panel opens in rename mode
 * (FR-041), and a panel that appeared because the user pressed a search chord must not open with a
 * rename box over its search input.
 */
function createPanel(ws: FindInFilesWorkspace, tabId: string, projectId: string | null): string {
  const newId = ws.addPanel(tabId);
  ws.clearLastAddedPanel();
  const config: FindInFilesPanelConfig = {};
  ws.setPanelType(newId, FIND_IN_FILES_KIND, config);
  window.throng?.panel?.notifyTyped?.(newId, FIND_IN_FILES_KIND, config);
  void projectId;
  return newId;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The registration — one per window realm, held by `FindInFilesChrome`.
 * ──────────────────────────────────────────────────────────────────────────── */

let opener: ((request: FindInFilesRequest) => boolean) | null = null;

/** Register (or clear, with `null`) how find in files opens in this window. */
export function registerFindInFilesOpener(
  open: ((request: FindInFilesRequest) => boolean) | null,
): void {
  opener = open;
}

/**
 * Ask for find in files. Returns whether a panel was actually opened or reused.
 *
 * `false` is a legitimate outcome rather than a failure: no chrome mounted, or no project open in
 * this window, which is FR-029e's "the chord does nothing". Nothing is reported either way — a
 * notice the user cannot act differently on is what FR-029e declines to raise.
 */
export function requestFindInFiles(request: FindInFilesRequest): boolean {
  return opener?.(request) ?? false;
}
