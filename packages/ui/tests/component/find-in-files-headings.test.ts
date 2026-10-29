/**
 * 060 US2 / FR-004, FR-005 — what a heading says, and what hovering it says.
 *
 * A heading used to repeat the whole project-relative path, which for a deep file is a line of text
 * mostly spent on folders the nesting already shows. Now the label is the NAME, the full path moves
 * to the tooltip, and the one grouping with no folder heading above its files (`file`) keeps the
 * folder — as muted text after the name, so it can truncate first.
 *
 * Layer: component — labels, titles and the muted span are DOM facts. Weight and colour of those
 * spans are stylesheet facts, guarded in `tests/unit/find-in-files-match-style.test.ts`.
 */
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
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
      resultRow('src/deep/util.ts', 1, 0),
      resultRow('src/app.ts', 1, 0),
      resultRow('README.md', 1, 0),
    ],
    totalMatches: 3,
  });
}

const group = (key: string): HTMLElement => screen.getByTestId(`fif-group-header-${key}`);
const label = (key: string): string => group(key).querySelector('.fif-group__key')?.textContent ?? '';

function chooseGrouping(id: 'file' | 'fileAndFolder' | 'folderTree'): void {
  fireEvent.click(screen.getByTestId(`fif-grouping-${id}-${PANEL_ID}`));
}

describe('Per file grouping (FR-004)', () => {
  it('labels a file heading with its name and puts its folder in a muted span after it', () => {
    seed();
    chooseGrouping('file');

    expect(label('src/deep/util.ts')).toBe('util.ts');
    expect(screen.getByTestId('fif-group-dir-src/deep/util.ts')).toHaveTextContent('src/deep');
  });

  it('shows no folder for a file in the project root', () => {
    seed();
    chooseGrouping('file');

    expect(label('README.md')).toBe('README.md');
    expect(screen.queryByTestId('fif-group-dir-README.md')).toBeNull();
  });

  it('gives every heading its full root-relative path as its tooltip (FR-005)', () => {
    seed();
    chooseGrouping('file');

    expect(group('src/deep/util.ts')).toHaveAttribute('title', 'src/deep/util.ts');
    expect(group('README.md')).toHaveAttribute('title', 'README.md');
  });
});

describe('Per file and folder grouping (FR-004, FR-005)', () => {
  it('labels a file heading with its base name and draws no folder span', () => {
    seed();
    chooseGrouping('fileAndFolder');

    expect(label('src/deep/util.ts')).toBe('util.ts');
    expect(screen.queryByTestId('fif-group-dir-src/deep/util.ts')).toBeNull();
  });

  it('keeps the folder heading’s path as its label, "/" for the root, and titles it with the same', () => {
    seed();
    chooseGrouping('fileAndFolder');

    expect(label('src/deep')).toBe('src/deep');
    expect(group('src/deep')).toHaveAttribute('title', 'src/deep');
    // The project root is a folder heading with the empty key.
    expect(label('')).toBe('/');
    expect(group('')).toHaveAttribute('title', '/');
  });

  it('titles a file heading with its full path', () => {
    seed();
    chooseGrouping('fileAndFolder');

    expect(group('src/deep/util.ts')).toHaveAttribute('title', 'src/deep/util.ts');
  });
});

describe('[derived] Folder structure grouping (FR-004, FR-005)', () => {
  it('labels a folder heading with its last segment and a file heading with its name', () => {
    seed();
    chooseGrouping('folderTree');

    expect(label('src')).toBe('src');
    expect(label('src/deep')).toBe('deep');
    expect(label('src/deep/util.ts')).toBe('util.ts');
    expect(label('src/app.ts')).toBe('app.ts');
  });

  it('titles every heading with its full root-relative path', () => {
    seed();
    chooseGrouping('folderTree');

    expect(group('src/deep')).toHaveAttribute('title', 'src/deep');
    expect(group('src/deep/util.ts')).toHaveAttribute('title', 'src/deep/util.ts');
    expect(group('README.md')).toHaveAttribute('title', 'README.md');
  });
});
