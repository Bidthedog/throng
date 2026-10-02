/**
 * 049 R3 — a loaded panel's view and transient UI state, handed from the window that sends the panel to
 * another window to the window that receives it (FR-000, FR-000a; constitution XI "A loaded Panel keeps
 * its state").
 *
 * A tear-off COPIES a panel into another renderer, whose module-scoped stores start empty; main holds one
 * of these per panel id between the sender's stash and the receiver's claim. It is renderer-supplied JSON
 * held in another process, so main accepts only what {@link isPanelSnapshot} accepts and drops anything
 * over {@link MAX_PANEL_SNAPSHOT_BYTES}. Nothing here is persisted: the state is transient by FR-000.
 */
import type { MatchModes, SearchCount } from '../search/match-model.js';

/** An open find bar (049 data-model *FindSession*, minus the window-local `openSeq`). */
export interface PanelSnapshotFind {
  panelId: string;
  panelKind: 'editor' | 'terminal' | 'preview';
  replaceShown: boolean;
  term: string;
  replacement: string;
  modes: MatchModes;
  count: SearchCount;
  seeded: boolean;
  /** Text offset of the current match — the anchor a restored search re-lands on (FR-003). */
  currentFrom: number | null;
}

/** An editor's caret, selection and scroll (`editor-view-state.ts`'s shape). */
export interface PanelSnapshotEditor {
  selection: { ranges: { anchor: number; head: number }[]; main: number };
  scrollAnchor: number;
}

/** A terminal's viewport and selection (`terminal-view-state.ts`'s shape; xterm, 1-based). */
export interface PanelSnapshotTerminal {
  offsetFromBottom: number;
  selection?: { start: { x: number; y: number }; end: { x: number; y: number } };
}

/** A preview's retained selection, as offsets into its rendered text model (049 R12). */
export interface PanelSnapshotPreviewSelection {
  from: number;
  to: number;
  text: string;
}

export interface PanelSnapshot {
  panelId: string;
  find?: PanelSnapshotFind;
  editor?: PanelSnapshotEditor;
  terminal?: PanelSnapshotTerminal;
  previewSelection?: PanelSnapshotPreviewSelection;
}

/** The largest snapshot main keeps for one panel, measured by {@link panelSnapshotBytes}. */
export const MAX_PANEL_SNAPSHOT_BYTES = 65536;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (v: unknown): boolean => isRec(v) && isNum(v.x) && isNum(v.y);

const PANEL_KINDS: ReadonlySet<unknown> = new Set(['editor', 'terminal', 'preview']);

function isFind(v: unknown): boolean {
  return (
    isRec(v) &&
    typeof v.panelId === 'string' &&
    PANEL_KINDS.has(v.panelKind) &&
    typeof v.replaceShown === 'boolean' &&
    typeof v.term === 'string' &&
    typeof v.replacement === 'string' &&
    isRec(v.modes) &&
    typeof v.modes.caseSensitive === 'boolean' &&
    typeof v.modes.wholeWord === 'boolean' &&
    isRec(v.count) &&
    isNum(v.count.current) &&
    isNum(v.count.total) &&
    typeof v.seeded === 'boolean' &&
    (v.currentFrom === null || isNum(v.currentFrom))
  );
}

function isEditor(v: unknown): boolean {
  if (!isRec(v) || !isNum(v.scrollAnchor) || !isRec(v.selection)) return false;
  const { ranges, main } = v.selection;
  return Array.isArray(ranges) && isNum(main) && ranges.every((r) => isRec(r) && isNum(r.anchor) && isNum(r.head));
}

function isTerminal(v: unknown): boolean {
  if (!isRec(v) || !isNum(v.offsetFromBottom)) return false;
  if (v.selection === undefined) return true;
  return isRec(v.selection) && isPoint(v.selection.start) && isPoint(v.selection.end);
}

function isPreviewSelection(v: unknown): boolean {
  return isRec(v) && isNum(v.from) && isNum(v.to) && typeof v.text === 'string';
}

/** Whether `value` is a well-formed {@link PanelSnapshot}; any section present must have its full shape. */
export function isPanelSnapshot(value: unknown): value is PanelSnapshot {
  if (!isRec(value) || typeof value.panelId !== 'string' || value.panelId.length === 0) return false;
  if (value.find !== undefined && !isFind(value.find)) return false;
  if (value.editor !== undefined && !isEditor(value.editor)) return false;
  if (value.terminal !== undefined && !isTerminal(value.terminal)) return false;
  if (value.previewSelection !== undefined && !isPreviewSelection(value.previewSelection)) return false;
  return true;
}

/** The size main measures a snapshot by: its JSON length. */
export function panelSnapshotBytes(value: PanelSnapshot): number {
  return JSON.stringify(value).length;
}
