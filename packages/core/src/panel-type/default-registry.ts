/**
 * The shared application panel-type registry (005). Built-in types are registered
 * here in one explicit place (no import side-effects scattered across descriptor
 * modules). The renderer's type-selection form lists from this registry; tests use
 * an isolated `createPanelTypeRegistry()` instead.
 */
import { createPanelTypeRegistry, type PanelTypeRegistry } from './registry.js';
import { terminalPanelType } from '../terminal/panel-type.js';
import { editorPanelType } from '../editor/panel-type.js';
import { findInFilesPanelType } from '../find-in-files/panel-type.js';

export const defaultPanelTypeRegistry: PanelTypeRegistry = createPanelTypeRegistry();
// Registration order is the type-dropdown order (stable): Terminal, then Editor.
defaultPanelTypeRegistry.register(terminalPanelType);
defaultPanelTypeRegistry.register(editorPanelType);
// 043 FR-017 — registered LAST and `offered: false`, so it never reaches the dropdown at all
// (`listOfferable()`). It is here for the header label and icon, which resolve through `get()`.
defaultPanelTypeRegistry.register(findInFilesPanelType);
