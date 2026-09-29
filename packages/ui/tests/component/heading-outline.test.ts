/**
 * 047 T052 — the Go to Heading pop-down (US4, research.md R7,
 * contracts/menus-commands-controls.md "Go to Heading pop-down").
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSymbol } from '@throng/core';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { HeadingOutline, type HeadingOutlineProps } from '../../src/renderer/preview/heading-outline.js';

const PANEL = 'p1';

const sym = (name: string, slug: string, children: DocumentSymbol[] = []): DocumentSymbol => ({
  name,
  level: 1,
  line: 0,
  slug,
  children,
});

// Install -> Windows, macOS; Usage -> Basic; Reference
const HEADINGS: DocumentSymbol[] = [
  sym('Install', 'install', [sym('Windows', 'windows'), sym('macOS', 'macos')]),
  sym('Usage', 'usage', [sym('Basic', 'basic')]),
  sym('Reference', 'reference'),
];

/** A small controlled harness: `open` starts true, and callbacks are recorded. */
function Harness(props: {
  headings: readonly DocumentSymbol[];
  currentSlug?: string | null;
  onJump: (slug: string) => void;
  onClose: () => void;
  initialOpen?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(props.initialOpen ?? true);
  return createElement(
    ConfigProvider,
    null,
    createElement('button', { 'data-testid': 'reopen', onClick: () => setOpen(true) }),
    createElement(HeadingOutline, {
      panelId: PANEL,
      open,
      headings: props.headings,
      currentSlug: props.currentSlug ?? null,
      onJump: props.onJump,
      onClose: () => {
        setOpen(false);
        props.onClose();
      },
    } satisfies HeadingOutlineProps),
  );
}

function mount(over: Partial<Parameters<typeof Harness>[0]> = {}) {
  const onJump = vi.fn();
  const onClose = vi.fn();
  render(createElement(Harness, { headings: HEADINGS, onJump, onClose, ...over }));
  return { onJump, onClose };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('open/closed and roles (contract)', () => {
  it('renders nothing while closed', () => {
    mount({ initialOpen: false });
    expect(screen.queryByTestId(`heading-outline-${PANEL}`)).toBeNull();
  });

  it('opens as role=dialog labelled "Go to heading", search box focused', () => {
    mount();
    const dialog = screen.getByTestId(`heading-outline-${PANEL}`);
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Go to heading');
    const search = screen.getByTestId('heading-outline-search');
    expect(search).toHaveAttribute('aria-label', 'Filter headings');
    expect(search).toHaveFocus();
  });

  it('the list is role=tree, entries role=treeitem with aria-level, and children carry aria-expanded', () => {
    mount();
    const tree = screen.getByRole('tree', { name: 'Headings' });
    const install = within(tree).getByTestId('heading-outline-row-install');
    expect(install).toHaveAttribute('role', 'treeitem');
    expect(install).toHaveAttribute('aria-level', '1');
    expect(install).toHaveAttribute('aria-expanded', 'true');
    const windows = within(tree).getByTestId('heading-outline-row-windows');
    expect(windows).toHaveAttribute('aria-level', '2');
    expect(windows).not.toHaveAttribute('aria-expanded'); // a leaf has none
  });

  it('"No headings" for an empty document', () => {
    mount({ headings: [] });
    expect(screen.getByTestId('heading-outline-empty')).toHaveTextContent('No headings');
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('the current entry carries aria-current="location", and only it', () => {
    mount({ currentSlug: 'usage' });
    expect(screen.getByTestId('heading-outline-row-usage')).toHaveAttribute('aria-current', 'location');
    expect(screen.getByTestId('heading-outline-row-install')).not.toHaveAttribute('aria-current');
  });
});

describe('typing narrows with ancestors (FR-043)', () => {
  it('shows a match and its ancestors, hides everything else', () => {
    mount();
    fireEvent.change(screen.getByTestId('heading-outline-search'), { target: { value: 'win' } });
    expect(screen.getByTestId('heading-outline-row-install')).toBeInTheDocument();
    expect(screen.getByTestId('heading-outline-row-windows')).toBeInTheDocument();
    expect(screen.queryByTestId('heading-outline-row-macos')).toBeNull();
    expect(screen.queryByTestId('heading-outline-row-usage')).toBeNull();
  });

  it('narrowing highlights the FIRST match as active, not the document’s current entry', () => {
    mount({ currentSlug: 'usage' });
    fireEvent.change(screen.getByTestId('heading-outline-search'), { target: { value: 'win' } });
    // 'windows' is the first (and only) match row; the DOM focus stays in the search input the whole
    // time, so "active" here is the roving-tabindex row a Down arrow would land on next.
    expect(screen.getByTestId('heading-outline-row-windows')).toHaveAttribute('tabindex', '0');
  });

  it('a match under a manually collapsed ancestor is still shown (the filter overrides the fold)', () => {
    mount();
    // Collapse "Install" first.
    fireEvent.click(screen.getByTestId('heading-outline-toggle-install'));
    expect(screen.queryByTestId('heading-outline-row-windows')).toBeNull();
    fireEvent.change(screen.getByTestId('heading-outline-search'), { target: { value: 'win' } });
    expect(screen.getByTestId('heading-outline-row-windows')).toBeInTheDocument();
  });

  it('no match shows nothing but the search box', () => {
    mount();
    fireEvent.change(screen.getByTestId('heading-outline-search'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('treeitem')).toBeNull();
  });
});

describe('keyboard navigation (FR-043a)', () => {
  it('Down from the search box lands on the current entry', () => {
    mount({ currentSlug: 'usage' });
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'ArrowDown' });
    expect(screen.getByTestId('heading-outline-row-usage')).toHaveFocus();
  });

  it('Down from the search box with no current entry lands on the first row', () => {
    mount({ currentSlug: null });
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'ArrowDown' });
    expect(screen.getByTestId('heading-outline-row-install')).toHaveFocus();
  });

  it('Up from the first entry returns to the search box', () => {
    mount();
    const search = screen.getByTestId('heading-outline-search');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('heading-outline-row-install'), { key: 'ArrowUp' });
    expect(search).toHaveFocus();
  });

  it('Down/Up walk the visible entries in order', () => {
    mount();
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'ArrowDown' }); // -> install
    fireEvent.keyDown(screen.getByTestId('heading-outline-row-install'), { key: 'ArrowDown' }); // -> windows
    expect(screen.getByTestId('heading-outline-row-windows')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('heading-outline-row-windows'), { key: 'ArrowUp' }); // -> install
    expect(screen.getByTestId('heading-outline-row-install')).toHaveFocus();
  });

  it('Ctrl+G returns focus to the search box from anywhere in the pop-down', () => {
    mount();
    const search = screen.getByTestId('heading-outline-search');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('heading-outline-row-install'), { key: 'g', ctrlKey: true });
    expect(search).toHaveFocus();
  });

  it('Escape closes without jumping and (via onClose) hands focus back', () => {
    const { onJump, onClose } = mount();
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'Escape' });
    expect(onJump).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`heading-outline-${PANEL}`)).toBeNull();
  });
});

describe('closing (FR-042c)', () => {
  it('a pointer-down outside the pop-down closes it without jumping', () => {
    const { onJump, onClose } = mount();
    fireEvent.pointerDown(screen.getByTestId('reopen'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onJump).not.toHaveBeenCalled();
    expect(screen.queryByTestId(`heading-outline-${PANEL}`)).toBeNull();
  });

  it('a pointer-down inside it does not close it', () => {
    const { onClose } = mount();
    fireEvent.pointerDown(screen.getByTestId('heading-outline-search'));
    fireEvent.pointerDown(screen.getByTestId('heading-outline-toggle-install'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('jumping (Enter / click)', () => {
  it('Enter on a row jumps to it and closes', () => {
    const { onJump, onClose } = mount();
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByTestId('heading-outline-row-install'), { key: 'Enter' });
    expect(onJump).toHaveBeenCalledWith('install');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter in the search box jumps to the active row', () => {
    const { onJump } = mount({ currentSlug: 'usage' });
    const search = screen.getByTestId('heading-outline-search');
    fireEvent.keyDown(search, { key: 'ArrowDown' }); // active -> current entry, 'usage'
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onJump).toHaveBeenCalledWith('usage');
  });

  it('clicking a row jumps to it and closes', () => {
    const { onJump, onClose } = mount();
    fireEvent.click(screen.getByTestId('heading-outline-row-reference'));
    expect(onJump).toHaveBeenCalledWith('reference');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the collapse toggle does NOT jump — it only toggles the tree node', () => {
    const { onJump } = mount();
    fireEvent.click(screen.getByTestId('heading-outline-toggle-install'));
    expect(onJump).not.toHaveBeenCalled();
    expect(screen.getByTestId(`heading-outline-${PANEL}`)).toBeInTheDocument(); // still open
  });
});

describe('tree-node collapse is local, never the document’s fold (FR-045)', () => {
  it('collapsing a node hides its descendants but folds nothing about the document', () => {
    mount();
    const toggle = screen.getByTestId('heading-outline-toggle-install');
    expect(screen.getByTestId('heading-outline-row-install')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('heading-outline-row-windows')).toBeNull();
    expect(screen.getByTestId('heading-outline-row-install')).toHaveAttribute('aria-expanded', 'false');
    // Nothing here can express a fold: HeadingOutlineProps has no onFoldChange at all.
    fireEvent.click(toggle);
    expect(screen.getByTestId('heading-outline-row-windows')).toBeInTheDocument();
  });

  it('re-opening keeps collapsedNodes but resets the query (data-model: component-local view state)', () => {
    const onClose = vi.fn();
    const onJump = vi.fn();
    render(createElement(Harness, { headings: HEADINGS, onJump, onClose }));
    fireEvent.click(screen.getByTestId('heading-outline-toggle-install'));
    expect(screen.queryByTestId('heading-outline-row-windows')).toBeNull();
    fireEvent.change(screen.getByTestId('heading-outline-search'), { target: { value: 'usage' } });
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'Escape' }); // closes

    act(() => screen.getByTestId('reopen').click());

    // Query reset — Usage's sibling Install is drawn again, and windows stays hidden (collapse kept).
    expect(screen.getByTestId('heading-outline-search')).toHaveValue('');
    expect(screen.getByTestId('heading-outline-row-install')).toBeInTheDocument();
    expect(screen.queryByTestId('heading-outline-row-windows')).toBeNull();
  });

  it('re-opening highlights the CURRENT entry even with a tree node collapsed above it', () => {
    // Install is collapsed in the tree, so the visible rows are Install, Usage, Basic, Reference.
    // Usage is row 1 of what is drawn but entry 3 of the whole outline — the highlight must follow
    // what is drawn.
    render(createElement(Harness, { headings: HEADINGS, onJump: vi.fn(), onClose: vi.fn(), currentSlug: 'usage' }));
    fireEvent.click(screen.getByTestId('heading-outline-toggle-install'));
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'Escape' });

    act(() => screen.getByTestId('reopen').click());

    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'ArrowDown' });
    expect(screen.getByTestId('heading-outline-row-usage')).toHaveFocus();
  });

  it('re-opening after a search highlights the CURRENT entry, not the first row', () => {
    render(createElement(Harness, { headings: HEADINGS, onJump: vi.fn(), onClose: vi.fn(), currentSlug: 'usage' }));
    fireEvent.change(screen.getByTestId('heading-outline-search'), { target: { value: 'ref' } });
    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'Escape' });

    act(() => screen.getByTestId('reopen').click());

    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'ArrowDown' });
    expect(screen.getByTestId('heading-outline-row-usage')).toHaveFocus();
  });
});
