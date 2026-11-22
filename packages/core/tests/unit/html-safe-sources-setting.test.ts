// Layer: unit — 074 FR-072a: the global **HTML: Safe preview sources** preference, a list leaf on the HTML provider.
import { describe, expect, it } from 'vitest';
import {
  htmlSafeSourcesFrom,
  parsePreviewSettings,
  previewSettingsDefaults,
  previewSettingsDescriptors,
} from '../../src/config/preview-settings.js';
import { SHIPPED_PREVIEW_PROVIDERS } from '../../src/preview/providers/index.js';

const KEY = 'editor.previews.providers.html.safeSources';

describe('HTML: Safe preview sources (FR-072a)', () => {
  it('ships Google Fonts', () => {
    const s = previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS);
    expect(s.providers.html?.safeSources).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
    expect(htmlSafeSourcesFrom(s)).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  });

  it('is an editable, clearable list of text items under the HTML subsection', () => {
    const d = previewSettingsDescriptors(SHIPPED_PREVIEW_PROVIDERS).find((x) => x.key === KEY);
    expect(d).toMatchObject({ control: 'array', itemControl: 'text', clearable: true, label: 'HTML: Safe preview sources', subsection: 'HTML' });
    expect(d?.description).toMatch(/stylesheets, fonts and images/);
    expect(d?.description).toMatch(/Project Settings/);
  });

  it('keeps an explicit empty list, normalises entries and drops what is not a source', () => {
    const raw = { providers: { html: { safeSources: ['HTTPS://CDN.Example.com/x', 'http://plain.com', 7] } } };
    const s = parsePreviewSettings(raw, SHIPPED_PREVIEW_PROVIDERS);
    expect(htmlSafeSourcesFrom(s)).toEqual(['https://cdn.example.com']);
    const empty = parsePreviewSettings({ providers: { html: { safeSources: [] } } }, SHIPPED_PREVIEW_PROVIDERS);
    expect(htmlSafeSourcesFrom(empty)).toEqual([]);
  });

  it('a wrong type reads as the shipped list', () => {
    const s = parsePreviewSettings({ providers: { html: { safeSources: 'https://a.com' } } }, SHIPPED_PREVIEW_PROVIDERS);
    expect(htmlSafeSourcesFrom(s)).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  });
});
