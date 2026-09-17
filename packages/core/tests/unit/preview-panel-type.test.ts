import { describe, it, expect } from 'vitest';
import { PREVIEW_KIND, previewPanelType } from '../../src/preview/panel-type.js';
import { defaultPanelTypeRegistry } from '../../src/panel-type/default-registry.js';
import { THRONG_THEME } from '../../src/config/theme.js';

/**
 * 044 T016 — the preview panel type is REGISTERED but not OFFERED, on 043 FR-017's precedent.
 *
 * A preview is only ever created by opening one, never chosen from the New Panel form — but the
 * registry is also where a panel's header label and icon resolve (`registry.get(panel.kind)`), so
 * leaving it unregistered would ship a panel headed `preview` with no icon.
 */
describe('previewPanelType', () => {
  it("has the id PREVIEW_KIND, which is 'preview'", () => {
    expect(PREVIEW_KIND).toBe('preview');
    expect(previewPanelType.id).toBe(PREVIEW_KIND);
  });

  it('is not offered, declares no form inputs, and has a label', () => {
    expect(previewPanelType.offered).toBe(false);
    expect(previewPanelType.inputs).toEqual([]);
    expect(previewPanelType.label.trim().length).toBeGreaterThan(0);
  });

  it('wears the preview icon token, which the shipped theme defines', () => {
    expect(previewPanelType.icon).toBe('preview');
    expect(THRONG_THEME.icons.preview).toBeTruthy();
  });

  it('is registered in the default registry, resolvable by get(), but absent from listOfferable()', () => {
    expect(defaultPanelTypeRegistry.get(PREVIEW_KIND)).toBe(previewPanelType);
    expect(defaultPanelTypeRegistry.list().map((d) => d.id)).toContain(PREVIEW_KIND);
    expect(defaultPanelTypeRegistry.listOfferable().map((d) => d.id)).not.toContain(PREVIEW_KIND);
  });

  it('builds an empty config — the file is written by the preview itself, not a form', () => {
    const ctx = { projectRoot: 'C:/p', flavours: [] };
    expect(previewPanelType.defaults(ctx)).toEqual({});
    expect(previewPanelType.buildConfig({}, ctx)).toEqual({});
  });
});
