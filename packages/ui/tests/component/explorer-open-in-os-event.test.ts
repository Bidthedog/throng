/**
 * 067 T125 (FR-116) — the editor refused a file as binary on a double click and raised
 * `throng:open-in-os`; the project's tree hands that file to the OS through the same route as the
 * menu's Open in OS Default Program, so a program-less file raises the same notice (FR-018).
 */
import { act, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const raise = (detail: { projectId: string; relPath: string }): void => {
  act(() => {
    window.dispatchEvent(new CustomEvent('throng:open-in-os', { detail }));
  });
};

describe('throng:open-in-os', () => {
  it("opens the file in the OS default program for this tree's project", async () => {
    const m = await mountExplorer(standardHost, { projectId: 'project-a' });
    raise({ projectId: 'project-a', relPath: 'a.txt' });
    await waitFor(() => expect(m.files.files.openInDefaultProgram).toHaveBeenCalledWith('a.txt'));
  });

  it("ignores another project's file", async () => {
    const m = await mountExplorer(standardHost, { projectId: 'project-a' });
    raise({ projectId: 'project-b', relPath: 'a.txt' });
    expect(m.files.files.openInDefaultProgram).not.toHaveBeenCalled();
  });
});
