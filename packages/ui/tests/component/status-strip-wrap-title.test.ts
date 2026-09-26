/**
 * The status strip's word-wrap toggle names the LIVE chord in its hover title (046 FR-091;
 * constitution Principle X — keybindings are externalised and rebindable).
 *
 * It used to be the literal `Toggle word wrap (Ctrl+Alt+W)`: wrong the moment the shipped default
 * moved to the two-stroke `Ctrl+E W`, and wrong for anyone who had rebound it. The title is now built
 * from `firstBinding`, the form every other chord-bearing title uses (`Back (Alt+ArrowLeft)`), and a
 * command with no binding shows no chord at all.
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

const PANEL = 'p-wrap-title';
let seq = 0;
let h: EditorHarness | undefined;

async function mount(keybindings?: Record<string, string[]>): Promise<HTMLElement> {
  h = mountEditor({
    panelId: PANEL,
    doc: { text: 'x\n', version: 1, absPath: `C:/proj/wrap-title-${++seq}.ts` },
    ...(keybindings ? { keybindings } : {}),
  });
  const harness = h;
  await waitFor(() => expect(harness.settingsLoaded()).toBe(true));
  return screen.findByTestId(`editor-word-wrap-${PANEL}`);
}

afterEach(() => {
  h?.unmount();
  h = undefined;
});

describe('word-wrap toggle title follows the live binding (FR-091, Principle X)', () => {
  it('shows the shipped two-stroke chord as `Ctrl+E,W`', async () => {
    // 046 FR-124 — re-pinned from `Ctrl+E W`: the display form is the comma form.
    const toggle = await mount();
    await waitFor(() => expect(toggle).toHaveAttribute('title', 'Toggle word wrap (Ctrl+E,W)'));
  });

  it('shows a rebound chord instead', async () => {
    const toggle = await mount({ 'editor.toggleWordWrap': ['Ctrl+Shift+Alt+W'] });
    await waitFor(() => expect(toggle).toHaveAttribute('title', 'Toggle word wrap (Ctrl+Shift+Alt+W)'));
  });

  it('names no chord when the command is unbound', async () => {
    const toggle = await mount({ 'editor.toggleWordWrap': [] });
    await waitFor(() => expect(toggle).toHaveAttribute('title', 'Toggle word wrap'));
  });
});
