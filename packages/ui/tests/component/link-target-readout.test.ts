import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { StatusStrip } from '../../src/renderer/editor/status-strip.js';
import { setEditorHoveredLink } from '../../src/renderer/editor/editor-hovered-link-store.js';
import { TerminalStatusBar } from '../../src/renderer/terminal/terminal-status-bar.js';
import { setTerminalLinkReadout } from '../../src/renderer/terminal/terminal-link-readout-store.js';
import { setPanelCaret, __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import type { EditorLinkAt } from '../../src/renderer/editor/link-decorations.js';

/**
 * 045 FR-167, FR-167a (round four) — the terminal's and the editor's status bars show the hovered
 * link's full target, bottom-left after any persistent content, and clear it on leave.
 *
 * `preview-link-readout.test.ts` and `preview-status-bar.test.ts` stay green unchanged (the shared
 * `LinkTargetReadout` extraction preserved that surface's output byte for byte).
 */

const PANEL = 'readout-panel';

afterEach(() => {
  setEditorHoveredLink(PANEL, null);
  setTerminalLinkReadout(PANEL, null);
  __resetCaretStore();
});

describe('the terminal status bar (FR-167)', () => {
  it('shows the hovered link’s target, bottom-left after the flavour label', () => {
    setTerminalLinkReadout(PANEL, 'D:\\proj\\src\\foo.ts');
    render(createElement(TerminalStatusBar, { panelId: PANEL, flavourLabel: 'PowerShell' }));

    const bar = screen.getByTestId(`terminal-status-bar-${PANEL}`);
    const flavour = screen.getByText('PowerShell');
    const readout = screen.getByTestId(`terminal-status-link-readout-${PANEL}`);
    expect(readout).toHaveTextContent('D:\\proj\\src\\foo.ts');
    // "after" — later in the bar's own children than the persistent flavour label.
    const children = [...bar.children];
    expect(children.indexOf(readout)).toBeGreaterThan(children.indexOf(flavour));
  });

  it('renders nothing while nothing is hovered', () => {
    render(createElement(TerminalStatusBar, { panelId: PANEL, flavourLabel: 'PowerShell' }));
    expect(screen.queryByTestId(`terminal-status-link-readout-${PANEL}`)).toBeNull();
  });

  it('clears when the pointer leaves', () => {
    setTerminalLinkReadout(PANEL, 'D:\\proj\\src\\foo.ts');
    const { rerender } = render(createElement(TerminalStatusBar, { panelId: PANEL, flavourLabel: 'PowerShell' }));
    expect(screen.getByTestId(`terminal-status-link-readout-${PANEL}`)).not.toBeNull();

    setTerminalLinkReadout(PANEL, null);
    rerender(createElement(TerminalStatusBar, { panelId: PANEL, flavourLabel: 'PowerShell' }));
    expect(screen.queryByTestId(`terminal-status-link-readout-${PANEL}`)).toBeNull();
  });
});

describe('the editor status strip (FR-167)', () => {
  const webHit: EditorLinkAt = { kind: 'web', uri: 'https://example.com/a', from: 0, to: 5 };
  const fileHit: EditorLinkAt = {
    kind: 'file',
    request: { text: 'src\\foo.ts', kind: 'detectedPath', panelId: PANEL },
    from: 0,
    to: 10,
  };

  it('shows the hovered file link’s target, resolved against the editor’s project root when it has no file yet', () => {
    setEditorHoveredLink(PANEL, fileHit);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null, projectRoot: 'D:\\proj' }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).toHaveTextContent('D:\\proj\\src\\foo.ts');
  });

  it('shows a hovered web link’s own address, verbatim', () => {
    setEditorHoveredLink(PANEL, webHit);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).toHaveTextContent('https://example.com/a');
  });

  it('the text as written when there is no base at all', () => {
    setEditorHoveredLink(PANEL, fileHit);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).toHaveTextContent('src\\foo.ts');
  });

  it('renders nothing while nothing is hovered', () => {
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.queryByTestId(`editor-status-link-readout-${PANEL}`)).toBeNull();
  });

  it('clears when the pointer leaves', () => {
    setEditorHoveredLink(PANEL, webHit);
    const { rerender } = render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).not.toBeNull();

    setEditorHoveredLink(PANEL, null);
    rerender(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.queryByTestId(`editor-status-link-readout-${PANEL}`)).toBeNull();
  });

  it('clips like the other two surfaces — the same class, so the same rules', () => {
    setEditorHoveredLink(PANEL, webHit);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).toHaveClass('link-target-readout');
  });

  it('is drawn after the persistent Ln/Col readouts, in the same leading group', () => {
    setPanelCaret(PANEL, { line: 3, column: 5 }, null);
    setEditorHoveredLink(PANEL, webHit);
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }));
    const group = screen.getByTestId(`editor-status-readouts-${PANEL}`);
    const line = screen.getByTestId(`editor-status-line-${PANEL}`);
    const readout = screen.getByTestId(`editor-status-link-readout-${PANEL}`);
    const children = [...group.children];
    expect(children.indexOf(readout)).toBeGreaterThan(children.indexOf(line));
  });

  /*
   * Review round four, editor L1 — the readout was re-rooted against whatever the panel holds NOW,
   * not against the document the hit came from. A Ctrl+click that loads a different file into the
   * same panel (023 FR-025's "Active Editor") leaves the pointer where it was, so the hit survives —
   * and was then joined onto the NEW file's folder, naming a path that has never existed.
   *
   * The hit already carries the document it was read from, as `request.baseDirectory`
   * (`editorLinkRequest`). Reading it from there is what makes a stale hit merely stale rather than
   * wrong, and it is the same value the terminal's readout uses (`hoveredLinkReadoutText`).
   */
  it('resolves a file link against the hit’s OWN base directory, not the panel’s current file', () => {
    setEditorHoveredLink(PANEL, {
      kind: 'file',
      request: { text: 'src\\foo.ts', kind: 'detectedPath', panelId: PANEL, baseDirectory: 'D:\\proj\\docs' },
      from: 0,
      to: 10,
    });
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null, projectRoot: 'D:\\proj' }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).toHaveTextContent('D:\\proj\\docs\\src\\foo.ts');
  });

  /* Review round four, terminal I1 — the editor's readout goes through the same by-name reading. */
  it('shows a Git Bash drive form as the drive it names (FR-176)', () => {
    setEditorHoveredLink(PANEL, {
      kind: 'file',
      request: { text: '/d/git/x.ts', kind: 'detectedPath', panelId: PANEL, baseDirectory: 'D:\\proj\\docs' },
      from: 0,
      to: 11,
    });
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null, projectRoot: 'D:\\proj' }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).toHaveTextContent('D:\\git\\x.ts');
  });

  /*
   * Round five (reported 2026-09-20) — SUPERSEDES this case's project-root expectation. A rooted
   * path that is not a drive form shows AS WRITTEN, because the project root is only the first
   * reading TRIED: `/tmp` fell through to the mount table and opened the temp folder while the bar
   * named the project's own. The bar now names nothing rather than the wrong thing.
   */
  it('shows a rooted non-drive path as written (round five)', () => {
    setEditorHoveredLink(PANEL, {
      kind: 'file',
      request: { text: '/tmp', kind: 'detectedPath', panelId: PANEL, baseDirectory: 'D:\\proj\\docs' },
      from: 0,
      to: 4,
    });
    render(createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null, projectRoot: 'D:\\proj' }));
    expect(screen.getByTestId(`editor-status-link-readout-${PANEL}`)).toHaveTextContent('/tmp');
  });
});

/*
 * 045 T280 — THE READOUT MUST NOT CHANGE THE BAR'S HEIGHT (FR-167).
 *
 * Measured in `terminal-link-once.e2e.ts`'s mouse-owning case: hovering a link whose target is longer
 * than the bar took the terminal's status bar from 18px to 36px, which resized the terminal (38 rows
 * to 36), which made xterm drop its current link and fire `leave`, which cleared the readout and gave
 * the rows back — a loop, on every hover, so that link could never be hovered at all. It was not the
 * readout that wrapped: `Windows PowerShell` did, being a flex item that may shrink to its longest
 * word.
 *
 * jsdom has no layout, so the layout claim stays in that E2E. What these pin is the CASCADE the fix
 * rests on: the label cannot wrap or shrink, and the readout carries its own clipping rather than
 * borrowing the Markdown preview's stylesheet, which is what made the same element behave differently
 * on different surfaces.
 */
const CSS_FILES = {
  terminal: 'packages/ui/src/renderer/terminal/terminal.css',
  readout: 'packages/ui/src/renderer/common/link-target-readout.css',
} as const;

describe('T280 — the status bar is one line high whatever the readout says (FR-167)', () => {
  let sheets: HTMLStyleElement[] = [];

  beforeAll(() => {
    for (const [name, rel] of Object.entries(CSS_FILES)) {
      const path = resolve(process.cwd(), rel);
      expect(existsSync(path), `${name} stylesheet not found at ${path}`).toBe(true);
      const sheet = document.createElement('style');
      sheet.textContent = readFileSync(path, 'utf8');
      document.head.appendChild(sheet);
      sheets.push(sheet);
    }
  });

  afterAll(() => {
    for (const sheet of sheets) sheet.remove();
    sheets = [];
  });

  const mount = (): void => {
    setTerminalLinkReadout(PANEL, 'file:///C:/a/very/long/target/that/is/wider/than/the/bar/linkdir');
    render(createElement(TerminalStatusBar, { panelId: PANEL, flavourLabel: 'Windows PowerShell' }));
  };

  it('the flavour label neither wraps nor shrinks', () => {
    mount();
    const label = screen.getByText('Windows PowerShell');
    const style = window.getComputedStyle(label);
    expect(style.whiteSpace, 'the label wrapped, which is what grew the bar').toBe('nowrap');
    expect(style.flexShrink, 'a shrinking label breaks onto a second line').toBe('0');
  });

  it('the readout clips itself, on every surface, without the preview stylesheet', () => {
    mount();
    const style = window.getComputedStyle(screen.getByTestId(`terminal-status-link-readout-${PANEL}`));
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
    expect(style.minWidth, 'a flex item that cannot shrink pushes the bar wider').toBe('0px');
  });

  // ANTI-VACUITY: the injected stylesheets parsed and cascade here at all.
  it('cascades a rule terminal.css declares today', () => {
    mount();
    expect(window.getComputedStyle(screen.getByTestId(`terminal-status-bar-${PANEL}`)).display).toBe('flex');
  });
});
