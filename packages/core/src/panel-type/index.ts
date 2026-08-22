/** Public surface of the pure panel-type system (005). */
export type {
  PanelTypeDescriptor,
  PanelTypeInputSpec,
  PanelTypeContext,
  PanelTypeValues,
  ValidationResult,
  FlavourOption,
  TerminalMemory,
  TerminalPanelDefaults,
} from './descriptor.js';
export { createPanelTypeRegistry, type PanelTypeRegistry } from './registry.js';
export { defaultPanelTypeRegistry } from './default-registry.js';
export {
  setPanelType,
  clearPanelType,
  convertPanelToProject,
  updatePanelConfig,
  setTerminalMemory,
  setPanelDormant,
} from './assignment.js';
