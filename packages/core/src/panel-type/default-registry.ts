/**
 * The shared application panel-type registry (005). Built-in types are registered
 * here in one explicit place (no import side-effects scattered across descriptor
 * modules). The renderer's type-selection form lists from this registry; tests use
 * an isolated `createPanelTypeRegistry()` instead.
 */
import { createPanelTypeRegistry, type PanelTypeRegistry } from './registry.js';
import { terminalPanelType } from '../terminal/panel-type.js';
import { editorPanelType } from '../editor/panel-type.js';

export const defaultPanelTypeRegistry: PanelTypeRegistry = createPanelTypeRegistry();
// Registration order is the type-dropdown order (stable): Terminal, then Editor.
defaultPanelTypeRegistry.register(terminalPanelType);
defaultPanelTypeRegistry.register(editorPanelType);
