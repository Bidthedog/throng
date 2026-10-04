/**
 * 050 T027 (FR-006, FR-013, FR-025) — Paste in the explorer hands the job to main and leaves the
 * clipboard to main.
 *
 * What moved: Paste used to call `files.copy` / `files.move` itself, with root-relative paths held in
 * React state. Now the clipboard is main's (absolute paths, any project) and the paste is a job main
 * runs. So the renderer's whole part is small and is what this file pins:
 *
 *   - it sends the TARGET folder by the shared target rule (004 FR-017) — a folder is itself, a file
 *     is its parent — and nothing else: not the items, which main snapshots from its own clipboard;
 *   - it never touches the clipboard after a paste. A copy stays on it (FR-006) because main leaves it
 *     there, and a cut keeps exactly what did not move because main says so — a renderer that cleared
 *     the clipboard "because a cut was pasted" would be the pre-050 behaviour back;
 *   - a run that ends with failures raises ONE notice naming each failed item (FR-013), and a run
 *     that ends without any raises none.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
  type MountedExplorer,
} from './helpers/explorer-harness.js';
import { TransferCompletionHost } from '../../src/renderer/explorer/transfer-completion.js';
import { PasteProgressNotice } from '../../src/renderer/explorer/paste-progress-notice.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const item = (absPath: string, projectId = 'project-a') => ({
  absPath,
  projectId,
  projectRoot: 'C:/projects/demo',
});

async function mountWithCopy(): Promise<MountedExplorer> {
  const m = await mountExplorer(standardHost, {
    clipboard: { mode: 'copy', items: [item('C:/projects/demo/a.txt')] },
    // The window-level hosts: what finishes a paste, and the notice that reports its failures.
    extra: createElement('div', null, createElement(TransferCompletionHost), createElement(PasteProgressNotice)),
  });
  // The store has read main's clipboard once the paste handler can see it.
  await waitFor(() => expect(m.clipboard.api.get).toHaveBeenCalled());
  return m;
}

const pane = (): HTMLElement => screen.getByTestId('file-explorer-tree');
const pressPaste = (): void => {
  fireEvent.keyDown(document.activeElement ?? pane(), { key: 'v', ctrlKey: true });
};
const notices = (): HTMLElement[] => [
  ...(screen.queryByTestId('notices')?.querySelectorAll<HTMLElement>('.notice') ?? []),
];

describe('Paste sends the target folder to main (050 T027)', () => {
  it('pastes into the selected FOLDER by its project-relative path', async () => {
    const m = await mountWithCopy();
    await userEvent.click(within(m.tree).getByText('Docs'));
    await waitFor(() => expect(m.clipboard.api.get).toHaveBeenCalled());

    pressPaste();

    await waitFor(() => expect(m.transfer.api.paste).toHaveBeenCalledTimes(1));
    expect(m.transfer.api.paste).toHaveBeenCalledWith('Docs');
  });

  it('pastes a FILE selection into its parent folder (the shared target rule)', async () => {
    const m = await mountWithCopy();
    // `a.txt` sits at the root, so its parent is the root: the empty path.
    await userEvent.click(within(m.tree).getByText('a.txt'));

    pressPaste();

    await waitFor(() => expect(m.transfer.api.paste).toHaveBeenCalledTimes(1));
    expect(m.transfer.api.paste).toHaveBeenCalledWith('');
  });

  it('does nothing when the clipboard is empty — no job, no notice', async () => {
    const m = await mountExplorer(standardHost, {
      extra: createElement('div', null, createElement(TransferCompletionHost), createElement(PasteProgressNotice)),
    });
    await userEvent.click(within(m.tree).getByText('Docs'));

    pressPaste();

    expect(m.transfer.api.paste).not.toHaveBeenCalled();
    expect(notices()).toHaveLength(0);
  });
});

describe('the Paste menu item names what will land (050 T026, FR-025a)', () => {
  it('reads `Paste "a.txt" from <project>` for an item taken from another project, enabled', async () => {
    const m = await mountExplorer(standardHost, {
      clipboard: {
        mode: 'copy',
        items: [{ absPath: 'D:/projects/other/a.txt', projectId: 'project-b', projectRoot: 'D:/projects/other' }],
      },
      projectNameOf: (id) => (id === 'project-b' ? 'Other' : undefined),
    });
    await waitFor(() => expect(m.clipboard.api.get).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.pointer({ keys: '[MouseRight]', target: within(m.tree).getByText('Docs') });
    const menuItem = await screen.findByTestId('menu-item-Paste "a.txt" from Other');
    expect(menuItem).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('what the renderer does when the job ends (050 T027)', () => {
  it('leaves a COPY on the clipboard after the run — it clears and re-sets nothing (FR-006)', async () => {
    const m = await mountWithCopy();
    await userEvent.click(within(m.tree).getByText('Docs'));
    pressPaste();
    await waitFor(() => expect(m.transfer.api.paste).toHaveBeenCalled());

    m.transfer.done({ jobId: 'job-1', placed: ['C:/projects/demo/Docs/a.txt'] });

    expect(m.clipboard.api.clear, 'a finished paste cleared the clipboard').not.toHaveBeenCalled();
    expect(m.clipboard.api.set).not.toHaveBeenCalled();
    expect(m.clipboard.value).toEqual({ mode: 'copy', items: [item('C:/projects/demo/a.txt')] });
  });

  it('raises NO notice for a run without failures', async () => {
    const m = await mountWithCopy();
    await userEvent.click(within(m.tree).getByText('Docs'));
    pressPaste();
    await waitFor(() => expect(m.transfer.api.paste).toHaveBeenCalled());

    m.transfer.done({ jobId: 'job-1', placed: ['C:/projects/demo/Docs/a.txt'] });

    expect(notices()).toHaveLength(0);
  });

  it('raises ONE error notice naming every failed item and its reason (FR-013)', async () => {
    const m = await mountWithCopy();
    await userEvent.click(within(m.tree).getByText('Docs'));
    pressPaste();
    await waitFor(() => expect(m.transfer.api.paste).toHaveBeenCalled());

    m.transfer.done({
      jobId: 'job-1',
      failures: [
        { name: 'locked.db', message: 'It is open in another program.' },
        { name: 'gone.txt', dir: 'old', message: 'It could not be found.' },
        { name: 'secret.key', message: 'You do not have permission to change it.' },
      ],
    });

    const cards = notices();
    expect(cards, 'a failed run must raise exactly one notice').toHaveLength(1);
    const card = cards[0]!;
    expect(card.className).toContain('notice--error');
    const text = card.textContent ?? '';
    for (const name of ['locked.db', 'gone.txt', 'secret.key']) expect(text).toContain(name);
    expect(text).toContain('open in another program');
    expect(text).toContain('could not be found');
    expect(text).toContain('permission');
    // The ambiguous name is qualified by its folder, through the one subject formatter.
    expect(text).toContain('old — gone.txt');
  });
});
