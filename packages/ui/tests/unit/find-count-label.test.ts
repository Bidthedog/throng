/**
 * The find bar's `N of M` counter is digit-grouped (043 FR-014).
 *
 * ══ WHY THIS TEST EXISTS AT ALL ══
 *
 * The constitution's digit-grouping rule (4.5.0, widened by 5.4.0) enumerates the surfaces that
 * predate it and have not yet been brought over. This counter is one of them, and it is the one
 * whose magnitude "routinely passes 1,000" — a find over a large file or a long terminal scrollback
 * reaches four and five figures as a matter of course, and `12384 of 20480` is a wall of digits
 * nobody reads as a position. The gap is required to be closed before this surface's next NUMERIC
 * change; FR-014 makes this feature that change, so the debt is settled here rather than deferred
 * again.
 *
 * ══ WHY A `unit` TEST, AND WHY IT TAKES A LOCALE ══
 *
 * The label is a pure function of a count and a term, so nothing needs rendering to settle it — and
 * a function is what makes the locale testable at all. `Intl` reads its default from the runtime, so
 * a rendered component can be handed nothing that would change it, and the case that actually
 * matters — a locale that groups with `.` — would be untestable at every layer. That is the same
 * reasoning `status-strip.tsx`'s `statusReadouts` records for taking a locale argument.
 *
 * ══ WHAT IS DELIBERATELY NOT ASSERTED ══
 *
 * That grouping reaches a STORED value. It cannot: this function produces a string for display and
 * has no inverse and no caller that writes. The store's `count` stays a pair of numbers, which is
 * what crosses into `SearchCount` and out to the controllers.
 */
import { describe, expect, it } from 'vitest';
import { findCountLabel } from '../../src/renderer/search/find-bar.js';

const count = (current: number, total: number) => ({ current, total });

describe('the counter is grouped at every magnitude (FR-014, constitution 5.4.0)', () => {
  it('groups four figures and above', () => {
    // The case the constitution names: a find over a large document. Ungrouped this reads
    // `12384 of 20480`.
    expect(findCountLabel(count(12384, 20480), 'the', 'en-US')).toBe('12,384 of 20,480');
  });

  it('groups the total even while the current match is small', () => {
    // The first match of many — the state the bar is in the instant a term is typed, and the one a
    // magnitude threshold would render inconsistently against the line above.
    expect(findCountLabel(count(1, 4096), 'the', 'en-US')).toBe('1 of 4,096');
  });

  it('leaves small numbers exactly as they were', () => {
    /*
     * 4.5.0 removed 018's five-digit floor, so the rule is "grouped at every magnitude" rather than
     * "grouped above a threshold" — and a small number simply comes back unchanged. This is what
     * proves the change is additive: every existing short label still reads as it always did.
     */
    expect(findCountLabel(count(3, 9), 'the', 'en-US')).toBe('3 of 9');
    expect(findCountLabel(count(12, 999), 'the', 'en-US')).toBe('12 of 999');
  });
});

describe('the ACTIVE LOCALE decides the separator, not a comma (FR-014)', () => {
  it('groups with a full stop where the locale does', () => {
    /*
     * The whole reason `formatGrouped` exists rather than a hand-rolled comma. A German user reads
     * `12.384 of 20.480`; a call site that wrote its own comma would show them a number their own
     * locale renders differently everywhere else in the application.
     */
    expect(findCountLabel(count(12384, 20480), 'the', 'de-DE')).toBe('12.384 of 20.480');
  });

  it('groups with a space where the locale does', () => {
    // French groups with a narrow no-break space. Asserted by comparing against `Intl` itself
    // rather than by typing the character, which is invisible in a diff and easy to get wrong.
    const grouped = new Intl.NumberFormat('fr-FR', { useGrouping: true }).format(20480);
    expect(findCountLabel(count(1, 20480), 'the', 'fr-FR')).toBe(`1 of ${grouped}`);
  });
});

describe('the two states that are not a count at all', () => {
  it('says "No results" for a term that matched nothing', () => {
    // 013 FR-009's no-results state. Zero is not a position, so it is not rendered as one.
    expect(findCountLabel(count(0, 0), 'zzz', 'en-US')).toBe('No results');
  });

  it('says nothing at all before a term is typed', () => {
    /*
     * An empty bar has not searched and must not claim it found nothing — the distinction 013
     * FR-009 draws between "no results" and "not yet run". `0 of 0` would be a wrong figure stated
     * confidently, which is the same trap `statusReadouts` avoids by omitting an unsettled readout.
     */
    expect(findCountLabel(count(0, 0), '', 'en-US')).toBe('');
  });
});
