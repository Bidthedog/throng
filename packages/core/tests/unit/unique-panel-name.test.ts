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

describe('generated panel names run in one global sequence (024 follow-up)', () => {
  it('recognises a generated name, and only a generated one', () => {
    expect(isDefaultPanelName('Panel 1')).toBe(true);
    expect(isDefaultPanelName('Panel 42')).toBe(true);
    expect(isDefaultPanelName('  Panel 7  ')).toBe(true);
    expect(isDefaultPanelName('panel 3')).toBe(true); // names compare case-insensitively
    // Anything a user would have typed is NOT a generated name and must never be renumbered.
    expect(isDefaultPanelName('Build')).toBe(false);
    expect(isDefaultPanelName('Panel')).toBe(false);
    expect(isDefaultPanelName('Panel 1 (2)')).toBe(false);
    expect(isDefaultPanelName('Panel one')).toBe(false);
    expect(isDefaultPanelName('My Panel 2')).toBe(false);
  });

  it('takes the lowest free number, so the sequence has no gaps', () => {
    expect(nextDefaultPanelName([])).toBe('Panel 1');
    expect(nextDefaultPanelName(['Panel 1'])).toBe('Panel 2');
    expect(nextDefaultPanelName(['Panel 1', 'Panel 2', 'Panel 3'])).toBe('Panel 4');
  });

  it('fills a gap left by a deleted panel rather than counting past it', () => {
    expect(nextDefaultPanelName(['Panel 1', 'Panel 3'])).toBe('Panel 2');
  });

  it('ignores names that are not part of the sequence', () => {
    expect(nextDefaultPanelName(['Build', 'Deploy', 'Panel 1'])).toBe('Panel 2');
  });

  it('is case-insensitive about what is taken', () => {
    expect(nextDefaultPanelName(['panel 1', 'PANEL 2'])).toBe('Panel 3');
  });

  it('renumbers a generated name that is taken, instead of suffixing it', () => {
    // The whole point: a second project's first panel is "Panel 2", never "Panel 1 (2)".
    expect(uniquePanelName('Panel 1', ['Panel 1'])).toBe('Panel 2');
    expect(uniquePanelName('Panel 1', ['Panel 1', 'Panel 2'])).toBe('Panel 3');
  });

  it('leaves a free generated name alone rather than renumbering it', () => {
    expect(uniquePanelName('Panel 5', ['Panel 1'])).toBe('Panel 5');
  });

  it('still SUFFIXES a name the user typed, because they chose those words', () => {
    expect(uniquePanelName('Build', ['Build'])).toBe('Build (2)');
  });

  it('reconciles existing duplicates into the sequence', () => {
    const changed = reconcilePanelNames([
      { id: 'a', name: 'Panel 1' },
      { id: 'b', name: 'Panel 1' },
      { id: 'c', name: 'Panel 1' },
    ]);
    expect(changed).toEqual([
      { id: 'b', from: 'Panel 1', to: 'Panel 2' },
      { id: 'c', from: 'Panel 1', to: 'Panel 3' },
    ]);
  });
});
