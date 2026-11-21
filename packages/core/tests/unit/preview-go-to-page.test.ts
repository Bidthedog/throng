/**
 * 074 FR-062b — which previews offer Go to Page. What its field accepts is the shared Go to dialog's rule (073
 * FR-043b), pinned in `go-to-input.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { previewGoToKind, SHIPPED_PREVIEW_PROVIDERS } from '../../src/index.js';

describe('previewGoToKind', () => {
  it('a PDF goes to a page, a flowing document to a heading, a single picture nowhere', () => {
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('pdf'))).toBe('page');
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('markdown'))).toBe('heading');
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('mermaid'))).toBeNull();
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('image'))).toBeNull();
    expect(previewGoToKind(undefined)).toBeNull();
  });

  it('a CSV or workbook grid goes to a row (073 FR-043a)', () => {
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('csv'))).toBe('row');
    expect(previewGoToKind(SHIPPED_PREVIEW_PROVIDERS.get('spreadsheet'))).toBe('row');
  });
});
