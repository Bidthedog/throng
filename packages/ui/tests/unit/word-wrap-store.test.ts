import { afterEach, describe, expect, it } from 'vitest';
import {
  wordWrapDocKey,
  documentWordWrap,
  setDocumentWordWrap,
  toggleDocumentWordWrap,
  forgetWordWrap,
  hasWordWrap,
  __resetWordWrapStore,
} from '../../src/renderer/editor/word-wrap-store.js';

afterEach(() => __resetWordWrapStore());

describe('word-wrap store (024 US1) — per document, not per panel', () => {
  it('keys by file path so two panels on one file share the flag', () => {
    const a = wordWrapDocKey('D:/p/foo.ts', 'panel-1');
    const b = wordWrapDocKey('D:/p/foo.ts', 'panel-2');
    expect(a).toBe(b);
  });

  it('keys an untitled buffer per panel so they are independent', () => {
    expect(wordWrapDocKey(null, 'panel-1')).not.toBe(wordWrapDocKey(null, 'panel-2'));
  });

  it('seeds from the type default on first sight, then remembers', () => {
    const k = wordWrapDocKey('D:/p/a.ts', 'p1');
    expect(documentWordWrap(k, true)).toBe(true); // seeded On
    setDocumentWordWrap(k, false);
    expect(documentWordWrap(k, true)).toBe(false); // seed ignored once set
  });

  it('toggles and returns the new value', () => {
    const k = wordWrapDocKey('D:/p/b.ts', 'p1');
    expect(toggleDocumentWordWrap(k, true)).toBe(false); // was seeded On → Off
    expect(toggleDocumentWordWrap(k, true)).toBe(true);
  });

  it('a second panel on the same file adopts the current (possibly toggled) value, not the default', () => {
    const k = wordWrapDocKey('D:/p/c.ts', 'p1');
    documentWordWrap(k, true); // panel 1 seeds On
    setDocumentWordWrap(k, false); // toggled Off
    // Panel 2 opens the same file with a default of On, but must adopt the document's current Off.
    const k2 = wordWrapDocKey('D:/p/c.ts', 'p2');
    expect(documentWordWrap(k2, true)).toBe(false);
  });

  it('forgets a document so a reopen re-seeds from the default (FR-003)', () => {
    const k = wordWrapDocKey('D:/p/d.ts', 'p1');
    documentWordWrap(k, true);
    setDocumentWordWrap(k, false);
    forgetWordWrap(k);
    expect(hasWordWrap(k)).toBe(false);
    expect(documentWordWrap(k, true)).toBe(true); // reopened → back to the default
  });
});
