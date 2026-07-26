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
export { resolveDrop, type DropCandidate, type DropDecision, type DropRejection } from './drop.js';
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
// Language registry, extension-only detection, and bounded indentation inference (016).
export {
  type IndentProfile,
  type LanguageDescriptor,
  LANGUAGES,
  PLAIN_TEXT_ID,
  PLAIN_TEXT_NAME,
  SHIPPED_INDENT_BY_LANGUAGE,
  languageById,
  languageName,
  isKnownLanguage,
} from './languages.js';
export {
  type LanguageResolution,
  type LanguageSource,
  type ResolveLanguageArgs,
  detectLanguage,
  resolveLanguage,
} from './language-detect.js';
export { type InferredIndent, inferIndent } from './indent-infer.js';
export { panelUnsaved, tabUnsaved, projectUnsaved } from './indicators.js';
export { projectRootWouldContainOpenEditor } from './overlap.js';
export { editorAutoTitle, editorPathParts, toDisplayPath, type EditorPathParts } from './path-display.js';
// Rectangular (column) selection and column-wise paste (016, US6 · FR-025).
export {
  columnAt,
  isRectangular,
  offsetAt,
  padding,
  rectPaste,
  rowsOf,
  type PadStyle,
  type RectPasteChange,
  type RowSpan,
} from './rect-select.js';
// What a selection seeds 013's find input with (016, FR-025i).
export { seedFromSelections } from './seed-selection.js';
