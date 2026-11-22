import { describe, expect, it } from 'vitest';
import { javascript } from '@codemirror/lang-javascript';
import { PRINT_PALETTE } from '@throng/core';
import { buildTextPrintable } from '../../src/renderer/print/text-printable.js';
import { LONG_LINE_THRESHOLD } from '../../src/renderer/editor/highlight-style.js';

/**
 * The printable document for a text panel's document (an editor's today): the whole text, monospace, whitespace
 * kept, long lines wrapping, highlighted in the print palette's syntax colours where the language is known.
 *
 * Layer: component — the output is an HTML document; jsdom parses it so the assertions read what Print Preview
 * would lay out rather than matching markup strings.
 */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const js = (text: string) => javascript().language.parser.parse(text);

describe('the text printable', () => {
  it('is a width-fitted document with no remote requests, titled with the file name', () => {
    const output = buildTextPrintable({ text: 'hello', title: 'notes.txt' });
    expect(output).toMatchObject({ kind: 'document', fit: 'width', remoteImages: [] });
    const doc = parse(output.kind === 'document' ? output.html : '');
    expect(doc.title).toBe('notes.txt');
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("default-src 'none'");
  });

  it('carries the whole text exactly, whitespace and blank lines included', () => {
    const text = 'a\n\n\tindented  twice\n   trailing   \n\nlast';
    const output = buildTextPrintable({ text, title: 't' });
    const doc = parse(output.kind === 'document' ? output.html : '');
    expect(doc.querySelector('pre')?.textContent).toBe(text);
  });

  it('escapes the file\'s text, so no markup in it reaches the document', () => {
    const text = '<script>alert(1)</script></pre><img src=x onerror=alert(2)> & "q"';
    const output = buildTextPrintable({ text, title: '<b>x</b>.html' });
    const html = output.kind === 'document' ? output.html : '';
    const doc = parse(html);
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('b')).toBeNull();
    expect(doc.querySelectorAll('pre')).toHaveLength(1);
    expect(doc.querySelector('pre')?.textContent).toBe(text);
    expect(doc.title).toBe('<b>x</b>.html');
  });

  it('escapes highlighted text too', () => {
    const text = 'const s = "</pre><script>x</script>";';
    const output = buildTextPrintable({ text, title: 'a.js', tree: js(text) });
    const doc = parse(output.kind === 'document' ? output.html : '');
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('pre')?.textContent).toBe(text);
  });

  it('is monospace, keeps whitespace and wraps long lines', () => {
    const output = buildTextPrintable({ text: 'x', title: 't' });
    const html = output.kind === 'document' ? output.html : '';
    expect(html).toMatch(/white-space:\s*pre-wrap/);
    expect(html).toMatch(/overflow-wrap:\s*anywhere/);
    expect(html).toMatch(/font-family:[^;]*monospace/);
  });

  it('uses the font it is given, and cannot be broken out of the stylesheet by it', () => {
    const output = buildTextPrintable({ text: 'x', title: 't', fontFamily: "'Fira Code'}</style><script>x</script>" });
    const html = output.kind === 'document' ? output.html : '';
    const doc = parse(html);
    expect(doc.querySelector('script')).toBeNull();
    expect(html).toContain("'Fira Code'");
  });

  it('is plain text when the language is not known', () => {
    const output = buildTextPrintable({ text: 'const a = 1;', title: 't' });
    const doc = parse(output.kind === 'document' ? output.html : '');
    expect(doc.querySelectorAll('pre span')).toHaveLength(0);
  });

  it('highlights a known language with classes the document styles', () => {
    const text = 'const a = "s"; // note';
    const output = buildTextPrintable({ text, title: 'a.js', tree: js(text) });
    const html = output.kind === 'document' ? output.html : '';
    const doc = parse(html);
    const keyword = [...doc.querySelectorAll('pre span')].find((s) => s.textContent === 'const');
    expect(keyword).toBeDefined();
    const cls = keyword!.className.split(' ')[0];
    // The class is styled in the document itself, by a syntax token…
    expect(html).toMatch(new RegExp(`\\.${cls}\\s*\\{[^}]*var\\(--throng-colour-syntaxKeyword\\)`));
  });

  it('colours with the fixed print palette, never the active theme', () => {
    document.documentElement.style.setProperty('--throng-colour-syntaxKeyword', '#abcdef');
    document.documentElement.style.setProperty('--throng-colour-editorBg', '#000000');
    try {
      const text = 'const a = 1;';
      const output = buildTextPrintable({ text, title: 'a.js', tree: js(text) });
      const html = output.kind === 'document' ? output.html : '';
      expect(html).toContain(`--throng-colour-syntaxKeyword: ${PRINT_PALETTE.syntaxKeyword}`);
      expect(html).toContain(`--throng-colour-editorBg: ${PRINT_PALETTE.editorBg}`);
      expect(html).not.toContain('#abcdef');
      expect(html).not.toContain('#000000');
    } finally {
      document.documentElement.style.removeProperty('--throng-colour-syntaxKeyword');
      document.documentElement.style.removeProperty('--throng-colour-editorBg');
    }
  });

  it('prints a line over the editor\'s long-line threshold plain, and still highlights the rest', () => {
    const long = `"${'x'.repeat(LONG_LINE_THRESHOLD + 1)}";`;
    const text = `const a = 1;\n${long}\nconst b = 2;`;
    const output = buildTextPrintable({ text, title: 'a.js', tree: js(text) });
    const doc = parse(output.kind === 'document' ? output.html : '');
    const pre = doc.querySelector('pre')!;
    expect(pre.textContent).toBe(text);
    const keywords = [...pre.querySelectorAll('span')].filter((s) => s.textContent === 'const');
    expect(keywords).toHaveLength(2);
    expect([...pre.querySelectorAll('span')].some((s) => (s.textContent ?? '').length > LONG_LINE_THRESHOLD)).toBe(false);
  });
});
