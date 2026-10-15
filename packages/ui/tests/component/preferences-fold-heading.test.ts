/**
 * `FoldHeading` in isolation (056 FR-001..FR-007, contracts/folding.md F1-F7).
 *
 * Layer: component — what the heading renders, its aria attributes, its keyboard handling and its live
 * invalid marker. All of it is DOM; none of it needs a window.
 *
 * The tab-level claims (counts from the registry, persistence, search) are in the
 * `*-tab-folding.test.ts` files; this file owns only the one shared element.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { FoldHeading, FoldAllButtons } from '../../src/renderer/preferences/fold-heading.js';

type Props = Partial<Parameters<typeof FoldHeading>[0]>;

/** A stateful host, so a click really folds and the typed draft below proves the content stays mounted. */
function Host({ initial = false, ...props }: Props & { initial?: boolean }): ReactElement {
  const [folded, setFolded] = useState(initial);
  return createElement(
    FoldHeading,
    {
      level: 3,
      testId: 'sec',
      name: 'Editor',
      total: 1234,
      folded,
      onToggle: () => setFolded((f) => !f),
      ...props,
    },
    createElement('input', { 'data-testid': 'draft' }),
    createElement('input', { 'data-testid': 'flagged', 'aria-invalid': 'false' }),
  );
}

const toggle = (): HTMLElement => screen.getByTestId('sec-toggle');

describe('the heading element (F1, F2)', () => {
  it('is an <hN> holding exactly one button, with aria-expanded and aria-controls', () => {
    const { container } = render(createElement(Host));
    const heading = container.querySelector('h3')!;
    expect(heading).not.toBeNull();
    expect(heading.querySelectorAll('button')).toHaveLength(1);
    expect(toggle().tagName).toBe('BUTTON');
    expect(toggle()).toHaveAttribute('type', 'button');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const controls = toggle().getAttribute('aria-controls')!;
    expect(controls).toBeTruthy();
    expect(container.querySelector(`[id="${controls}"]`)).not.toBeNull();
  });

  it('honours the heading level', () => {
    const { container } = render(createElement(Host, { level: 5 }));
    expect(container.querySelector('h5')).not.toBeNull();
  });

  it('carries a hover title naming the action: Fold while open, Unfold while folded', async () => {
    render(createElement(Host));
    expect(toggle()).toHaveAttribute('title', 'Fold section');
    await userEvent.setup().click(toggle());
    expect(toggle()).toHaveAttribute('title', 'Unfold section');
  });

  it('draws its chevron from the chevron token', () => {
    const { container } = render(createElement(Host));
    expect(container.querySelector('.fold-heading__chevron')).toHaveTextContent(THRONG_THEME.icons.chevron as string);
  });

  it('rotates the chevron only while open', async () => {
    const { container } = render(createElement(Host));
    const chevron = (): Element => container.querySelector('.fold-heading__chevron')!;
    expect(chevron()).toHaveClass('fold-heading__chevron--open');
    await userEvent.setup().click(toggle());
    expect(chevron()).not.toHaveClass('fold-heading__chevron--open');
  });
});

describe('hide, never unmount (F3)', () => {
  it('sets hidden on the content container and keeps the children mounted', async () => {
    const user = userEvent.setup();
    render(createElement(Host));
    await user.type(screen.getByTestId('draft'), 'half-typed');
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    const container = screen.getByTestId('draft').closest('.fold-content')!;
    expect(container).toHaveAttribute('hidden');
    expect(container.id).toBe(toggle().getAttribute('aria-controls'));
    await user.click(toggle());
    expect(container).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('draft')).toHaveValue('half-typed');
  });
});

describe('the count label (F6)', () => {
  it('shows the digit-grouped total', () => {
    render(createElement(Host, { total: 12345 }));
    expect(screen.getByTestId('sec-count')).toHaveTextContent('12,345');
  });

  it('reads "N of M" when a search gives matches', () => {
    render(createElement(Host, { total: 12345, matches: 3 }));
    expect(screen.getByTestId('sec-count')).toHaveTextContent('3 of 12,345');
  });

  it('is shown folded as well as unfolded', () => {
    render(createElement(Host, { initial: true, total: 7 }));
    expect(screen.getByTestId('sec-count')).toHaveTextContent('7');
  });
});

describe('the accessible name (F4)', () => {
  it('labels the group by the NAME alone, without the count or marker', () => {
    render(
      createElement(
        'div',
        { role: 'group', 'aria-labelledby': 'hid' },
        createElement(Host, { headingId: 'hid' }),
      ),
    );
    expect(screen.getByRole('group', { name: 'Editor' })).toBeInTheDocument();
  });
});

describe('the warning marker (F2, F7, FR-007)', () => {
  const flag = (value: 'true' | 'false'): void => {
    screen.getByTestId('flagged').setAttribute('aria-invalid', value);
  };

  it('is absent while unfolded, even when a row inside is invalid', async () => {
    render(createElement(Host));
    flag('true');
    await act(async () => {});
    expect(screen.queryByTestId('sec-invalid')).toBeNull();
  });

  it('shows when folded with an invalid row inside, with a title and accessible name', async () => {
    render(createElement(Host, { initial: false }));
    flag('true');
    await userEvent.setup().click(toggle());
    const marker = await screen.findByTestId('sec-invalid');
    expect(marker).toHaveAttribute('title', 'Contains an invalid entry');
    expect(marker).toHaveAttribute('aria-label', 'Contains an invalid entry');
    expect(marker).toHaveTextContent(THRONG_THEME.icons.warning as string);
    // Announced with the heading: it is inside the toggle button, so it is part of the button's name.
    expect(toggle()).toContainElement(marker);
    expect(screen.getByRole('button', { name: /Contains an invalid entry/ })).toBe(toggle());
  });

  it('appears and clears live, while folded, as the attribute changes', async () => {
    render(createElement(Host, { initial: true }));
    expect(screen.queryByTestId('sec-invalid')).toBeNull();
    await act(async () => {
      flag('true');
    });
    await waitFor(() => expect(screen.getByTestId('sec-invalid')).toBeInTheDocument());
    await act(async () => {
      flag('false');
    });
    await waitFor(() => expect(screen.queryByTestId('sec-invalid')).toBeNull());
  });

  it('also counts a row carrying data-pref-invalid (a problem row that is not an input)', async () => {
    render(createElement(Host, { initial: true }));
    expect(screen.queryByTestId('sec-invalid')).toBeNull();
    await act(async () => {
      screen.getByTestId('flagged').setAttribute('data-pref-invalid', 'true');
    });
    await waitFor(() => expect(screen.getByTestId('sec-invalid')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('flagged').removeAttribute('data-pref-invalid');
    });
    await waitFor(() => expect(screen.queryByTestId('sec-invalid')).toBeNull());
  });

  it('is absent when nothing inside is invalid', () => {
    render(createElement(Host, { initial: true }));
    expect(screen.queryByTestId('sec-invalid')).toBeNull();
  });
});

describe('the folded observer does work proportional to what changed (Principle XII)', () => {
  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  };

  it('runs no full scan for a burst of unrelated child mutations in a folded section', async () => {
    render(createElement(Host, { initial: true }));
    const content = screen.getByTestId('draft').closest('.fold-content') as HTMLElement;
    const scan = vi.spyOn(content, 'querySelector');
    await act(async () => {
      // One append per task, so the observer's own per-task batching cannot hide a scan per mutation.
      for (let i = 0; i < 20; i++) {
        content.appendChild(document.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    await settle();
    expect(scan.mock.calls.length, 'at most one full scan for the whole burst').toBeLessThanOrEqual(1);
    expect(screen.queryByTestId('sec-invalid')).toBeNull();
  });

  it('runs no full scan for unrelated removals while the marker is showing, and keeps the marker', async () => {
    render(createElement(Host, { initial: true }));
    const content = screen.getByTestId('draft').closest('.fold-content') as HTMLElement;
    const filler = Array.from({ length: 20 }, () => content.appendChild(document.createElement('div')));
    await act(async () => {
      screen.getByTestId('flagged').setAttribute('aria-invalid', 'true');
    });
    await waitFor(() => expect(screen.getByTestId('sec-invalid')).toBeInTheDocument());
    const scan = vi.spyOn(content, 'querySelector');
    await act(async () => {
      for (const el of filler) el.remove();
    });
    await settle();
    expect(scan.mock.calls.length).toBeLessThanOrEqual(1);
    expect(screen.getByTestId('sec-invalid')).toBeInTheDocument();
  });

  it('scans once, and clears the marker, when the flagged row itself is removed', async () => {
    render(createElement(Host, { initial: true }));
    const content = screen.getByTestId('draft').closest('.fold-content') as HTMLElement;
    await act(async () => {
      screen.getByTestId('flagged').setAttribute('aria-invalid', 'true');
    });
    await waitFor(() => expect(screen.getByTestId('sec-invalid')).toBeInTheDocument());
    const scan = vi.spyOn(content, 'querySelector');
    await act(async () => {
      screen.getByTestId('flagged').remove();
    });
    await waitFor(() => expect(screen.queryByTestId('sec-invalid')).toBeNull());
    expect(scan.mock.calls.length).toBe(1);
  });

  it('shows the marker when a row that holds an invalid entry is added', async () => {
    render(createElement(Host, { initial: true }));
    const content = screen.getByTestId('draft').closest('.fold-content') as HTMLElement;
    await act(async () => {
      const wrap = document.createElement('div');
      const input = document.createElement('input');
      input.setAttribute('aria-invalid', 'true');
      wrap.appendChild(input);
      content.appendChild(wrap);
    });
    await waitFor(() => expect(screen.getByTestId('sec-invalid')).toBeInTheDocument());
  });
});

describe('operation (FR-004)', () => {
  it('folds when the heading NAME text is clicked, not only the chevron', async () => {
    render(createElement(Host));
    await userEvent.setup().click(screen.getByText('Editor'));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles on Enter and on Space while focused', async () => {
    const user = userEvent.setup();
    render(createElement(Host));
    toggle().focus();
    await user.keyboard('{Enter}');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onToggle once per activation', async () => {
    const onToggle = vi.fn();
    render(createElement(FoldHeading, { level: 3, testId: 'sec', name: 'X', total: 1, folded: false, onToggle }));
    fireEvent.click(toggle());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not put hidden rows in the tab order (they are inside [hidden])', () => {
    render(createElement(Host, { initial: true }));
    expect(screen.getByTestId('draft').closest('[hidden]')).not.toBeNull();
  });
});

describe('FoldAllButtons', () => {
  it('renders Expand All and Collapse All as icon buttons named by title', () => {
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    render(createElement(FoldAllButtons, { tab: 'settings', onExpandAll: onExpand, onCollapseAll: onCollapse }));
    fireEvent.click(screen.getByTestId('settings-expand-all'));
    fireEvent.click(screen.getByTestId('settings-collapse-all'));
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings-expand-all')).toHaveAttribute('title', 'Expand All Sections');
    expect(screen.getByTestId('settings-collapse-all')).toHaveAttribute('title', 'Collapse All Sections');
  });

  it('disables both together', () => {
    render(
      createElement(FoldAllButtons, { tab: 'themes', onExpandAll: vi.fn(), onCollapseAll: vi.fn(), disabled: true }),
    );
    expect(screen.getByTestId('themes-expand-all')).toBeDisabled();
    expect(screen.getByTestId('themes-collapse-all')).toBeDisabled();
  });
});
