import { describe, it, expect } from 'vitest';
import { panelUnsaved, tabUnsaved, projectUnsaved } from '../../src/editor/indicators.js';
import type { EditorDocument } from '../../src/editor/document.js';

function doc(panelId: string, dirty: boolean): EditorDocument {
  return {
    panelId,
    ownerKind: 'project',
    ownerProjectId: 'A',
    filePath: `C:/proj/${panelId}.ts`,
    displayName: `${panelId}.ts`,
    relativeFolder: '',
    encoding: 'utf8',
    hasBom: false,
    lineEnding: 'lf',
    dirty,
    recoveryTempPath: `C:/recovery/${panelId}`,
  };
}

describe('unsaved-indicator aggregation (006, US8)', () => {
  it('panelUnsaved reflects the document dirty flag', () => {
    expect(panelUnsaved(doc('p1', true))).toBe(true);
    expect(panelUnsaved(doc('p1', false))).toBe(false);
    expect(panelUnsaved(undefined)).toBe(false);
  });

  it('tabUnsaved is true when any editor in the tab is dirty', () => {
    expect(tabUnsaved([doc('a', false), doc('b', false)])).toBe(false);
    expect(tabUnsaved([doc('a', false), doc('b', true)])).toBe(true);
    expect(tabUnsaved([])).toBe(false);
  });

  it('projectUnsaved is true when any editor in the project is dirty', () => {
    expect(projectUnsaved([doc('a', false), doc('b', true)])).toBe(true);
    expect(projectUnsaved([doc('a', false)])).toBe(false);
  });
});
