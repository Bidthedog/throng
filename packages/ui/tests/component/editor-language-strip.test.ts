import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  effectiveLanguage,
  removePanelLanguage,
  setPanelLanguage,
} from '../../src/renderer/editor/editor-language.js';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';

/**
 * What the editor's status strip says the language is (024 FR-004/FR-004c/FR-005a).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-language-override.e2e.ts:129` (035 T055) —
 * `test('the strip shows the detected language, and an extension-less file reads Plain Text')`.
 *
 * ══ TWO PROVEN HALVES, AN UNTESTED JOIN — AGAIN ══
 *
 * Detection is `@throng/core`'s `resolveLanguage`, and it is thoroughly covered there.
 * `editor-language.ts` is the renderer's side: a resolution store, the precedence chain that feeds
 * it, and the hook the strip reads. It had **no test at any layer**, so the E2E was the only thing
 * saying the strip shows what detection decided rather than, say, the file's extension upper-cased.
 *
 * ══ WHY 'PLAIN TEXT' IS THE HALF WORTH HAVING ══
 *
 * The E2E's second assertion is the interesting one: a file detection cannot place says so, plainly,
 * rather than guessing. An indicator that fell back to the extension — or to the previous file's
 * language, which is the failure a shared panel makes easy — is wrong in a way the user cannot see
 * until their syntax colouring is silently that of another language.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * That opening `main.rs` in a real editor causes `setPanelLanguage` to be called at all — that is
 * `useEditor`'s load path, and `editor-language-override.e2e.ts` keeps the tests that drive it — and
 * everything in that file about computed colours and the themed control, which is layout.
 */

const mounted: string[] = [];

/** Render the strip for a panel whose language has already resolved. */
function strip(panelId: string, filePath: string | null, override?: string | null) {
  mounted.push(panelId);
  setPanelLanguage(panelId, effectiveLanguage({ filePath, override }));
  render(
    createElement(StatusStrip, { panelId, projectId: 'proj-1', relPath: filePath }),
  );
  return screen.getByTestId(`editor-language-${panelId}`);
}

afterEach(() => {
  for (const id of mounted.splice(0)) removePanelLanguage(id);
});

describe('the strip names the language detection decided on', () => {
  it('shows the detected language for a file with a known extension', () => {
    expect(strip('p1', 'C:/proj/main.rs')).toHaveTextContent('Rust');
  });

  it('reads PLAIN TEXT for an extension-less file, rather than guessing', () => {
    /*
     * The assertion the E2E made by clicking a second file into the SAME panel — which is also where
     * the failure lives: a strip that kept the previous file's language would be wrong in a way the
     * user only discovers when the colouring is silently another language's.
     */
    expect(strip('p1', 'C:/proj/scriptfile')).toHaveTextContent('Plain Text');
  });

  it('reads PLAIN TEXT for a document that has never been saved', () => {
    // No path, so nothing to detect from. The strip still has to say something true.
    expect(strip('p1', null)).toHaveTextContent('Plain Text');
  });

  it('shows the OVERRIDE where one is set, outranking the extension (FR-005a)', () => {
    // `.txt` detects as plain text; the user has said otherwise, and the user wins.
    expect(strip('p1', 'C:/proj/notes.txt', 'sql')).toHaveTextContent('SQL');
  });

  it('applies an override to an unsaved document too — the SQL scratchpad case', () => {
    expect(strip('p1', null, 'sql')).toHaveTextContent('SQL');
  });

  it('names its ACTION on hover, because the indicator is a control', () => {
    // Constitution, non-negotiable: an action control says what it does. The LABEL is the language
    // name, which is data — the title is what names the action.
    expect(strip('p1', 'C:/proj/main.rs')).toHaveAttribute('title', 'Set language');
  });
});

describe('two panels resolve independently', () => {
  it('does not let one panel’s language leak into another’s strip', () => {
    /*
     * The store is keyed by panel id and the E2E could not see this: it drove one panel throughout.
     * A strip reading a module-level "current language" instead of its own key would have passed it,
     * and would be wrong the moment a second editor is open — which is the ordinary case.
     */
    mounted.push('p1', 'p2');
    setPanelLanguage('p1', effectiveLanguage({ filePath: 'C:/proj/main.rs' }));
    setPanelLanguage('p2', effectiveLanguage({ filePath: 'C:/proj/notes.txt' }));

    render(createElement(StatusStrip, { panelId: 'p1', projectId: 'proj-1', relPath: 'main.rs' }));
    render(createElement(StatusStrip, { panelId: 'p2', projectId: 'proj-1', relPath: 'notes.txt' }));

    expect(screen.getByTestId('editor-language-p1')).toHaveTextContent('Rust');
    expect(screen.getByTestId('editor-language-p2')).toHaveTextContent('Plain Text');
  });

  it('falls back to plain text for a panel with no resolution at all', () => {
    // A strip mounted before its editor has finished loading. It must not render empty, and it must
    // not render another panel's answer.
    render(createElement(StatusStrip, { panelId: 'never-set', projectId: null, relPath: null }));

    expect(screen.getByTestId('editor-language-never-set')).toHaveTextContent('Plain Text');
  });
});
