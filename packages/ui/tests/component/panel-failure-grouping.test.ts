import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 059 FR-054 — within one operation, two failures share a notice only when their error is the same.
 *
 * Hand-testing MT-02 opened a not-decodable file, a PNG and a UTF-32 file one after another: all three
 * joined one "Couldn't open <project>" notice headed by the first file's sentence. The notice merges on
 * `groupKey`, so this drives the two raise sites with their seams stubbed and reads the key each hands
 * to `notify`.
 *
 * Layer: component — the hooks read React context (workspace, projects, notify); the key's own rules
 * are proven at unit level in `grouping.test.ts`.
 */

const workspace = vi.hoisted(() => ({ value: { layout: null as unknown } }));
const notified = vi.hoisted(() => ({ calls: [] as { groupKey?: string }[] }));

vi.mock('../../src/renderer/state/workspace-store.js', () => ({
  useWorkspace: () => workspace.value,
}));
vi.mock('../../src/renderer/state/projects-store.js', () => ({
  useProjects: () => ({ projects: [{ id: 'proj', name: 'UPPER TEST', rootFolder: 'C:/work/upper' }] }),
}));
vi.mock('../../src/renderer/common/notification.js', () => ({
  useNotify: () => ({ notify: (n: { groupKey?: string }) => void notified.calls.push(n) }),
}));

const { useReportPanelFailure, useReportSubjectFailure } = await import(
  '../../src/renderer/workspace/panel-failure-notice.js'
);
const { beginOperation, resetOperationForTests } = await import('../../src/renderer/workspace/operation.js');

const NOT_TEXT = 'That file is not text, so it cannot be opened in an editor.';
const UTF32 = 'This file is UTF-32, which throng does not open.';

function refuse(message: string, name: string): string | undefined {
  const { result } = renderHook(() => useReportSubjectFailure());
  result.current({ subject: name, reason: 'refused', displayPath: name, message, projectId: 'proj' });
  return notified.calls.at(-1)?.groupKey;
}

function panelFails(panelId: string, report: { message: string; causeKind?: 'path-missing' }): string | undefined {
  const { result } = renderHook(() => useReportPanelFailure());
  result.current({ panelId, ...report });
  return notified.calls.at(-1)?.groupKey;
}

beforeEach(() => {
  notified.calls = [];
  resetOperationForTests();
  beginOperation('proj');
  workspace.value = {
    layout: {
      projectId: 'proj',
      tabs: [
        {
          id: 'tab-1',
          title: 'One',
          root: {
            type: 'split',
            children: [
              { type: 'panel', id: 'p-ed', kind: 'editor', title: 'a', config: { filePath: 'C:/work/upper/a.md' } },
              { type: 'panel', id: 'p-term', kind: 'terminal', title: 't', config: {} },
            ],
          },
          activePanelId: 'p-ed',
        },
      ],
      activeTabId: 'tab-1',
    },
  };
});

describe('open refusals share a notice only when they say the same thing (FR-054)', () => {
  it('a binary file and a UTF-32 file raise two notices', () => {
    expect(refuse(NOT_TEXT, 'picture.png')).not.toBe(refuse(UTF32, 'wide-utf32.txt'));
  });

  it('a second binary file joins the first one’s notice', () => {
    expect(refuse(NOT_TEXT, 'picture.png')).toBe(refuse(NOT_TEXT, 'picture-2.png'));
  });
});

describe('panel casualties of one missing root still share one notice (030 FR-029)', () => {
  it('an editor and a terminal reporting the missing root in different words get one key', () => {
    const editor = panelFails('p-ed', { message: 'The file may have been moved.', causeKind: 'path-missing' });
    const terminal = panelFails('p-term', { message: 'The folder could not be found.', causeKind: 'path-missing' });
    expect(editor).toBeDefined();
    expect(editor).toBe(terminal);
  });

  it('two panel failures with different messages and no cause get two keys', () => {
    expect(panelFails('p-ed', { message: 'The file is locked.' })).not.toBe(
      panelFails('p-term', { message: 'The shell could not start.' }),
    );
  });
});
