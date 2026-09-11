/**
 * Opening a result row (043 T072–T074, FR-037, FR-038).
 *
 * ══ WHY THIS GOES THROUGH `openFileInTab` AND NOT AROUND IT ══
 *
 * FR-037 asks for the file to open "through the user's current *Open files in* preference,
 * honouring the same one-buffer, dirty-editor and dedicated-editor rules as opening from the file
 * tree". Every one of those rules already lives in `editor/editor-open.tsx` — the app-wide single
 * buffer, the four-choice prompt over a dirty target, the tab's single dedicated editor — and each
 * has tests and a defect behind it. A second open path here would be a second copy of all of them,
 * and the copy would be the one that drifts.
 *
 * So this file adds exactly two things that route cannot know: the ABSOLUTE path (a result row
 * carries a root-relative one, because that is the identity that survives a project moving) and the
 * RANGE to select once the file is there.
 *
 * ══ WHY THE OPENER IS REGISTERED ══
 *
 * `open-find-in-files.ts`'s reason, unchanged: the panel is a component with no workspace store and
 * no settings context of its own, and threading them through the panel's props to reach a
 * double-click handler would put the whole open path into the panel's signature.
 */
import type { EditorOpenTarget, ResultRow } from '@throng/core';
import { openFileInTab } from '../editor/editor-open.js';
import { performOpenIn, readOpenInFacts } from '../editor/open-in-perform.js';
import { describeOpenInTargets, type OpenInTarget } from '../editor/open-in-targets.js';

/** One row, resolved to something the editor can open. */
export interface ResultOpenRequest {
  /** Root-relative POSIX path — resolved against the panel's project root by the caller. */
  relPath: string;
  /** Absolute document offsets of the match (FR-038). */
  from: number;
  to: number;
  /**
   * The Open In target the user chose, when they chose one (043 FR-087).
   *
   * Absent for a double-click, which is the gesture FR-037 binds to the "Open files in" preference.
   * Present only from the menu, where the row NAMES its destination — and a named destination
   * overrides the preference, or "New Editor" would not mean new editor.
   */
  target?: OpenInTarget;
  /**
   * 043 T236 — the root of the PANEL the row came from, which `relPath` is relative to.
   *
   * Sent by the panel because the panel is the one thing that knows it. The window's own project was
   * the only root there was before, and in a sub-workspace window that is the synthetic
   * `subworkspace:<id>`, which resolves to no project — so rows there opened nothing at all. A
   * sub-workspace may also hold panels from several projects, so no single window-level root could
   * be right for all of them (`navigation-chrome.tsx` makes the same argument for Quick Open).
   *
   * Optional only so a caller outside a panel can still ask; the chrome falls back to the window's
   * root when it is absent.
   */
  projectRoot?: string | null;
}

/** A row as the panel hands it over, with the root it belongs to. */
export function requestFromRow(row: ResultRow): ResultOpenRequest {
  return { relPath: row.relPath, from: row.from, to: row.to };
}

/**
 * The workspace slice this needs — a layout to find the active tab in, and nothing else it does not
 * hand straight to `openFileInTab`.
 */
export type ResultOpenWorkspace = Parameters<typeof openFileInTab>[0];

/**
 * Open one result row's file, at the match.
 *
 * ══ WHERE THE DESTINATION COMES FROM (043 FR-087c, FR-088) ══
 *
 * With NO chosen target — a double-click — the active tab, through the user's "Open files in"
 * preference (FR-037). The active tab because that is the tab holding the panel the user
 * double-clicked in, which is a fact about the gesture and needs no requirement to justify it.
 *
 * > **This comment used to justify it from FR-020, and that was wrong twice over.** It read: "FR-020
 * > already confines a search to the current tab, so there is no second tab this could mean."
 * > FR-020's subject is the PANEL — *"the panel it opens or reuses MUST be in that Tab"* — not the
 * > search's file scope, which is a directory and has no relationship to tabs at all. And even under
 * > the misreading, a constraint on where a search LOOKS says nothing about where its results may be
 * > OPENED. The conclusion was false on its face: the explorer has built an "Other Tab" list from
 * > `layout.tabs` since 006 FR-030, from a surface with the same single-tab context. 043 FR-088
 * > records the correction, and FR-087a now requires the very target this comment argued could not
 * > exist.
 *
 * With a chosen target — one of FR-087's menu items — that target decides, and it deliberately
 * overrides the preference: choosing "New Editor" must open a new editor, not whatever the
 * preference last said. FR-037 carries a supersession marker saying exactly this.
 *
 * Either way the match is revealed, because a result row names a place inside the file and not just
 * the file (FR-038, FR-087c).
 */
export async function openResultRow(args: {
  ws: ResultOpenWorkspace;
  projectRoot: string;
  openTarget: EditorOpenTarget;
  request: ResultOpenRequest;
}): Promise<boolean> {
  const { ws, projectRoot, openTarget, request } = args;
  const absPath = resolveResultPath(projectRoot, request.relPath);
  const range = { from: request.from, to: request.to };

  if (request.target) return performOpenIn({ ws, absPath, target: request.target, range });

  const tabId = ws.layout?.activeTabId;
  if (!tabId) return false;
  return openFileInTab(ws, tabId, absPath, openTarget, range);
}

/**
 * A row's root-relative path, resolved against the project root.
 *
 * Forward slash, exactly as the tree builds an absolute path for the editor — `path-id` normalises,
 * and a result row's `relPath` is POSIX by construction. Shared with the target query below so the
 * two cannot disagree about which file a menu is aimed at.
 */
function resolveResultPath(projectRoot: string, relPath: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/${relPath}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The registration — one per window realm, held by `FindInFilesChrome`.
 * ──────────────────────────────────────────────────────────────────────────── */

let opener: ((request: ResultOpenRequest) => void) | null = null;

export function registerResultOpener(open: ((request: ResultOpenRequest) => void) | null): void {
  opener = open;
}

/**
 * Ask for a row to be opened. Returns whether anything was listening.
 *
 * `false` means no chrome is mounted — a window mid-teardown. Nothing is reported: the user
 * double-clicked a row in a panel that is going away.
 */
export function requestOpenResult(request: ResultOpenRequest): boolean {
  if (!opener) return false;
  opener(request);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The Open In targets (043 FR-087) — a second registration, for the same reason
 * as the first.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Describe the targets available for one row's file.
 *
 * ══ WHY THIS IS A REGISTRATION AND NOT A FUNCTION THE PANEL CALLS ══
 *
 * The menu has to SAY what each target is — the panel it would land in, the titles of the other
 * tabs — and whether each can be chosen. Every one of those facts lives in the workspace store, the
 * editor state and a question only main can answer.
 *
 * The panel holds none of them, deliberately, and the comment beside `onOpenRow` in
 * `find-in-files-panel.tsx` gives the reason: `useWorkspace()` there "would make every one of this
 * panel's component tests need a provider to assert a search term". That is a property worth
 * keeping, so the chrome answers the question and the panel receives plain data — the same shape
 * the opener above already has, registered in the same effect so one cannot outlive the other.
 *
 * Returns `[]` when no chrome is mounted, which the menu draws as a disabled parent rather than as
 * an error: a window mid-teardown is not a failure to report.
 */
type TargetLister = (relPath: string, projectRoot: string | null) => Promise<OpenInTarget[]>;

let targetLister: TargetLister | null = null;

export function registerResultOpenTargets(list: TargetLister | null): void {
  targetLister = list;
}

/**
 * `projectRoot` is the asking PANEL's root (043 T236), for the reason `ResultOpenRequest.projectRoot`
 * gives: in a sub-workspace window the window has no root of its own that could be right.
 */
export async function queryResultOpenTargets(
  relPath: string,
  projectRoot: string | null = null,
): Promise<OpenInTarget[]> {
  if (!targetLister) return [];
  return targetLister(relPath, projectRoot);
}

/**
 * The chrome's half of that: resolve the row's path, ask main the one-buffer question, then read the
 * rest synchronously so the whole answer comes from one moment.
 */
export async function listResultOpenTargets(args: {
  ws: ResultOpenWorkspace;
  projectRoot: string;
  relPath: string;
}): Promise<OpenInTarget[]> {
  const { ws, projectRoot, relPath } = args;
  const absPath = resolveResultPath(projectRoot, relPath);
  const alreadyOpen = (await window.throng?.editor?.isOpen?.(absPath)) ?? false;
  return describeOpenInTargets(readOpenInFacts(ws, absPath, alreadyOpen));
}
