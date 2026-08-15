// File-explorer pure domain (004). Tree nodes, exclude matching, path
// confinement, target resolution, naming, drag, and the open-click decision.
export type { FileNode, NodeKind } from './node.js';
export { toNodes, sortNodes, joinRel, parentRel } from './node.js';
export { isExcluded, compileExcluder, hiddenPathGlobs, DEFAULT_EXCLUDE_GLOBS } from './exclude.js';
// 033 FR-075 — the renderer's fold of one index push, pure so it can be asserted without a window.
export { applyIndexUpdate, IDLE_FILE_INDEX_VIEW } from './file-index-view.js';
export type { FileIndexView, FileIndexUpdateView } from './file-index-view.js';
// 033 US1 — the project file index's pure half: the walk that seeds Quick Open, and the diff that
// keeps it current. Depends only on the IFileSystem seam (Principle II).
export { walkFiles, diffPaths } from './file-index.js';
export type { WalkOptions, FileIndexDelta } from './file-index.js';
export { isWithinRoot, isDropAllowed, isRoot, relPathUnderRoot } from './path-rules.js';
export type { TargetNode } from './target.js';
export { resolveTarget } from './target.js';
export type { RenameResult, DedupeStyle } from './naming.js';
export { validateRename, dedupeName } from './naming.js';
export type { DragModifiers, DragEffect, DragModifierKey, DragModifierConfig } from './drag.js';
export { resolveDragEffect, DEFAULT_DRAG_MODIFIERS } from './drag.js';
export type { ClickAction } from './open-intent.js';
export { decideClick } from './open-intent.js';
export { pathForms, type PathForms } from './path-forms.js';
export { buildTreeDragPayload, toAbsPath } from './tree-drag-payload.js';
export type { TreeDragPayload, TreeDragInput } from './tree-drag-payload.js';
export type { ExpandNode } from './expand.js';
export { nextExpandTargets } from './expand.js';
// 033 US4 — Collapse/Expand All Children's pure targets, over the same ExpandNode view
// (contracts/explorer-actions.md §B.1).
export { descendantOpenFolders, immediateChildFolders } from './subtree.js';
