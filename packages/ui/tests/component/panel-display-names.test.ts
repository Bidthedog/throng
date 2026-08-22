import { renderHook } from '@testing-library/react';
import type { Panel } from '@throng/core';
import { afterEach, describe, expect, it } from 'vitest';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import {
  clearTerminalTitle,
  setTerminalTitle,
} from '../../src/renderer/terminal/title-store.js';
import { usePanelDisplayNames } from '../../src/renderer/workspace/use-panel-display-names.js';

/**
 * #294 — the tab hover popover listed panels by names those panels do not wear.
 *
 * ══ WHAT WAS ACTUALLY WRONG ══
 *
 * `tab-group.tsx:274` called the one-rule function without the sources the rule needs:
 *
 *     panels.map((panel) => panelDisplayTitle(panel, undefined, maxNameLength))
 *
 * `panelDisplayTitle` has been the single place a panel's name is decided since #218, so this was
 * never a second implementation drifting — it was the right function starved of its inputs. With no
 * sources it can only fall through to `panel.title`, the placeholder.
 *
 * The shape of the symptom is what hid it: a panel the user had RENAMED looked correct, because an
 * override is decided from the panel alone and needs no sources. Only automatic names were wrong,
 * which reads as "the popover is odd about some panels" rather than "an argument is missing".
 *
 * ══ WHY THE ASSERTIONS ARE PAIRED WITH THE HEADER'S ══
 *
 * Each test below states the name the panel's own header shows for the same inputs, because the
 * defect is a DISAGREEMENT between two surfaces rather than a wrong string in isolation. A test
 * that only pinned the popover's output could be satisfied by changing the rule, which would fix
 * the popover by breaking the header.
 */

const MAX = 40;

function terminalPanel(over: Partial<Panel> = {}): Panel {
  return {
    type: 'panel',
    id: 'p-term',
    originProjectId: 'proj',
    title: 'Panel 3',
    kind: 'terminal',
    config: { flavourId: 'windows-powershell', flavourLabel: 'Windows PowerShell' },
    ...over,
  } as Panel;
}

function editorPanel(over: Partial<Panel> = {}): Panel {
  return {
    type: 'panel',
    id: 'p-ed',
    originProjectId: 'proj',
    title: 'Panel 4',
    kind: 'editor',
    config: { filePath: 'C:/proj/src/composition-root.ts' },
    ...over,
  } as Panel;
}

/** Just the names — for the #294 assertions, which are about what a panel is CALLED. */
function names(panels: Panel[]): string[] {
  return rows(panels).map((r) => r.name);
}

/** The whole row, name and type — for the #304 assertions. */
function rows(panels: Panel[]) {
  const { result } = renderHook(() => usePanelDisplayNames(panels, MAX));
  return result.current;
}

afterEach(() => {
  clearTerminalTitle('p-term');
  removeEditorState('p-ed');
});

describe('the popover names a panel the way the panel names itself', () => {
  it('gives a terminal its LIVE window title, not its flavour', () => {
    setTerminalTitle('p-term', 'ISSUE MANAGEMENT');

    expect(names([terminalPanel()])).toEqual(['ISSUE MANAGEMENT']);
  });

  it('falls back to the flavour while the program has announced nothing', () => {
    // Not a bug — the flavour is the secondary source, and it names the panel in the gap before
    // any announcement and for ever if none comes.
    expect(names([terminalPanel()])).toEqual(['Windows PowerShell']);
  });

  it("gives an editor its FILE name, not the panel placeholder", () => {
    setEditorState('p-ed', { filePath: 'C:/proj/src/composition-root.ts' });

    expect(names([editorPanel()])).toEqual(['composition-root']);
  });

  it("uses the panel's persisted path before the live editor has registered", () => {
    // `setPanelType(editor, …)` writes the path onto the panel synchronously while the live state
    // registers a beat later, so a freshly opened editor has only the config to name itself from.
    expect(names([editorPanel()])).toEqual(['composition-root']);
  });

  it('lets a user rename outrank every live source', () => {
    setTerminalTitle('p-term', 'ISSUE MANAGEMENT');

    expect(names([terminalPanel({ title: 'Deploy', titleIsCustom: true })])).toEqual(['Deploy']);
  });

  it('names every panel in a tab, in layout order', () => {
    setTerminalTitle('p-term', 'ISSUE MANAGEMENT');
    setEditorState('p-ed', { filePath: 'C:/proj/src/composition-root.ts' });

    expect(names([terminalPanel(), editorPanel()])).toEqual([
      'ISSUE MANAGEMENT',
      'composition-root',
    ]);
  });

  it('still bounds the name, so a 400-character window title cannot widen the surface', () => {
    setTerminalTitle('p-term', 'x'.repeat(400));

    expect(names([terminalPanel()])[0]).toHaveLength(MAX);
  });
});

/**
 * #304 — each line also says what KIND of panel it is.
 *
 * A name says WHICH panel and only implies its kind: a file stem reads like an editor, a shell
 * title reads like a terminal. The inference fails exactly where it matters — a renamed panel wears
 * whatever the user typed, so "Deploy" could be either.
 */
describe('and carries what type of panel it is', () => {
  it('takes the icon and the label from the panel-type REGISTRY', () => {
    /*
     * From the registry rather than a map here, because `PanelKind` is `'terminal' | (string & {})`
     * and the registry is the documented open extension point (005 FR-002) — a hard-coded pair
     * would silently omit the next type someone registers, in the one surface whose job is to say
     * what a tab contains.
     *
     * The label is verbatim, asymmetry and all (`Terminal` vs `Editor Panel`): the panel header's
     * own kind marker shows the same registry string, and two surfaces naming one thing differently
     * is the defect #294 was about.
     */
    setEditorState('p-ed', { filePath: 'C:/proj/src/composition-root.ts' });

    expect(rows([terminalPanel(), editorPanel()])).toEqual([
      { name: 'Windows PowerShell', icon: 'terminal', typeLabel: 'Terminal' },
      { name: 'composition-root', icon: 'editorPanel', typeLabel: 'Editor Panel' },
    ]);
  });

  it('carries NEITHER for an untyped panel, whose name is already the placeholder', () => {
    // The "Select Panel Type" form is what it is showing, so the absence is the information.
    expect(rows([terminalPanel({ id: 'p-none', kind: undefined, title: 'Panel 9' })])).toEqual([
      { name: 'Panel 9', icon: null, typeLabel: null },
    ]);
  });

  it('carries neither for a kind the registry does not know', () => {
    // A layout persisted by a build that had a type this one does not. Guessing an icon from the
    // id would be worse than showing none.
    expect(rows([terminalPanel({ id: 'p-x', kind: 'not-registered', title: 'Panel 7' })])).toEqual([
      { name: 'Panel 7', icon: null, typeLabel: null },
    ]);
  });

  it('bounds the NAME only — an icon is a fixed size and cannot widen anything', () => {
    setTerminalTitle('p-term', 'x'.repeat(400));

    expect(rows([terminalPanel()])[0]).toEqual({
      name: 'x'.repeat(MAX),
      icon: 'terminal',
      typeLabel: 'Terminal',
    });
  });
});
