import { describe, expect, it } from 'vitest';
import { renameCommit } from '../../src/workspace/rename-commit.js';

/**
 * #297 — committing a blank rename box clears the override, and #176 stays closed.
 *
 * The two halves are one rule and have to be tested as one, because the tempting version of this
 * change ("blank resets") reopens a bug that cost real work to find. A newly added panel opens
 * straight into rename mode, so clicking away — to choose a panel type, to drag a file in — commits
 * an untouched box. If that could change state, every freshly created panel would be marked
 * renamed, and a custom title outranks every automatic one: the terminal's live window title and
 * the editor's file name would be suppressed on exactly the panels the user had just made.
 *
 * So the blank case is gated on the panel ALREADY being renamed, and the tests below assert both
 * directions of that gate rather than only the new ability.
 */
describe('committing the rename box', () => {
  describe('a blank box', () => {
    it('RESETS a panel that the user had renamed', () => {
      expect(renameCommit('', 'Build', true)).toEqual({ kind: 'reset' });
    });

    it('resets on whitespace too — a box of spaces is a cleared box', () => {
      expect(renameCommit('   ', 'Build', true)).toEqual({ kind: 'reset' });
    });

    it('does NOTHING to a panel that was never renamed (#176)', () => {
      // The click-away path on a new panel. It must not reset, and above all must not mark it.
      expect(renameCommit('', 'Panel 2', false)).toEqual({ kind: 'none' });
    });
  });

  describe('an unchanged box', () => {
    it('is not a rename, however it was committed (#176)', () => {
      expect(renameCommit('Panel 2', 'Panel 2', false)).toEqual({ kind: 'none' });
    });

    it('is not a rename on an already-renamed panel either', () => {
      expect(renameCommit('Build', 'Build', true)).toEqual({ kind: 'none' });
    });

    it('ignores surrounding whitespace when deciding it is unchanged', () => {
      expect(renameCommit('  Build  ', 'Build', true)).toEqual({ kind: 'none' });
    });
  });

  describe('a changed box', () => {
    it('renames, with the trimmed value', () => {
      expect(renameCommit('  Deploy  ', 'Build', true)).toEqual({ kind: 'rename', name: 'Deploy' });
    });

    it('renames a panel that had never been renamed', () => {
      expect(renameCommit('Deploy', 'Panel 2', false)).toEqual({ kind: 'rename', name: 'Deploy' });
    });

    it('treats a name differing only in surrounding space from the seed as unchanged, not new', () => {
      // Otherwise a user who selected the name and retyped it identically would be marked as having
      // renamed the panel, suppressing its automatic title for ever.
      expect(renameCommit('Build ', ' Build', false)).toEqual({ kind: 'none' });
    });
  });
});
