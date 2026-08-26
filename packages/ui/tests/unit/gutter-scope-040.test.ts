/**
 * The gutter setting is app-wide and the gutter holds line numbers — nothing else (040 US4, FR-046).
 *
 * ══ WHY A NEGATIVE NEEDS A TEST AT ALL ══
 *
 * FR-046 is a MUST NOT, and a requirement nothing asserts is a requirement that decays quietly. Two
 * decays are specifically likely here, and both look like improvements from inside the change that
 * makes them:
 *
 *   • **Scope creep.** The editor section is full of per-language and per-document precedent —
 *     `indentByLanguage`, `languageByExtension`, and a per-DOCUMENT word-wrap authority in
 *     `word-wrap-store.ts`. Following any of those patterns for the gutter would give the user a
 *     combinatorial surface nobody asked for, and would put a second authority beside the setting.
 *   • **Gutter creep.** `lineNumbers()` is one of several gutters CodeMirror ships. Adding
 *     `foldGutter()` or a lint gutter is a two-line change that quietly redefines what
 *     `editor.showGutter` means — the user turns off line numbers and fold arrows vanish with them,
 *     or survive alone in a strip they thought they had switched off.
 *
 * ══ WHY A SOURCE SWEEP, AND WHY BY IDENTIFIER ══
 *
 * There is no runtime observable for "this does not exist", so the evidence is the source. The
 * sweep is for specific IDENTIFIERS, never for the word "gutter": this feature's own compartment is
 * called `gutterCompartment` and its comments say "gutter" a few dozen times, so a word sweep would
 * fail on the implementation it is meant to protect.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, settingsLeaves } from '@throng/core';

/** The two directories that own the editor and its documents. */
const ROOTS = [
  resolve(process.cwd(), 'packages/ui/src/renderer/editor'),
  resolve(process.cwd(), 'packages/core/src/editor'),
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const FILES = ROOTS.flatMap(sources);

/** Every file whose text contains `needle`, as repo-relative-ish paths for a readable failure. */
function hits(needle: string): string[] {
  return FILES.filter((f) => readFileSync(f, 'utf8').includes(needle)).map((f) =>
    f.replace(process.cwd(), '').replace(/\\/g, '/'),
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Anti-vacuity: the sweep can actually see the source
 * ────────────────────────────────────────────────────────────────────────── */

describe('the sweep reads real files', () => {
  it('collects the editor sources from both packages', () => {
    expect(FILES.length, 'no editor sources were found — the paths above have moved').toBeGreaterThan(
      10,
    );
    // A control the negatives below cannot give themselves: a needle that IS present, in the file
    // this feature edits. If this fails, every absence assertion here is passing on an empty sweep.
    expect(hits('gutterCompartment'), 'the compartment this feature adds').not.toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-046 — one setting, app-wide: no per-document and no per-language override
 * ────────────────────────────────────────────────────────────────────────── */

describe('the gutter has exactly one control, and it is app-wide (FR-046)', () => {
  it('declares exactly one gutter setting', () => {
    const gutterKeys = settingsLeaves().filter((k) => /gutter/i.test(k));
    expect(gutterKeys).toEqual(['editor.showGutter']);
  });

  it('adds no per-language gutter map to the editor section', () => {
    // `indentByLanguage` and `languageByExtension` are the shapes this would copy. A key like
    // `gutterByLanguage` would be one, and there must be none.
    const editorKeys = Object.keys(DEFAULT_APP_SETTINGS.editor).filter((k) => /gutter/i.test(k));
    expect(editorKeys).toEqual(['showGutter']);
  });

  it('adds no per-document gutter authority beside the word-wrap one', () => {
    /*
     * `word-wrap-store.ts` is the per-document precedent: a value owned per DOCUMENT rather than per
     * panel, so two views of one file cannot disagree (Principle XI). The gutter is a preference,
     * not a property of the document, so there is nothing for such a store to own — and a second
     * authority for a value the settings already own would be exactly the divergence XI forbids.
     */
    for (const symbol of ['documentGutter', 'toggleDocumentGutter', 'useDocumentGutter']) {
      expect(hits(symbol), `${symbol} would be a second authority for the gutter`).toEqual([]);
    }
    expect(
      FILES.filter((f) => /gutter[-.].*store/i.test(f)),
      'a per-document gutter store',
    ).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-046 — the gutter holds line numbers and nothing else
 * ────────────────────────────────────────────────────────────────────────── */

describe('no other gutter content is introduced (FR-046)', () => {
  it('registers no fold gutter and no code folding', () => {
    for (const symbol of ['foldGutter', 'codeFolding', 'foldService']) {
      expect(hits(symbol), `${symbol} would add content to the gutter throng does not draw`).toEqual(
        [],
      );
    }
  });

  it('registers no diagnostics gutter', () => {
    for (const symbol of ['lintGutter', '@codemirror/lint', 'setDiagnostics']) {
      expect(hits(symbol), `${symbol} would put diagnostics in the gutter`).toEqual([]);
    }
  });

  it('defines no gutter markers of its own', () => {
    // `GutterMarker` is how a caller draws anything other than a line number in the strip.
    for (const symbol of ['GutterMarker', 'gutterLineClass', 'gutterWidgetClass']) {
      expect(hits(symbol), `${symbol} draws non-line-number gutter content`).toEqual([]);
    }
  });
});
