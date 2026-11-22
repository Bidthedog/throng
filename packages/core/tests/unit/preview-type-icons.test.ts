import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ICON_SET,
  ICON_KEY_DESCRIPTIONS,
  SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
  isIconKey,
  previewIconOf,
  type PreviewProviderDescriptor,
} from '../../src/index.js';

/**
 * 074 FR-103 — every preview type can name its own preview icon, drawn wherever that type's preview is
 * named; the six shipped providers each declare one, drawn as the preview icon with a mark for the type,
 * and a provider that declares none shows the generic `preview` icon. Layer: unit — pure descriptor data
 * and the compiled default art.
 */
const bare: PreviewProviderDescriptor = { id: 'bare', displayName: 'Bare', extensions: ['.bare'], kind: 'text' };

/** The preview icon's two upper corners (Lucide scan-eye), which every type's icon keeps as the family mark. */
const FAMILY_CORNERS = ['<path d="M3 7V5a2 2 0 0 1 2-2h2"/>', '<path d="M17 3h2a2 2 0 0 1 2 2v2"/>'];

describe('per-type preview icons (074 FR-103)', () => {
  it('each shipped provider declares its own icon key, and no two share one', () => {
    const icons = SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.map((p) => p.previewIcon);
    expect(icons).toEqual([
      'previewMarkdown',
      'previewMermaid',
      'previewCsv',
      'previewSpreadsheet',
      'previewImage',
      'previewSvg',
      'previewPdf',
      'previewHtml',
    ]);
    for (const icon of icons) expect(isIconKey(icon), String(icon)).toBe(true);
  });

  it('draws a provider’s own icon, and the generic preview icon for one that declares none or for no provider', () => {
    for (const provider of SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS) expect(previewIconOf(provider)).toBe(provider.previewIcon);
    expect(previewIconOf(bare)).toBe('preview');
    expect(previewIconOf(undefined)).toBe('preview');
  });

  it('each type’s icon is the preview icon’s family — its upper corners — with art of its own', () => {
    const arts = SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.map((p) => DEFAULT_ICON_SET[previewIconOf(p)]);
    for (const art of arts) for (const corner of FAMILY_CORNERS) expect(art).toContain(corner);
    for (const corner of FAMILY_CORNERS) expect(DEFAULT_ICON_SET.preview).toContain(corner);
    expect(new Set([DEFAULT_ICON_SET.preview, ...arts]).size).toBe(arts.length + 1);
  });

  it('describes each type’s icon by the type it names', () => {
    for (const provider of SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS) {
      expect(ICON_KEY_DESCRIPTIONS[previewIconOf(provider)], provider.id).toContain(`${provider.displayName} preview`);
    }
  });
});
