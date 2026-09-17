/**
 * 044 T071 — the editor status bar's preview button (FR-001, FR-014, FR-062, SC-001;
 * contracts/menus-and-controls.md §7).
 *
 * ══ WHAT THE FOUR STATES ARE, AND WHO DECIDES THEM ══
 *
 * Core's `previewAffordance` decides; the strip draws. Absent when showing a preview is meaningless
 * (no provider, no file on disk, outside the project); drawn DISABLED while the provider is switched
 * off, because one setting would make it work and the tooltip names that setting (Principle VI's
 * disabled-versus-absent rule, FR-062); ENABLED as *Open Preview*; and PRESSED as *Go to Preview*
 * while `preview-open-store` holds the file — in ANY window, and whatever spelling the path arrives
 * in (FR-014). A pressed button still acts: it asks for the preview again, main answers `focused`, and
 * nothing is ever closed from here.
 *
 * ══ WHY THE CLICK IS OBSERVED AT THE OPENER ══
 *
 * FR-005 makes opening a preview ONE command. Every entry point — this button, the two menus, the
 * chord, Files & Folders — goes through the window's registered opener (`requestPreviewOpen`), and
 * that opener is what calls `window.throng.preview.open` (open-preview.test.ts owns that half). So
 * the assertion here is that the button reaches the one command with the right request.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveIconAsset, THRONG_THEME, normaliseForCompare } from '@throng/core';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import {
  __resetPreviewOpenStore,
  applyPreviewOpenChanged,
  listenForPreviewOpenChanged,
} from '../../src/renderer/preview/preview-open-store.js';
import { registerPreviewOpener, type PreviewOpenIntent } from '../../src/renderer/preview/open-preview.js';

const PANEL = 'p-ed';
const PROJECT = 'proj-1';
const ROOT = 'D:/proj';
const FILE = `${ROOT}/README.md`;

const button = (): HTMLElement | null => screen.queryByTestId(`editor-preview-${PANEL}`);

let opened: PreviewOpenIntent[];
let destroyed: ReturnType<typeof vi.fn>;

/** Every key-scoped write the strip sent through `config.writePatch`, and what the bridge answers. */
let patches: { id: unknown; changes: unknown }[];
let patchResult: { ok: true } | { ok: false; error: string };

/** Mount the strip for an editor showing `filePath`, with `settings` delivered as `config.get` would. */
async function strip(opts: {
  filePath: string | null;
  projectRoot?: string | null;
  settings?: Record<string, unknown>;
  keybindings?: Record<string, string[]>;
}): Promise<void> {
  setEditorState(PANEL, { filePath: opts.filePath, ownerProjectId: PROJECT });
  let loaded = false;
  Reflect.set(window, 'throng', {
    config: {
      get: () => {
        loaded = true;
        return Promise.resolve({
          settings: opts.settings,
          ...(opts.keybindings ? { keybindings: { bindings: opts.keybindings } } : {}),
        });
      },
      onChange: () => () => {},
      writePatch: (id: unknown, changes: unknown) => {
        patches.push({ id, changes });
        return Promise.resolve(patchResult);
      },
    },
    preview: { destroyed },
  });
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(StatusStrip, {
        panelId: PANEL,
        projectId: PROJECT,
        relPath: null,
        projectRoot: opts.projectRoot === undefined ? ROOT : opts.projectRoot,
      }),
    ),
  );
  await waitFor(() => expect(loaded).toBe(true));
  // One more turn, so the payload `config.get` resolved has been applied to the tree.
  await act(() => Promise.resolve());
}

const MARKDOWN_OFF = { editor: { previews: { providers: { markdown: { enabled: false } } } } };

beforeEach(() => {
  opened = [];
  patches = [];
  patchResult = { ok: true };
  destroyed = vi.fn();
  __resetPreviewOpenStore();
  registerPreviewOpener((intent) => {
    opened.push(intent);
    return Promise.resolve({ kind: 'placed', panelId: 'panel-x' });
  });
});

afterEach(() => {
  registerPreviewOpener(null);
  removeEditorState(PANEL);
  Reflect.deleteProperty(window, 'throng');
});

describe('absent where a preview means nothing (FR-001, FR-004)', () => {
  it('is not rendered for a file no provider claims', async () => {
    await strip({ filePath: `${ROOT}/notes.txt` });
    expect(screen.getByTestId(`editor-word-wrap-${PANEL}`)).toBeInTheDocument(); // the bar IS there
    expect(button()).toBeNull();
  });

  it('is not rendered for an editor with no file on disk', async () => {
    await strip({ filePath: null });
    expect(screen.getByTestId(`editor-word-wrap-${PANEL}`)).toBeInTheDocument();
    expect(button()).toBeNull();
  });

  it('is not rendered for a file outside the project', async () => {
    await strip({ filePath: 'E:/elsewhere/README.md' });
    expect(screen.getByTestId(`editor-word-wrap-${PANEL}`)).toBeInTheDocument();
    expect(button()).toBeNull();
  });

  it('is not rendered for an editor with no project root (a sub-workspace-owned editor)', async () => {
    await strip({ filePath: FILE, projectRoot: null });
    expect(screen.getByTestId(`editor-word-wrap-${PANEL}`)).toBeInTheDocument();
    expect(button()).toBeNull();
  });
});

describe('drawn DISABLED while the provider is turned off (FR-001, FR-062)', () => {
  it('is present, disabled, and its title names the setting that turns it back on', async () => {
    await strip({ filePath: FILE, settings: MARKDOWN_OFF });
    await waitFor(() => expect(button()).toBeDisabled());
    expect(button()).toHaveAttribute(
      'title',
      'Markdown previews are turned off — Preferences → Editor → Previews',
    );
    expect(button()).toHaveAccessibleName(/Preferences → Editor → Previews/);
  });

  it('opens nothing when clicked', async () => {
    await strip({ filePath: FILE, settings: MARKDOWN_OFF });
    await waitFor(() => expect(button()).toBeDisabled());
    await userEvent.click(button() as HTMLElement);
    expect(opened).toEqual([]);
  });
});

describe('enabled: Open Preview (FR-001, SC-001)', () => {
  it('is an unpressed icon button named Open Preview', async () => {
    await strip({ filePath: FILE });
    const b = button() as HTMLElement;
    expect(b).toBeEnabled();
    expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(b).toHaveAttribute('title', 'Open Preview');
    expect(b).toHaveAccessibleName('Open Preview');
  });

  it('goes through the one preview.open command with this editor’s file, project and panel (FR-005)', async () => {
    await strip({ filePath: FILE });
    await userEvent.click(button() as HTMLElement);
    expect(opened).toEqual([{ absPath: FILE, projectId: PROJECT, requesterPanelId: PANEL }]);
  });
});

describe('pressed: Go to Preview while the file has a preview in any window (FR-014)', () => {
  it('draws pressed as soon as main announces the preview, in compare form', async () => {
    await strip({ filePath: FILE });
    expect(button()).toHaveAttribute('aria-pressed', 'false');

    act(() => applyPreviewOpenChanged({ path: normaliseForCompare(FILE), open: true }));

    expect(button()).toHaveAttribute('aria-pressed', 'true');
    expect(button()).toHaveAttribute('title', 'Go to Preview');
    expect(button()).toHaveAccessibleName('Go to Preview');
    // Pressed is a state of an ENABLED control: choosing it still does something.
    expect(button()).toBeEnabled();
  });

  it('matches a path spelled with backslashes and another case (Windows)', async () => {
    await strip({ filePath: 'D:\\Proj\\ReadMe.md', projectRoot: 'D:\\Proj' });
    act(() => applyPreviewOpenChanged({ path: normaliseForCompare(FILE), open: true }));
    expect(button()).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks for the preview again when clicked — main focuses it — and never closes it', async () => {
    await strip({ filePath: FILE });
    act(() => applyPreviewOpenChanged({ path: normaliseForCompare(FILE), open: true }));

    await userEvent.click(button() as HTMLElement);

    expect(opened).toEqual([{ absPath: FILE, projectId: PROJECT, requesterPanelId: PANEL }]);
    expect(destroyed).not.toHaveBeenCalled();
    expect(button()).toHaveAttribute('aria-pressed', 'true');
  });

  it('unpresses when main announces the preview closed', async () => {
    await strip({ filePath: FILE });
    act(() => applyPreviewOpenChanged({ path: normaliseForCompare(FILE), open: true }));
    act(() => applyPreviewOpenChanged({ path: normaliseForCompare(FILE), open: false }));
    expect(button()).toHaveAttribute('aria-pressed', 'false');
    expect(button()).toHaveAttribute('title', 'Open Preview');
  });
});

/*
 * Fix round 1, item 1 — a window created AFTER the preview opened (a sub-workspace window, a reload) has
 * heard no `openChanged` for it. It seeds from main's `openPaths` once it has subscribed, and a broadcast
 * that lands before the seed's reply is applied AFTER it, so an `open: false` in flight wins
 * (contracts/preview-ipc.md §1 `openPaths`).
 */
describe('seeded from main when the window starts listening (FR-012, FR-014)', () => {
  function seedingBridge() {
    let broadcast: ((evt: { path: string; open: boolean }) => void) | null = null;
    let reply!: (paths: string[]) => void;
    const bridge = {
      onOpenChanged: (cb: (evt: { path: string; open: boolean }) => void) => {
        broadcast = cb;
        return () => {
          broadcast = null;
        };
      },
      openPaths: vi.fn(() => new Promise<string[]>((resolve) => (reply = resolve))),
    };
    return {
      bridge,
      send: (evt: { path: string; open: boolean }) => act(() => broadcast?.(evt)),
      reply: async (paths: string[]) => {
        await act(async () => {
          reply(paths);
          await Promise.resolve();
        });
      },
    };
  }

  it('draws pressed from the seed alone — no broadcast ever arrives for the file', async () => {
    await strip({ filePath: FILE });
    const main = seedingBridge();
    const stop = listenForPreviewOpenChanged(main.bridge);
    await main.reply([normaliseForCompare(FILE)]);
    await waitFor(() => expect(button()).toHaveAttribute('aria-pressed', 'true'));
    expect(main.bridge.openPaths).toHaveBeenCalledTimes(1);
    stop();
  });

  it('an open:false broadcast that lands before the seed replies wins over the seed', async () => {
    await strip({ filePath: FILE });
    const main = seedingBridge();
    const stop = listenForPreviewOpenChanged(main.bridge);

    // Main computed the reply while the preview was open, then the preview closed.
    main.send({ path: normaliseForCompare(FILE), open: false });
    await main.reply([normaliseForCompare(FILE)]);

    await act(() => Promise.resolve());
    expect(button()).toHaveAttribute('aria-pressed', 'false');

    // And the listener is live afterwards: later broadcasts apply directly.
    main.send({ path: normaliseForCompare(FILE), open: true });
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    stop();
  });

  it('applies nothing from a seed that replies after the listener was stopped', async () => {
    await strip({ filePath: FILE });
    const main = seedingBridge();
    const stop = listenForPreviewOpenChanged(main.bridge);
    stop();
    await main.reply([normaliseForCompare(FILE)]);
    await act(() => Promise.resolve());
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('where it lives and what it is drawn with (FR-001, 040 FR-023/FR-024)', () => {
  it('sits inside the MEASURED controls group, after the wrap toggle, so width never hides it', async () => {
    await strip({ filePath: FILE });
    const controls = screen.getByTestId(`editor-status-controls-${PANEL}`);
    expect(controls).toHaveAttribute('data-measure', 'controls');
    const inGroup = within(controls).getByTestId(`editor-preview-${PANEL}`);
    const wrap = within(controls).getByTestId(`editor-word-wrap-${PANEL}`);
    // 044 FR-122c — the scroll-sync toggle now sits between the two, immediately before this button.
    const syncButton = within(controls).getByTestId(`editor-sync-scroll-${PANEL}`);
    expect(wrap.nextElementSibling).toBe(syncButton);
    expect(syncButton.nextElementSibling).toBe(inGroup);
  });

  it('draws the theme’s `preview` icon token, and no text label', async () => {
    await strip({ filePath: FILE });
    const asset = resolveIconAsset(THRONG_THEME, {}, 'preview');
    expect(asset.kind).toBe('glyph');
    const icon = (button() as HTMLElement).querySelector('.icon');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.textContent).toBe(asset.kind === 'glyph' ? asset.glyph : '');
    expect((button() as HTMLElement).textContent).toBe(icon?.textContent);
  });
});

/*
 * 044 T235 — the scroll-sync toggle beside it (FR-122, FR-122a, FR-122c, FR-122e;
 * contracts/menus-and-controls.md §7, §10). An accelerator over the menu items: it flips the one global
 * setting through the one command body, shows the setting as `aria-pressed`, and holds no state of its own.
 */
describe('the scroll-sync toggle (FR-122c)', () => {
  const toggle = (): HTMLElement | null => screen.queryByTestId(`editor-sync-scroll-${PANEL}`);
  const SYNC_OFF = { editor: { previews: { syncScroll: false } } };

  it('is an icon button with the syncScroll token, immediately before the preview button in the measured group', async () => {
    await strip({ filePath: FILE });
    const controls = screen.getByTestId(`editor-status-controls-${PANEL}`);
    const t = within(controls).getByTestId(`editor-sync-scroll-${PANEL}`);
    expect(t.nextElementSibling).toBe(button());
    const asset = resolveIconAsset(THRONG_THEME, {}, 'syncScroll');
    expect(asset.kind).toBe('glyph');
    const icon = t.querySelector('.icon');
    expect(icon?.textContent).toBe(asset.kind === 'glyph' ? asset.glyph : '');
    expect(t.textContent).toBe(icon?.textContent);
  });

  it('is pressed while the setting is on, and not while it is off', async () => {
    await strip({ filePath: FILE });
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    cleanupStrip();
    await strip({ filePath: FILE, settings: SYNC_OFF });
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'false'));
  });

  it('is titled Synchronise Scrolling, with the chord only when one is bound', async () => {
    await strip({ filePath: FILE });
    expect(toggle()).toHaveAttribute('title', 'Synchronise Scrolling');
    expect(toggle()).toHaveAccessibleName('Synchronise Scrolling');
    cleanupStrip();
    await strip({ filePath: FILE, keybindings: { 'preview.toggleSyncScroll': ['Ctrl+Alt+F8'] } });
    await waitFor(() => expect(toggle()).toHaveAttribute('title', 'Synchronise Scrolling (Ctrl+Alt+F8)'));
  });

  it('is absent wherever the preview button is (FR-122a)', async () => {
    await strip({ filePath: `${ROOT}/notes.txt` });
    expect(screen.getByTestId(`editor-word-wrap-${PANEL}`)).toBeInTheDocument();
    expect(toggle()).toBeNull();
    cleanupStrip();
    await strip({ filePath: FILE, projectRoot: null });
    expect(toggle()).toBeNull();
  });

  it('is ENABLED while the preview button is disabled for a switched-off provider (FR-122a)', async () => {
    await strip({ filePath: FILE, settings: MARKDOWN_OFF });
    await waitFor(() => expect(button()).toBeDisabled());
    expect(toggle()).toBeEnabled();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('is ENABLED while the preview button is pressed for an open preview', async () => {
    await strip({ filePath: FILE });
    act(() => applyPreviewOpenChanged({ path: normaliseForCompare(FILE), open: true }));
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toBeEnabled();
  });

  it('writes exactly the one key, once, when clicked — and follows the write', async () => {
    await strip({ filePath: FILE });
    await userEvent.click(toggle() as HTMLElement);
    expect(patches).toEqual([
      { id: { kind: 'settings' }, changes: [{ path: ['editor', 'previews', 'syncScroll'], value: false }] },
    ]);
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-pressed', 'false'));
    // Nothing else on the bar moved.
    expect(opened).toEqual([]);
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });

  it('stays pressed when the write fails — no optimistic state (FR-122e)', async () => {
    patchResult = { ok: false, error: 'settings.json is read-only' };
    await strip({ filePath: FILE });
    await userEvent.click(toggle() as HTMLElement);
    expect(patches).toHaveLength(1);
    await act(() => Promise.resolve());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toBeEnabled();
    expect(opened).toEqual([]);
  });
});

/** Unmount the strip between two mounts inside one test. */
function cleanupStrip(): void {
  cleanup();
  removeEditorState(PANEL);
  Reflect.deleteProperty(window, 'throng');
}
