import { describe, expect, it } from 'vitest';
import { scanLinkLine } from '../../src/links/scan-line.js';

/**
 * REPRODUCTION — a bare email address in an editor is read as a relative FILE PATH.
 *
 * Reported against round five: `someone@example.com` in an editor tries to open
 * `D:\throng\tests\test 1\someone@example.com` — the base directory plus the text — instead of the
 * mail client. The Markdown preview gets it right, because markdown-it autolinks a bare address into
 * a real `mailto:` href before throng ever sees it, so the two surfaces disagree about the same
 * characters (FR-104, FR-166).
 *
 * WHY IT HAPPENS. Nothing in `packages/core/src/links/` knows what an email address is — the word
 * appears in no scanner. `detectWebLinks` wants a scheme or a `www.` host; `detectProtocolSpans`
 * wants a literal `mailto:`. So a bare address reaches the path detector, which sees `name.ext` with
 * a plausible extension and no separator required, and claims it.
 *
 * WHAT THIS ASSERTS, and why it is written as two separate cases: the first is the DEFECT and holds
 * whatever is decided — a bare email is not a file on disk under any reading. The second is the FIX
 * the report asks for, that it becomes a `mailto:` link like the one the preview draws, and it is
 * the one that depends on a ruling.
 *
 * Written at this layer because `scanLinkLine` is the single place both panel types take their links
 * from — the editor's `linkHitsBetween` and the terminal's provider both compose it — so the defect
 * and its fix are visible here with no editor, no terminal and no app.
 */
describe('a bare email address is not a file path (reported 2026-09-20)', () => {
  const ADDRESS = 'someone@example.com';

  it('THE DEFECT: it is claimed as a path candidate', () => {
    const scanned = scanLinkLine(ADDRESS);
    expect(scanned.paths.map((c) => c.text), 'a bare email is not a file on disk').toEqual([]);
  });

  it('THE FIX AS REPORTED: it is a mailto link, as the Markdown preview already draws it', () => {
    const scanned = scanLinkLine(ADDRESS);
    expect(scanned.protocol.map((p) => p.uri)).toEqual(['mailto:someone@example.com']);
  });

  it('in a sentence, the address alone is the span — not the punctuation after it', () => {
    const scanned = scanLinkLine('Write to someone@example.com, or to a.b-c@sub.example.co.uk.');
    expect(scanned.paths.map((c) => c.text)).toEqual([]);
    expect(scanned.protocol.map((p) => p.uri)).toEqual([
      'mailto:someone@example.com',
      'mailto:a.b-c@sub.example.co.uk',
    ]);
  });

  it('an explicit mailto: is unaffected — one span, not two', () => {
    const scanned = scanLinkLine('mailto:someone@example.com');
    expect(scanned.protocol.map((p) => p.uri)).toEqual(['mailto:someone@example.com']);
    expect(scanned.paths.map((c) => c.text)).toEqual([]);
  });

  /*
   * The controls. A bare address is a link only because `mailto` is allowlisted, and the two shapes
   * below are the ones a naive email pattern would swallow: a Windows path that happens to contain an
   * `@`, and a scoped npm package, neither of which is an address.
   */
  it('with mailto off the allowlist, a bare address is no link at all — still not a path', () => {
    const scanned = scanLinkLine(ADDRESS, { allowlist: new Set(['tel']) });
    expect(scanned.protocol).toEqual([]);
    expect(scanned.paths.map((c) => c.text)).toEqual([]);
  });

  it('a path carrying an @ is still a path', () => {
    const scanned = scanLinkLine('D:\\p\\node_modules\\@scope\\pkg\\index.ts');
    expect(scanned.protocol).toEqual([]);
    expect(scanned.paths.map((c) => c.text)).toEqual(['D:\\p\\node_modules\\@scope\\pkg\\index.ts']);
  });
});
