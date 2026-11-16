import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import type { NodeRendererProps } from 'react-arborist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ICON_SET } from '@throng/core';
import { TreeRow } from '../../src/renderer/explorer/tree-node.js';
import { ExplorerRowContext, type ExplorerRowCtx } from '../../src/renderer/explorer/explorer-context.js';
import type { TreeNodeData } from '../../src/renderer/explorer/use-explorer-data.js';

/**
 * 069 FR-059 — resting the pointer on a File Explorer row opens a popover with the row's icon, large, to
 * the left of its path, in place of the row's plain `title`.
 *
 * Layer: component — what the row renders on hover and when it puts it away; jsdom has no layout, so the
 * placement is `useAnchoredPosition`'s, already proven by the tab popover, and the look is asserted on the
 * stylesheet below.
 */
const DELAY = 300;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mountRow(data: Partial<TreeNodeData> = {}): HTMLElement {
  const node = {
    data: { id: 'src/app.py', name: 'app.py', kind: 'file', relPath: 'src/app.py', isSymlink: false, ...data },
    isOpen: false,
    isEditing: false,
    isSelected: false,
    isFocused: false,
    willReceiveDrop: false,
  } as unknown as NodeRendererProps<TreeNodeData>['node'];
  const ctx = { popoverDelayMs: DELAY, cutPaths: new Set(), dirtyPaths: new Set(), activeFilePath: null } as unknown as ExplorerRowCtx;
  const { container } = render(
    createElement(
      ExplorerRowContext.Provider,
      { value: ctx },
      createElement(TreeRow, { node, style: {}, dragHandle: undefined } as unknown as NodeRendererProps<TreeNodeData>),
    ),
  );
  return container.querySelector('.tree-row') as HTMLElement;
}

const rest = (row: HTMLElement, ms = DELAY): void => {
  fireEvent.pointerOver(row);
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const asDrawn = (markup: string): string => Object.assign(document.createElement('span'), { innerHTML: markup }).innerHTML;

describe('the File Explorer row popover (069 FR-059)', () => {
  it('replaces the row’s plain title', () => {
    expect(mountRow().hasAttribute('title')).toBe(false);
  });

  it('opens only once the pointer has rested for the delay', () => {
    const row = mountRow();
    rest(row, DELAY - 1);
    expect(screen.queryByTestId('explorer-path-popover')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('explorer-path-popover')).toBeTruthy();
  });

  it('shows the row’s own icon, then its path, and describes the row', () => {
    const row = mountRow();
    rest(row);
    const popover = screen.getByTestId('explorer-path-popover');
    const [icon, path] = [...popover.children];
    expect(icon).toHaveAttribute('data-testid', 'explorer-path-popover-icon');
    expect(icon!.querySelector('.icon')!.innerHTML).toBe(asDrawn(DEFAULT_ICON_SET.filePython));
    expect(path).toHaveTextContent('src/app.py');
    expect(row).toHaveAttribute('aria-describedby', popover.id);
  });

  it('names the root by its name', () => {
    const row = mountRow({ id: '__root__', name: 'throng', kind: 'folder', relPath: '' });
    rest(row);
    expect(screen.getByTestId('explorer-path-popover')).toHaveTextContent('throng');
  });

  it('goes away on a press and stays away until the pointer leaves', () => {
    const row = mountRow();
    rest(row);
    fireEvent.pointerDown(row);
    expect(screen.queryByTestId('explorer-path-popover')).toBeNull();
    rest(row);
    expect(screen.queryByTestId('explorer-path-popover')).toBeNull();
    fireEvent.pointerOut(row);
    rest(row);
    expect(screen.getByTestId('explorer-path-popover')).toBeTruthy();
  });

  it('does not open over a stranded pointer, and opens once the pointer really moves (021 FR-035)', () => {
    const row = mountRow();
    document.body.setAttribute('data-window-blurred', '');
    rest(row);
    expect(screen.queryByTestId('explorer-path-popover')).toBeNull();
    document.body.removeAttribute('data-window-blurred');
    fireEvent.pointerMove(row);
    act(() => {
      vi.advanceTimersByTime(DELAY);
    });
    expect(screen.getByTestId('explorer-path-popover')).toBeTruthy();
  });

  it('closes when the window loses focus', () => {
    const row = mountRow();
    rest(row);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.queryByTestId('explorer-path-popover')).toBeNull();
  });

  it('goes away when the pointer leaves', () => {
    const row = mountRow();
    rest(row);
    fireEvent.pointerOut(row);
    expect(screen.queryByTestId('explorer-path-popover')).toBeNull();
  });
});

describe('the popover’s look (069 FR-059)', () => {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/theme.css'), 'utf8');
  const rule = (selector: string): string =>
    new RegExp(`(^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? '';

  it('centres the icon on the path, beside it', () => {
    expect(rule('.explorer-path-popover')).toMatch(/display:\s*flex/);
    expect(rule('.explorer-path-popover')).toMatch(/align-items:\s*center/);
  });

  it('draws the icon at twice the theme’s icon size', () => {
    expect(rule('.explorer-path-popover__icon .icon')).toMatch(/width:\s*calc\(var\(--throng-size-icon, 16px\) \* 2\)/);
  });
});
