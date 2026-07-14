/**
 * Seed-from-selection, extended for blocks and multi-cursors (016, FR-025i · T082).
 *
 * The rule these tests exist to defend is a NEGATIVE one: with an ambiguous selection, seed NOTHING.
 * The tempting implementation — read the "primary" selection and seed from that — passes any test
 * that only checks the happy path, and then silently searches for one arbitrary row of the user's
 * ten-row block.
 */
import { describe, expect, it } from 'vitest';
import { seedFromSelections } from '../../src/editor/seed-selection.js';

describe('an unambiguous single line seeds', () => {
  it('seeds from an ordinary single-line selection (013 FR-002b, unchanged)', () => {
    expect(seedFromSelections(['needle'])).toBe('needle');
  });

  it('seeds from a ONE-ROW block — it IS a single-line selection', () => {
    // Nothing distinguishes a one-row block from an ordinary selection, and refusing to seed from it
    // would make find behave differently for two selections the user cannot tell apart.
    expect(seedFromSelections(['needle'])).toBe('needle');
  });

  it('ignores the empty ranges around it — a block of carets plus one selection is still one term', () => {
    expect(seedFromSelections(['', 'needle', ''])).toBe('needle');
  });
});

describe('an ambiguous selection seeds NOTHING', () => {
  it('seeds nothing from a MULTI-ROW block — never an arbitrary row of it', () => {
    expect(seedFromSelections(['alpha', 'beta', 'gamma'])).toBe('');
  });

  it('seeds nothing from a multi-cursor set with more than one non-empty selection', () => {
    expect(seedFromSelections(['one', 'two'])).toBe('');
  });

  it('seeds nothing from a multi-LINE selection (013’s original rule)', () => {
    expect(seedFromSelections(['alpha\nbeta'])).toBe('');
    expect(seedFromSelections(['alpha\r\nbeta'])).toBe('');
  });

  it('seeds nothing from bare carets, or from no selection at all', () => {
    expect(seedFromSelections(['', '', ''])).toBe('');
    expect(seedFromSelections([''])).toBe('');
    expect(seedFromSelections([])).toBe('');
  });
});
