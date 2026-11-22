/** The one HTML escape every printout, clipboard table and preview renderer shares. */
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/text/escape-html.js';

describe('escapeHtml', () => {
  it('escapes the five characters that can end text or a quoted attribute, ampersand first', () => {
    expect(escapeHtml(`<a href="x" title='y'>&amp;</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;');
  });

  it('leaves everything else as it is', () => {
    expect(escapeHtml('plain text, ünïcode 🙂')).toBe('plain text, ünïcode 🙂');
  });
});
