/**
 * The shared typeahead picker — rows, marks, keyboard, the cap, and the two empty states.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/quick-open.e2e.ts` (034 FR-045).
 *
 * `QuickOpen` renders almost nothing itself: it builds entries from the file index and hands them
 * to this component, which owns the list, the filtering, the marked runs, the highlight, the cap and
 * the messages. So does the tab picker. Testing `Picker` therefore covers what several E2E specs
 * were each asserting separately through an app — and covers it for pickers not written yet.
 *
 * It takes no context: `title`, `entries`, `rank`, `onChoose`, `onDismiss` and a few strings. That is
 * the whole reason this migration is cheap, and it is worth saying why it was nearly not: the first
 * attempt aimed at `QuickOpen`, which needs `useWorkspace` — a context whose provider subscribes to
 * the daemon and loads a layout. That would have meant exporting the context purely to test through
 * it, when one layer down there was a component with no dependencies at all. The production change
 * was written, then reverted, once `Picker` turned out to be the real subject.
 *
 * WHAT STAYS END-TO-END: which files reach the list (the index over a real project), where a chosen
 * file opens, and the chord that summons the modal from a terminal without the shell seeing it.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Picker, type PickerEntry } from '../../src/renderer/common/picker.js';

/** Root-relative POSIX paths, as Quick Open builds them: `text === label`. */
const entry = (path: string): PickerEntry => ({ id: path, text: path, label: path });

const FILES = [
  'src/app.ts',
  'src/widget/index.ts',
  'docs/guide.md',
  'README.md',
].map(entry);

function open(overrides: Partial<Parameters<typeof Picker>[0]> = {}) {
  const onChoose = vi.fn();
  const onDismiss = vi.fn();
  render(
    createElement(Picker, {
      title: 'Quick Open',
      testId: 'quickopen',
      entries: FILES,
      onChoose,
      onDismiss,
      emptyMessage: 'No files match',
      ...overrides,
    } as Parameters<typeof Picker>[0]),
  );
  return { onChoose, onDismiss, user: userEvent.setup() };
}

const rows = (): HTMLElement[] =>
  Array.from(screen.getByTestId('quickopen-list').querySelectorAll('[data-testid^="quickopen-row-"]'));

describe('the list', () => {
  it('lists every entry by its full label before anything is typed', () => {
    open();
    expect(rows()).toHaveLength(FILES.length);
    expect(screen.getByTestId('quickopen-row-src/widget/index.ts')).toBeVisible();
  });

  it('narrows to what matches, and MARKS the matched run inside the label', async () => {
    // The marks are the reason a row shows its whole path rather than a basename: they are what
    // tells the user WHY this row matched.
    const { user } = open();
    await user.type(screen.getByTestId('quickopen-input'), 'widget');

    expect(rows()).toHaveLength(1);
    const row = screen.getByTestId('quickopen-row-src/widget/index.ts');
    const marks = within(row).getAllByText('widget', { selector: 'mark, .picker__mark' });
    expect(marks.length).toBeGreaterThan(0);
  });

  it('marks EVERY term of a multi-word query, in whatever order they appear', async () => {
    /*
     * Migrated from `tab-picker.e2e.ts` (K10). Two claims the single-term case cannot make: that a
     * second term is marked at all, and that the query's word order is not the text's — `index src`
     * finds `src/widget/index.ts`, where `src` comes first.
     *
     * Whether the two words MATCH in any order is `compileQuery`, proved on its own in
     * `packages/core/tests/unit/picker-match.test.ts` down to this exact shape of example. What is
     * asserted here is that both matched runs are drawn.
     */
    const { user } = open();
    await user.type(screen.getByTestId('quickopen-input'), 'index src');

    const row = screen.getByTestId('quickopen-row-src/widget/index.ts');
    const marks = Array.from(row.querySelectorAll('mark.picker__mark'));
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.textContent?.toLowerCase()).sort()).toEqual(['index', 'src']);
  });

  it('marks NOTHING while the query is empty', async () => {
    // Everything matches an empty query, so marking everything would say nothing at all.
    open();
    expect(document.querySelectorAll('mark.picker__mark')).toHaveLength(0);
  });

  it('says so when nothing matches, and keeps the list on screen', async () => {
    const { user, onDismiss } = open();
    await user.type(screen.getByTestId('quickopen-input'), 'zzzzz');

    expect(screen.getByTestId('quickopen-empty')).toHaveTextContent('No files match');
    expect(rows()).toHaveLength(0);
    // A no-match is not a dismissal — the user is mid-typo, and closing would lose their query.
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('choosing', () => {
  it('moves the highlight with ArrowDown and chooses the highlighted row on Enter', async () => {
    // The E2E pressed Down, Down, Enter and asserted the THIRD file opened. The third row is the
    // claim; which file that is belongs to whatever supplied the entries.
    const { user, onChoose } = open();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0]).toMatchObject({ id: FILES[2].id });
  });

  it('starts with the FIRST row highlighted, and ArrowUp walks back', async () => {
    // Migrated from `tab-picker.e2e.ts` (K3). The highlight is readable as an attribute rather than
    // inferred from what Enter later chose, so a picker that highlighted nothing — or highlighted
    // the right row while Enter chose another — is distinguishable from one that works.
    const { user } = open();
    expect(rows()[0]).toHaveAttribute('data-highlighted', 'true');

    await user.keyboard('{ArrowDown}');
    expect(rows()[1]).toHaveAttribute('data-highlighted', 'true');
    expect(rows()[0]).toHaveAttribute('data-highlighted', 'false');

    await user.keyboard('{ArrowUp}');
    expect(rows()[0]).toHaveAttribute('data-highlighted', 'true');
  });

  it('Enter on a list with NOTHING in it chooses nothing and does not dismiss', async () => {
    // Migrated from `tab-picker.e2e.ts` (K12). The user is mid-typo: pressing Enter at that moment
    // must not be read as "choose", and must not close the picker and lose the query.
    const { user, onChoose, onDismiss } = open();
    await user.type(screen.getByTestId('quickopen-input'), 'zzzzz');
    expect(rows()).toHaveLength(0);

    await user.keyboard('{Enter}');
    expect(onChoose).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('quickopen-empty')).toBeVisible();
  });

  it('brings the rows back when the query is corrected', async () => {
    const { user } = open();
    const input = screen.getByTestId('quickopen-input');
    await user.type(input, 'zzzzz');
    expect(rows()).toHaveLength(0);

    await user.clear(input);
    await user.type(input, 'guide');
    expect(rows()).toHaveLength(1);
  });

  it('chooses the row that was clicked', async () => {
    const { user, onChoose } = open();
    await user.click(screen.getByTestId('quickopen-row-docs/guide.md'));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0]).toMatchObject({ id: 'docs/guide.md' });
  });

  it('dismisses on Escape without choosing', async () => {
    const { user, onChoose, onDismiss } = open();
    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('the cap (FR-014)', () => {
  const many = Array.from({ length: 250 }, (_, i) => entry(`src/file-${String(i).padStart(4, '0')}.ts`));

  it('draws at most maxRows and says how many matched', () => {
    open({
      entries: many,
      maxRows: 200,
      truncatedMessage: (shown: number, total: number) => `Showing ${shown} of ${total} matches`,
    });

    expect(rows()).toHaveLength(200);
    expect(screen.getByTestId('quickopen-truncated')).toHaveTextContent('Showing 200 of 250 matches');
  });

  it('says nothing about truncation when everything fits', () => {
    open({ maxRows: 200, truncatedMessage: (s: number, t: number) => `Showing ${s} of ${t}` });
    expect(screen.queryByTestId('quickopen-truncated')).toBeNull();
  });
});

describe('a seeded query (FR-060)', () => {
  it('opens already filtered by it, rather than showing a full list with stale text above', async () => {
    // The distinction the requirement turns on: `initialQuery` is the picker's OWN query state, so
    // the rows on screen are that query's results at the first paint.
    open({ initialQuery: 'guide' });
    expect(screen.getByTestId('quickopen-input')).toHaveValue('guide');
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId('quickopen-row-docs/guide.md')).toBeVisible();
  });
});
