/**
 * When the language is (and is not) re-resolved (016, FR-002a/FR-005a).
 *
 * Detection reads the file's EXTENSION. Typing cannot change a file's extension, so re-running
 * detection on a keystroke is pure cost — and worse, it invites exactly the content-sniffing
 * FR-002 forbids. The language is resolved when the document's IDENTITY or CONTENT is replaced:
 * first load, opening another file into the panel, Save-As, revert, external reload. Nowhere else.
 */
import { describe, expect, it } from 'vitest';
import { PLAIN_TEXT_ID } from '@throng/core';
import { effectiveLanguage } from '../../src/renderer/editor/editor-language.js';

describe('effectiveLanguage — the precedence chain, as the editor calls it', () => {
  it('detects from the path on first load', () => {
    expect(effectiveLanguage({ filePath: 'C:\\src\\main.rs' })).toEqual({
      languageId: 'rust',
      source: 'registry',
    });
  });

  it('gives a never-saved document plain text — it has no name to detect from', () => {
    expect(effectiveLanguage({ filePath: null })).toEqual({
      languageId: PLAIN_TEXT_ID,
      source: 'plaintext',
    });
  });

  it('still honours an explicit override on an unpathed document — a scratch buffer can be SQL', () => {
    expect(effectiveLanguage({ filePath: null, override: 'sql' })).toEqual({
      languageId: 'sql',
      source: 'override',
    });
  });

  it('re-detects when the PATH changes — Save-As from `notes` to `notes.py` is now Python', () => {
    expect(effectiveLanguage({ filePath: 'notes' }).languageId).toBe(PLAIN_TEXT_ID);
    expect(effectiveLanguage({ filePath: 'notes.py' }).languageId).toBe('python');
  });

  it('is decided by the NAME alone — the same content under two names gives two languages', () => {
    // The proof that content plays no part: `effectiveLanguage` has no parameter for it. A shebang,
    // a doctype, a `<?php` tag — none of them can reach this function, which is the guarantee.
    expect(effectiveLanguage({ filePath: 'a.py' }).languageId).toBe('python');
    expect(effectiveLanguage({ filePath: 'a.rb' }).languageId).toBe('ruby');
  });

  it('lets the user mapping outrank the registry, and an override outrank both (FR-005a)', () => {
    expect(effectiveLanguage({ filePath: 'legacy.h' }).languageId).toBe('cpp');
    expect(effectiveLanguage({ filePath: 'legacy.h', userMapping: { '.h': 'c' } })).toEqual({
      languageId: 'c',
      source: 'user-mapping',
    });
    expect(
      effectiveLanguage({ filePath: 'legacy.h', override: 'rust', userMapping: { '.h': 'c' } }),
    ).toEqual({ languageId: 'rust', source: 'override' });
  });

  it('opens a file whose stored override names a language this build no longer knows (FR-005b)', () => {
    // It falls through to detection and opens cleanly — no error, no rewrite of the stored id.
    expect(effectiveLanguage({ filePath: 'main.rs', override: 'elvish' })).toEqual({
      languageId: 'rust',
      source: 'registry',
    });
  });
});
