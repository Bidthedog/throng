/**
 * 054 T005 — one preview panel type per provider (FR-005, FR-009; research R2).
 *
 * The persisted kind stays `preview`; the provider is the panel type's identity. A config written before
 * 054 has no `providerId` and derives it from its file — read-only, so a second restore changes nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  createPreviewProviderRegistry,
  panelDisplayTitle,
  previewPanelTypeLabel,
  previewProviderIdOf,
  SHIPPED_PREVIEW_PROVIDERS,
  type Panel,
  type PreviewPanelConfig,
  type PreviewProviderDescriptor,
} from '../../src/index.js';

const markdown = SHIPPED_PREVIEW_PROVIDERS.get('markdown') as PreviewProviderDescriptor;
const diagrams: PreviewProviderDescriptor = { id: 'diagram', displayName: 'Diagram', extensions: ['.dg'], kind: 'text' };
const registry = createPreviewProviderRegistry([markdown, diagrams]);

describe('previewPanelTypeLabel (FR-005)', () => {
  it('names the type after its provider', () => {
    expect(previewPanelTypeLabel(markdown)).toBe('Markdown Preview');
    expect(previewPanelTypeLabel(diagrams)).toBe('Diagram Preview');
  });
});

describe('previewProviderIdOf (FR-009)', () => {
  it('reads a persisted providerId', () => {
    expect(previewProviderIdOf({ filePath: 'D:/p/a.md', providerId: 'markdown' }, registry)).toBe('markdown');
  });

  it('derives it from the file when the config predates 054', () => {
    expect(previewProviderIdOf({ filePath: 'D:/p/a.md' }, registry)).toBe('markdown');
    expect(previewProviderIdOf({ filePath: 'D:/p/b.DG' }, registry)).toBe('diagram');
  });

  it('prefers the file the history currently shows over the fallback filePath', () => {
    const config: PreviewPanelConfig = {
      filePath: 'D:/p/a.md',
      history: { v: 1, entries: [{ filePath: 'D:/p/a.md' }, { filePath: 'D:/p/c.dg' }], index: 1 },
    };
    expect(previewProviderIdOf(config, registry)).toBe('diagram');
  });

  it('derives the file’s provider when a persisted id names no registered provider', () => {
    expect(previewProviderIdOf({ filePath: 'D:/p/a.md', providerId: 'retired' }, registry)).toBe('markdown');
  });

  it('is undefined for a file no provider claims, and for no file', () => {
    expect(previewProviderIdOf({ filePath: 'D:/p/a.txt' }, registry)).toBeUndefined();
    expect(previewProviderIdOf({}, registry)).toBeUndefined();
    expect(previewProviderIdOf(undefined, registry)).toBeUndefined();
  });

  it('writes nothing: deriving twice gives the same answer and leaves the config as it was', () => {
    const config: PreviewPanelConfig = { filePath: 'D:/p/a.md' };
    const before = structuredClone(config);
    expect(previewProviderIdOf(config, registry)).toBe(previewProviderIdOf(config, registry));
    expect(config).toEqual(before);
  });
});

describe('the title falls back to the type label (FR-005)', () => {
  const preview = (config: PreviewPanelConfig): Panel =>
    ({ id: 'v1', kind: 'preview', title: 'Panel 3', config }) as unknown as Panel;

  it('a preview with no file to be named after shows its type label when one is handed in', () => {
    expect(panelDisplayTitle(preview({}), { previewTypeLabel: 'Markdown Preview' })).toBe('Markdown Preview');
  });

  it('without a label it falls through to the placeholder, as before', () => {
    expect(panelDisplayTitle(preview({}), {})).toBe('Blank Panel');
  });

  it('a preview with a file is still named after it', () => {
    expect(panelDisplayTitle(preview({ filePath: 'D:/p/a.md' }), { previewTypeLabel: 'Markdown Preview' })).toBe(
      'a - Preview',
    );
  });
});
