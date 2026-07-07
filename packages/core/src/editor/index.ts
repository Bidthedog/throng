/**
 * Public surface of the pure editor domain (006). Zero OS/DOM imports (guarded).
 * The `editorPanelType` descriptor, the encoding/line-ending model, path
 * confinement, Save-All scope, the open-document registry, unsaved-indicator
 * aggregation, and project-overlap detection — all pure decisions consumed by the
 * UI-main editor service/coordinator and the sandboxed renderer.
 */
export { EDITOR_KIND, editorPanelType, type EditorValues } from './panel-type.js';
export {
  type EditorDocument,
  type EditorOwnerKind,
  NEW_DOCUMENT_NAME,
  isPathed,
} from './document.js';
export {
  type DecodedFile,
  type EncodeOptions,
  detectEncoding,
  detectLineEnding,
  decode,
  encode,
  newDocumentDefaults,
  isProbablyBinary,
} from './text-fidelity.js';
export {
  type SaveConfinementKind,
  type SaveConfinement,
  isWithinTree,
  isOutsideAllProjects,
  resolveSaveConfinement,
} from './confinement.js';
export {
  type SaveAllScope,
  type ScopeEditor,
  type ScopeContext,
  editorsInScope,
  partitionByPathed,
} from './save-scope.js';
export {
  type OpenDocEntry,
  type OpenDocRegistry,
  type OpenDecision,
  createOpenRegistry,
  isOpenAnywhere,
  openOrFocus,
  registerOpen,
  unregisterPath,
  unregisterPanel,
} from './open-registry.js';
export { panelUnsaved, tabUnsaved, projectUnsaved } from './indicators.js';
export { projectRootWouldContainOpenEditor } from './overlap.js';
export { editorPathParts, toDisplayPath, type EditorPathParts } from './path-display.js';
