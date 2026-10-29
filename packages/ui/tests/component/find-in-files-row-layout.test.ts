/**
 * 060 US2 / FR-006, FR-007, FR-009, FR-011 — how a result row and its heading are laid out.
 *
 * A row reads snippet first, position last (FR-006); nests visibly deeper than its heading (FR-007);
 * its match carries the find bar's shared class (FR-009); and a heading's icon comes from the same
 * source the explorer uses (FR-011). All DOM facts. What the shared class LOOKS like is a stylesheet
 * fact, guarded in `tests/unit/find-in-files-match-style.test.ts`.
 *
 * Layer: component — structure and attributes; jsdom applies no stylesheet.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import { Icon } from '../../src/renderer/common/icon.js';
import { fileIconToken } from '../../src/renderer/explorer/tree-icons.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let bridge: FileSearchStub;

beforeEach(() => {
  __resetFindInFilesState();
  bridge = installFileSearchStub();
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

function seed(): void {
  renderFindInFilesPanel();
  bridge.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [
      { ...resultRow('src/deep/util.ts', 1_234, 40), column: 1_005 },
      resultRow('src/app.ts', 2, 80),
    ],
    totalMatches: 2,
  });
}

const group = (key: string): HTMLElement => screen.getByTestId(`fif-group-header-${key}`);
const row = (relPath: string, from: number): HTMLElement =>
  screen.getByTestId(`fif-row-${relPath}-${from}`);

/** The glyph the active theme draws for a token — what an `<Icon>` renders, asked of the component itself. */
function glyphOf(token: string): string {
  const { container, unmount } = render(createElement(Icon, { token }));
  const text = container.textContent ?? '';
  unmount();
  return text;
}

/**
 * A pixel value out of an inline `padding-left`, with the icon-size token fixed at 16 px.
 *
 * jsdom evaluates no `calc()`, so the expression is read here: tokens are substituted and the
 * remaining `+ * ( )` arithmetic is evaluated by a tiny recursive-descent parser rather than `eval`.
 */
function paddingPx(el: HTMLElement): number {
  const raw = el.style.paddingLeft;
  const src = raw
    .replace(/var\(--throng-size-icon\)/g, '16')
    .replace(/calc/g, '')
    .replace(/px/g, '')
    .replace(/\s+/g, '');
  let i = 0;
  const peek = (): string => src[i] ?? '';
  const number = (): number => {
    if (peek() === '(') {
      i += 1;
      const v = sum();
      i += 1; // ')'
      return v;
    }
    const start = i;
    while (/[\d.]/.test(peek())) i += 1;
    return Number(src.slice(start, i));
  };
  const product = (): number => {
    let v = number();
    while (peek() === '*') {
      i += 1;
      v *= number();
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+') {
      i += 1;
      v += product();
    }
    return v;
  };
  const value = sum();
  expect(Number.isNaN(value), `unreadable padding-left "${raw}"`).toBe(false);
  return value;
}

describe('a row reads snippet first, position last (FR-006)', () => {
  it('orders its children snippet, then position', () => {
    seed();

    const kids = Array.from(row('src/app.ts', 80).children).map((c) => c.className);
    expect(kids).toEqual(['fif-row__snippet', 'fif-row__pos']);
  });

  it('writes the position as (line:character), digit-grouped', () => {
    seed();

    expect(row('src/deep/util.ts', 40).querySelector('.fif-row__pos')).toHaveTextContent(
      '(1,234:1,005)',
    );
    expect(row('src/app.ts', 80).querySelector('.fif-row__pos')).toHaveTextContent('(2:7)');
  });
});

describe('a row nests deeper than its heading (FR-007)', () => {
  it('has more left padding than its own heading in the Per file grouping', () => {
    seed();
    fireEvent.click(screen.getByTestId(`fif-grouping-file-${PANEL_ID}`));

    expect(paddingPx(row('src/app.ts', 80))).toBeGreaterThan(paddingPx(group('src/app.ts')));
  });

  it('has more left padding than its own heading at every depth of Per file and folder', () => {
    seed();
    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    // Folder (depth 0) → file (depth 1) → row (depth 2): each step must read as deeper.
    const folder = paddingPx(group('src/deep'));
    const file = paddingPx(group('src/deep/util.ts'));
    const match = paddingPx(row('src/deep/util.ts', 40));
    expect(file).toBeGreaterThan(folder);
    expect(match).toBeGreaterThan(file);
  });

  it('indents a row past its heading by more than the heading steps from its parent', () => {
    // R12: the row lines up under the heading's TEXT, not under its chevron, so the step from a file
    // heading to its rows is wider than the step between two heading levels.
    seed();
    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));

    const headingStep =
      paddingPx(group('src/deep/util.ts')) - paddingPx(group('src/deep'));
    const rowStep = paddingPx(row('src/deep/util.ts', 40)) - paddingPx(group('src/deep/util.ts'));
    expect(rowStep).toBeGreaterThan(headingStep);
  });
});

describe('a heading’s icon is the explorer’s (FR-011)', () => {
  it('draws a file heading with fileIconToken(name)', () => {
    seed();
    fireEvent.click(screen.getByTestId(`fif-grouping-file-${PANEL_ID}`));

    const icon = group('src/deep/util.ts').querySelector('.fif-group__icon .icon');
    expect(icon?.textContent).toBe(glyphOf(fileIconToken('util.ts')));
  });

  it('draws a folder heading open when expanded and closed when collapsed', () => {
    seed();
    fireEvent.click(screen.getByTestId(`fif-grouping-fileAndFolder-${PANEL_ID}`));
    const iconOf = (): string | null | undefined =>
      group('src/deep').querySelector('.fif-group__icon .icon')?.textContent;

    expect(iconOf()).toBe(glyphOf('folderOpen'));

    fireEvent.click(screen.getByTestId('fif-group-toggle-src/deep'));

    expect(iconOf()).toBe(glyphOf('folder'));
  });
});

describe('a match uses the find bar’s shared class (FR-009)', () => {
  it('carries throng-search-match alongside fif-match', () => {
    seed();

    const mark = row('src/app.ts', 80).querySelector('mark');
    expect(mark).toHaveClass('fif-match');
    expect(mark).toHaveClass('throng-search-match');
  });
});
