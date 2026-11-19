/**
 * 073 FR-020, FR-030, FR-031, FR-050, FR-059 – FR-061, FR-064 — the CSV and Spreadsheet providers as
 * registered, and the settings generated from them.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultOpenActionFor,
  parsePreviewSettings,
  previewSettingsDefaults,
  previewSettingsDescriptors,
} from '../../src/config/preview-settings.js';
import { SHIPPED_PREVIEW_PROVIDERS } from '../../src/preview/providers/index.js';

describe('the CSV provider (the CSV Preview Editor)', () => {
  it('is an editable text provider for .csv that is not a flowing document', () => {
    expect(SHIPPED_PREVIEW_PROVIDERS.forPath('D:/p/data.CSV')).toMatchObject({
      id: 'csv',
      kind: 'text',
      editable: true,
      flowingDocument: false,
    });
  });

  it('opens a .csv in its preview by default (Q2: Throng Preview Editor ships)', () => {
    const shipped = previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS);
    expect(shipped.providers.csv).toEqual({ enabled: true, defaultOpenAction: 'preview', openTarget: 'lastActive' });
    expect(defaultOpenActionFor(SHIPPED_PREVIEW_PROVIDERS, shipped, 'D:/p/data.csv')).toBe('preview');
  });

  it('files its rows under its own CSV subsection', () => {
    const keys = previewSettingsDescriptors(SHIPPED_PREVIEW_PROVIDERS)
      .filter((d) => d.subsection === 'CSV')
      .map((d) => d.key);
    expect(keys).toEqual([
      'editor.previews.providers.csv.enabled',
      'editor.previews.providers.csv.defaultOpenAction',
      'editor.previews.providers.csv.openTarget',
    ]);
  });
});

describe('the Spreadsheet provider', () => {
  it('is a binary provider for every common workbook format', () => {
    for (const ext of ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'numbers']) {
      expect(SHIPPED_PREVIEW_PROVIDERS.forPath(`D:/p/book.${ext}`)?.id).toBe('spreadsheet');
    }
    expect(SHIPPED_PREVIEW_PROVIDERS.get('spreadsheet')).toMatchObject({ kind: 'binary', sizeLimitSetting: 'maxPreviewMb' });
  });

  it('ships First row is a header off and a 25 MB preview size limit (FR-059, FR-061)', () => {
    expect(previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS).providers.spreadsheet).toMatchObject({
      enabled: true,
      firstRowHeader: false,
      maxPreviewMb: 25,
    });
  });

  it('draws the size limit as a slider whose step is an aimable 1% of its range', () => {
    const limit = previewSettingsDescriptors(SHIPPED_PREVIEW_PROVIDERS).find(
      (d) => d.key === 'editor.previews.providers.spreadsheet.maxPreviewMb',
    );
    expect(limit).toMatchObject({ control: 'slider', min: 5, max: 500, step: 5, subsection: 'Spreadsheet' });
  });

  it('keeps a stored limit and falls back on a wrong type', () => {
    const parsed = parsePreviewSettings(
      { providers: { spreadsheet: { maxPreviewMb: 100, firstRowHeader: 'yes' } } },
      SHIPPED_PREVIEW_PROVIDERS,
    );
    expect(parsed.providers.spreadsheet).toMatchObject({ maxPreviewMb: 100, firstRowHeader: false });
  });
});

describe('Open CSVs in / Open spreadsheets in (Q1, Q2, Q5; 074 FR-016, FR-017)', () => {
  const row = (key: string) => previewSettingsDescriptors(SHIPPED_PREVIEW_PROVIDERS).find((d) => d.key === key);

  it('offers the CSV Preview Editor by its own name, and the editor and the OS program beside it', () => {
    const d = row('editor.previews.providers.csv.defaultOpenAction');
    expect(d?.label).toBe('Open CSVs in');
    expect(d?.optionLabels).toEqual({ editor: 'Throng Editor', preview: 'Throng Preview Editor', os: 'Default OS Program' });
  });

  it('offers a workbook no editor, and ships its preview', () => {
    const d = row('editor.previews.providers.spreadsheet.defaultOpenAction');
    expect(d?.label).toBe('Open spreadsheets in');
    expect(d?.optionLabels).toEqual({ preview: 'Throng Preview', os: 'Default OS Program' });
    const shipped = previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS);
    expect(defaultOpenActionFor(SHIPPED_PREVIEW_PROVIDERS, shipped, 'D:/p/book.xlsx')).toBe('preview');
  });
});
