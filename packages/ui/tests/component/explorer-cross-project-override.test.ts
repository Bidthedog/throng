/**
 * 050 T037 (FR-016, research R10) — a language override follows a file that a paste MOVED.
 *
 * `documents.movePath` renames within ONE project, so a cross-project cut-paste composes the carry from
 * the two project-scoped calls the daemon does offer: read the override in the source
 * (`getState`), write it in the target (`setState`), clear the source. Within one project it is still
 * the single `movePath` it always was. A COPY carries nothing: the copy is a new document, and
 * inheriting a language chosen for a different file would be a guess.
 */
import { waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';
import { TransferCompletionHost } from '../../src/renderer/explorer/transfer-completion.js';
import { resetPendingRevealForTests } from '../../src/renderer/explorer/pending-reveal.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => {
  localStorage.clear();
  resetPendingRevealForTests();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const mount = () => mountExplorer(standardHost, { extra: createElement(TransferCompletionHost) });

describe('language override carry after a paste (050 T037)', () => {
  it('moves the override ACROSS projects: read in the source, written in the target, cleared in the source', async () => {
    const m = await mount();
    m.daemon.seedOverride('project-a', 'src/main.ts', 'typescript');

    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/lib/main.ts'],
      undo: {
        kind: 'move',
        items: [{ from: 'C:/projects/demo/src/main.ts', to: 'D:/projects/other/lib/main.ts' }],
        projects: { source: 'project-a', target: 'project-b' },
        at: 1,
      },
    });

    await waitFor(() => expect(m.daemon.override('project-b', 'lib/main.ts')).toBe('typescript'));
    expect(m.daemon.override('project-a', 'src/main.ts')).toBeUndefined();
    // …and it was composed from getState/setState, not a (project-local) movePath.
    const methods = m.daemon.calls.map((c) => c.method);
    expect(methods).toContain('document.getState');
    expect(methods).not.toContain('document.movePath');
  });

  it('writes nothing when the moved file had no override', async () => {
    const m = await mount();

    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/lib/plain.txt'],
      undo: {
        kind: 'move',
        items: [{ from: 'C:/projects/demo/src/plain.txt', to: 'D:/projects/other/lib/plain.txt' }],
        projects: { source: 'project-a', target: 'project-b' },
        at: 1,
      },
    });

    await waitFor(() => expect(m.daemon.calls.map((c) => c.method)).toContain('document.getState'));
    expect(m.daemon.calls.map((c) => c.method)).not.toContain('document.setState');
  });

  it('still uses movePath inside ONE project', async () => {
    const m = await mount();
    m.daemon.seedOverride('project-a', 'a.txt', 'markdown');

    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-a',
      placed: ['C:/projects/demo/Docs/a.txt'],
      undo: {
        kind: 'move',
        items: [{ from: 'C:/projects/demo/a.txt', to: 'C:/projects/demo/Docs/a.txt' }],
        at: 1,
      },
    });

    await waitFor(() => expect(m.daemon.override('project-a', 'Docs/a.txt')).toBe('markdown'));
    const moves = m.daemon.calls.filter((c) => c.method === 'document.movePath');
    expect(moves).toHaveLength(1);
    expect(moves[0]!.params).toMatchObject({ fromRelPath: 'a.txt', toRelPath: 'Docs/a.txt' });
  });

  it('carries nothing for a copy (no moved pairs in its entry)', async () => {
    const m = await mount();
    m.daemon.seedOverride('project-a', 'a.txt', 'markdown');

    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/a.txt'],
      undo: null,
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(m.daemon.override('project-b', 'a.txt')).toBeUndefined();
    expect(m.daemon.override('project-a', 'a.txt')).toBe('markdown');
  });

  it('carries the MOVED pairs of a replacing paste, and only those', async () => {
    const m = await mount();
    m.daemon.seedOverride('project-a', 'moved.ts', 'typescript');
    m.daemon.seedOverride('project-a', 'copied.ts', 'typescript');

    m.transfer.done({
      jobId: 'job-1',
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      placed: ['D:/projects/other/moved.ts', 'D:/projects/other/copied.ts'],
      undo: {
        kind: 'paste',
        moved: [{ from: 'C:/projects/demo/moved.ts', to: 'D:/projects/other/moved.ts' }],
        copied: [{ from: 'C:/projects/demo/copied.ts', to: 'D:/projects/other/copied.ts' }],
        replaced: [],
        projects: { source: 'project-a', target: 'project-b' },
        at: 1,
      },
    });

    await waitFor(() => expect(m.daemon.override('project-b', 'moved.ts')).toBe('typescript'));
    expect(m.daemon.override('project-b', 'copied.ts')).toBeUndefined();
    expect(m.daemon.override('project-a', 'copied.ts')).toBe('typescript');
  });
});
