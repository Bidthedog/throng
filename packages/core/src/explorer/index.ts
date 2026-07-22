// File-explorer pure domain (004). Tree nodes, exclude matching, path
// confinement, target resolution, naming, drag, and the open-click decision.
export type { FileNode, NodeKind } from './node.js';
export { toNodes, sortNodes, joinRel, parentRel } from './node.js';
export { isExcluded, DEFAULT_EXCLUDE_GLOBS } from './exclude.js';
export { isWithinRoot, isDropAllowed, isRoot } from './path-rules.js';
export type { TargetNode } from './target.js';
export { resolveTarget } from './target.js';
export type { RenameResult, DedupeStyle } from './naming.js';
export { validateRename, dedupeName } from './naming.js';
export type { DragModifiers, DragEffect, DragModifierKey, DragModifierConfig } from './drag.js';
export { resolveDragEffect, DEFAULT_DRAG_MODIFIERS } from './drag.js';
export type { ClickAction } from './open-intent.js';
export { decideClick } from './open-intent.js';
export { pathForms, type PathForms } from './path-forms.js';
export type { ExpandNode } from './expand.js';
export { nextExpandTargets } from './expand.js';
