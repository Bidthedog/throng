/**
 * Docking-workspace domain model (Constitution Principle XI v3.0.0). Pure types
 * describing the per-project Workspace Pane: a tab group whose Tabs each hold a
 * recursive split tree of Panels. Panels are generic, **untyped** placeholders
 * this iteration (FR-015) — no editor/terminal `kind` field yet.
 *
 * The leaf of the split tree is the Panel itself (carrying its `originProjectId`
 * so the cross-project invariants INV-4/5/6 travel with it). A `type`
 * discriminator makes the recursion type-safe.
 *
 * No OS/DOM/process imports (Principle II) — verified by the no-os-imports guard.
 */

/** Current version of the layout JSON document (for forward migration).
 * v2 (003) adds `Tab.activePanelId`; v1 documents are migrated on load
 * (default `activePanelId` = first panel). */
export const LAYOUT_SCHEMA_VERSION = 2;

/**
 * A Panel's assigned type (005). Open by design: the panel-type registry is the
 * source of truth, so new kinds register without widening a closed union. The
 * `'terminal'` literal is surfaced for ergonomics; `(string & {})` keeps the type
 * open for future kinds (editor, agent, …) without losing the literal hint.
 */
export type PanelKind = 'terminal' | (string & {});

/**
 * The per-type configuration captured when a Panel's type is confirmed (005).
 * An open record; each panel type narrows it to its own shape (e.g. the Terminal
 * type's `TerminalPanelConfig`). Serialised verbatim inside the layout blob.
 */
export type PanelConfig = Record<string, unknown>;

/**
 * Text encoding of an editor document (006). Extensible; this pass ships UTF-8
 * (with or without a BOM). The id is persisted in {@link EditorPanelConfig} so a
 * reopened document re-emits its original encoding on save.
 */
export type EncodingId = 'utf8';

/** Line-ending style of an editor document (006): LF, CRLF, or CR-only. */
export type LineEndingId = 'lf' | 'crlf' | 'cr';

/**
 * Configuration captured for an Editor Panel (006 / `kind: 'editor'`). Persisted
 * verbatim inside the layout blob (rides `Panel.config` — no SQLite migration).
 * Every field is optional: a brand-new, never-saved document has no `filePath`
 * and its in-progress content is restored from the recovery temp file instead.
 */
export type EditorPanelConfig = {
  /** Real target path; `undefined` for a never-saved new document. */
  filePath?: string;
  /** Detected/last-saved encoding (default `'utf8'`). */
  encoding?: EncodingId;
  /** BOM presence for utf8 (default `false` for new docs). */
  hasBom?: boolean;
  /** Line-ending style (new-doc default from `settings.editor.defaultLineEnding`). */
  lineEnding?: LineEndingId;
};

/** A leaf node: one Panel (the atomic, draggable content unit). */
export interface Panel {
  type: 'panel';
  /** Stable identity. */
  id: string;
  /** The Panel's original project — drives merge-to-origin (FR-023/024, INV-4/6). */
  originProjectId: string;
  /** Placeholder label (e.g. "Panel 3"). */
  title: string;
  /**
   * The Panel's assigned type (005 / FR-006). `undefined` = untyped placeholder
   * showing the type-selection form (back-compatible: old layouts deserialise
   * untyped). Assignable only from the untyped state; cleared back to untyped
   * when a Terminal Panel's content ends (FR-020) so the Panel is re-typeable.
   */
  kind?: PanelKind;
  /** The configuration captured at Confirm for `kind` (005 / FR-007). */
  config?: PanelConfig;
}

/** An internal split container tiling its children into a row or column. */
export interface SplitNode {
  type: 'split';
  orientation: 'row' | 'column';
  /** ≥ 2 children (a single-child split is always collapsed away — INV-3). */
  children: LayoutNode[];
  /** Fractional sizes aligned with `children`; sum ≈ 1 (INV-7). */
  sizes: number[];
}

/** The recursive split tree: either a leaf Panel or a SplitNode. */
export type LayoutNode = SplitNode | Panel;

/** A workspace Tab: an ordered, titled view holding one split tree (≥ 1 Panel). */
export interface Tab {
  id: string;
  title: string;
  root: LayoutNode;
  /**
   * The Tab's active (highlighted) Panel (003 / FR-002). Optional for forward
   * compatibility with v1 layout documents; when absent or stale, the effective
   * active panel falls back to the Tab's first Panel (see `effectiveActivePanelId`).
   */
  activePanelId?: string;
}

/** The active project's Workspace Pane — a tab group with exactly one active Tab. */
export interface WorkspaceLayout {
  projectId: string;
  schemaVersion: number;
  /** Ordered; length ≥ 1. */
  tabs: Tab[];
  /** Always references an existing Tab (INV-7). */
  activeTabId: string;
}

/** On-screen bounds of a detached sub-workspace window (US4). */
export interface SubWorkspaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Identifier of the display the window was last on (validated on restore). */
  displayId?: string;
}

/**
 * A detached window (US4): one or more Tabs that MAY mix Panels from several
 * projects (INV-5). Reattach is per-Panel and only to the Panel's origin project
 * (INV-6).
 */
export interface SubWorkspace {
  id: string;
  ownerUser: string;
  /** Friendly, independent name (003 / FR-012). Auto-assigned on detach. */
  name: string;
  /** Dominant colour (003 / FR-012), from the shared palette. */
  colour: string;
  tabs: Tab[];
  /** The sub-workspace window's active Tab, persisted so a cross-window drop can
   *  target it (003). Absent on legacy records → defaults to the first Tab. */
  activeTabId?: string;
  bounds: SubWorkspaceBounds;
}

/** Type guards for narrowing layout nodes. */
export function isPanel(node: LayoutNode): node is Panel {
  return node.type === 'panel';
}

export function isSplit(node: LayoutNode): node is SplitNode {
  return node.type === 'split';
}
