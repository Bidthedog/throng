import { describe, it, expect } from 'vitest';
import { editorPanelType, EDITOR_KIND } from '../../src/editor/panel-type.js';
import { terminalPanelType } from '../../src/terminal/panel-type.js';
import { defaultPanelTypeRegistry } from '../../src/panel-type/default-registry.js';
import { createPanelTypeRegistry } from '../../src/panel-type/registry.js';
import type { PanelTypeContext } from '../../src/panel-type/descriptor.js';

const withRoot: PanelTypeContext = { projectRoot: 'C:/proj', flavours: [] };
const rootless: PanelTypeContext = { projectRoot: null, flavours: [], rootless: true };
const noContext: PanelTypeContext = { projectRoot: null, flavours: [] };

describe('editorPanelType descriptor (006, contracts/editor-panel-type.md)', () => {
  it('has id "editor", label "Editor Panel", and no configuration inputs', () => {
    expect(editorPanelType.id).toBe(EDITOR_KIND);
    expect(EDITOR_KIND).toBe('editor');
    expect(editorPanelType.label).toBe('Editor Panel');
    expect(editorPanelType.inputs).toEqual([]);
  });

  it('validate is ok with a project root', () => {
    expect(editorPanelType.validate({}, withRoot)).toEqual({ ok: true });
  });

  it('validate is ok when rootless (sub-workspace-owned)', () => {
    expect(editorPanelType.validate({}, rootless)).toEqual({ ok: true });
  });

  it('validate fails with neither a project root nor rootless context', () => {
    expect(editorPanelType.validate({}, noContext)).toEqual({ ok: false, errors: {} });
  });

  it('buildConfig returns an empty EditorPanelConfig (a new, unpathed document)', () => {
    expect(editorPanelType.buildConfig({}, withRoot)).toEqual({});
    expect(editorPanelType.defaults(withRoot)).toEqual({});
  });

  it('is registered in the default registry alongside Terminal, in stable order', () => {
    const ids = defaultPanelTypeRegistry.list().map((d) => d.id);
    expect(ids).toEqual(['terminal', 'editor']);
    expect(defaultPanelTypeRegistry.get('editor')).toBe(editorPanelType);
  });

  it('SC-016: registering Editor is purely additive — a fresh registry with both types lists them without touching the shared flow', () => {
    // The registry is the only seam; adding Editor needs no change to select/confirm/clear.
    const reg = createPanelTypeRegistry();
    reg.register(terminalPanelType);
    reg.register(editorPanelType);
    expect(reg.list().map((d) => d.id)).toEqual(['terminal', 'editor']);
  });
});
