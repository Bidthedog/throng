import { describe, expect, it } from 'vitest';
import {
  reconcilePanelNames,
  uniquePanelName,
  isDefaultPanelName,
  nextDefaultPanelName,
} from '@throng/core';

/**
 * No two panels anywhere in throng may share a name (024 follow-up). These are the RULES; what is
 * actually taken is a question about every project and sub-workspace, which only the daemon can
 * answer.
 */
describe('uniquePanelName', () => {
  it('grants the name asked for when nothing holds it', () => {
    expect(uniquePanelName('Build', [])).toBe('Build');
    expect(uniquePanelName('Build', ['Server', 'Tests'])).toBe('Build');
  });

  it('suffixes from 2 — the existing holder is implicitly (1)', () => {
    expect(uniquePanelName('Build', ['Build'])).toBe('Build (2)');
    expect(uniquePanelName('Build', ['Build', 'Build (2)'])).toBe('Build (3)');
    // A third clash does NOT become "Build (2) (2)".
    expect(uniquePanelName('Build', ['Build', 'Build (2)', 'Build (3)'])).toBe('Build (4)');
  });

  it('compares case-insensitively — two panels a user cannot tell apart are the same name', () => {
    expect(uniquePanelName('Build', ['build'])).toBe('Build (2)');
    expect(uniquePanelName('BUILD', ['Build'])).toBe('BUILD (2)');
    // …and the GRANTED name keeps the user's own capitalisation.
    expect(uniquePanelName('MyPanel', ['mypanel'])).toBe('MyPanel (2)');
  });

  it('ignores surrounding whitespace when comparing, and trims what it grants', () => {
    expect(uniquePanelName('  Build  ', ['Build'])).toBe('Build (2)');
    expect(uniquePanelName('  Build  ', [])).toBe('Build');
  });

  it('leaves an empty name to the caller rather than inventing one', () => {
    expect(uniquePanelName('   ', ['Build'])).toBe('');
  });
});

describe('reconcilePanelNames', () => {
  it('keeps the FIRST claim and moves the newcomer', () => {
    const changed = reconcilePanelNames([
      { id: 'a', name: 'Build' },
      { id: 'b', name: 'Build' },
      { id: 'c', name: 'Build' },
    ]);
    // The panel a user has been calling "Build" keeps it; only the later ones move. A name they
    // TYPED keeps its words and takes a suffix — the generated "Panel n" sequence is renumbered
    // instead, which the global-sequence tests below cover.
    expect(changed).toEqual([
      { id: 'b', from: 'Build', to: 'Build (2)' },
      { id: 'c', from: 'Build', to: 'Build (3)' },
    ]);
  });

  it('reports nothing when every name is already unique', () => {
    expect(reconcilePanelNames([
      { id: 'a', name: 'Build' },
      { id: 'b', name: 'Server' },
    ])).toEqual([]);
  });

  it('treats one panel seen twice as one panel', () => {
    // A panel cloned into a sub-workspace shares its id: the same panel, not a clash with itself.
    expect(reconcilePanelNames([
      { id: 'a', name: 'Build' },
      { id: 'a', name: 'Build' },
    ])).toEqual([]);
  });

  it('resolves a case-insensitive clash', () => {
    expect(reconcilePanelNames([
      { id: 'a', name: 'Build' },
      { id: 'b', name: 'BUILD' },
    ])).toEqual([{ id: 'b', from: 'BUILD', to: 'BUILD (2)' }]);
  });
});

describe('generated panel names run in one global sequence (024 follow-up, 048 FR-127)', () => {
  it('recognises a generated name, and only a generated one', () => {
    expect(isDefaultPanelName('Blank Panel')).toBe(true);
    expect(isDefaultPanelName('Blank Panel 4')).toBe(true);
    expect(isDefaultPanelName('  Blank Panel 7  ')).toBe(true);
    expect(isDefaultPanelName('blank panel 3')).toBe(true); // names compare case-insensitively
    // The pre-FR-127 shape is still one throng generated, so it rejoins the sequence too (FR-128).
    expect(isDefaultPanelName('Panel 1')).toBe(true);
    expect(isDefaultPanelName('panel 42')).toBe(true);
    // Anything a user would have typed is NOT a generated name and must never be renumbered.
    expect(isDefaultPanelName('Build')).toBe(false);
    expect(isDefaultPanelName('Panel')).toBe(false);
    expect(isDefaultPanelName('Panel 1 (2)')).toBe(false);
    expect(isDefaultPanelName('Blank Panel (2)')).toBe(false);
    expect(isDefaultPanelName('My Blank Panel')).toBe(false);
    expect(isDefaultPanelName('Blank Panel one')).toBe(false);
  });

  it('starts at an unnumbered "Blank Panel", then takes the lowest free number from 2', () => {
    expect(nextDefaultPanelName([])).toBe('Blank Panel');
    expect(nextDefaultPanelName(['Blank Panel'])).toBe('Blank Panel 2');
    expect(nextDefaultPanelName(['Blank Panel', 'Blank Panel 2', 'Blank Panel 3'])).toBe('Blank Panel 4');
  });

  it('fills a gap left by a deleted panel rather than counting past it', () => {
    expect(nextDefaultPanelName(['Blank Panel', 'Blank Panel 3'])).toBe('Blank Panel 2');
    expect(nextDefaultPanelName(['Blank Panel 2'])).toBe('Blank Panel');
  });

  it('ignores names that are not part of the sequence, legacy "Panel N" included', () => {
    expect(nextDefaultPanelName(['Build', 'Deploy', 'Blank Panel'])).toBe('Blank Panel 2');
    expect(nextDefaultPanelName(['Panel 1', 'Panel 2'])).toBe('Blank Panel');
  });

  it('is case-insensitive about what is taken', () => {
    expect(nextDefaultPanelName(['blank panel', 'BLANK PANEL 2'])).toBe('Blank Panel 3');
  });

  it('renumbers a generated name that is taken, instead of suffixing it', () => {
    // The whole point: a second project's first panel is "Blank Panel 2", never "Blank Panel (2)".
    expect(uniquePanelName('Blank Panel', ['Blank Panel'])).toBe('Blank Panel 2');
    expect(uniquePanelName('Blank Panel', ['Blank Panel', 'Blank Panel 2'])).toBe('Blank Panel 3');
  });

  it('leaves a free generated name alone rather than renumbering it', () => {
    expect(uniquePanelName('Blank Panel 5', ['Blank Panel'])).toBe('Blank Panel 5');
  });

  it('still SUFFIXES a name the user typed, because they chose those words', () => {
    expect(uniquePanelName('Build', ['Build'])).toBe('Build (2)');
  });

  it('reconciles existing duplicates into the sequence', () => {
    const changed = reconcilePanelNames([
      { id: 'a', name: 'Blank Panel' },
      { id: 'b', name: 'Blank Panel' },
      { id: 'c', name: 'Blank Panel' },
    ]);
    expect(changed).toEqual([
      { id: 'b', from: 'Blank Panel', to: 'Blank Panel 2' },
      { id: 'c', from: 'Blank Panel', to: 'Blank Panel 3' },
    ]);
  });
});
