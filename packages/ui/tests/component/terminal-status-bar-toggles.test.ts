/**
 * 076 US1 / US3 — the terminal status bar's toggle row (FR-001, FR-002, FR-007; contracts/status-bar-and-menu.md).
 *
 * Layer: component — what the bar renders, its pressed states, names, keyboard behaviour and the CSS that keeps
 * the row whole are all visible to jsdom; nothing here needs a real window.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_PANEL_TOGGLES } from '@throng/core';
import { TerminalStatusBar, type TerminalStatusToggle } from '../../src/renderer/terminal/terminal-status-bar.js';

const PANEL = 'p-tsb';

function toggles(on: Partial<Record<string, boolean>> = {}, chords: Partial<Record<string, string>> = {}) {
  const flips = new Map<string, ReturnType<typeof vi.fn>>();
  const list: TerminalStatusToggle[] = TERMINAL_PANEL_TOGGLES.map((t) => {
    const onToggle = vi.fn();
    flips.set(t.id, onToggle);
    return { id: t.id, label: t.label, icon: t.icon, on: on[t.id] ?? false, chord: chords[t.id], onToggle };
  });
  return { list, flips };
}

function mount(list: TerminalStatusToggle[]) {
  return render(createElement(TerminalStatusBar, { panelId: PANEL, flavourLabel: 'Git Bash', toggles: list }));
}

const button = (id: string): HTMLButtonElement => screen.getByTestId(`terminal-toggle-${id}-${PANEL}`) as HTMLButtonElement;

afterEach(() => document.body.replaceChildren());

describe('the terminal status bar toggle row (076)', () => {
  it('sits at the right, after the flavour label and the link readout, in FR-001’s order', () => {
    const { list } = toggles();
    mount(list);
    const bar = screen.getByTestId(`terminal-status-bar-${PANEL}`);
    const group = bar.querySelector('.terminal-status-bar__toggles') as HTMLElement;
    expect(group).not.toBeNull();
    expect(bar.lastElementChild).toBe(group);
    expect([...group.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'))).toEqual([
      `terminal-toggle-rememberCommand-${PANEL}`,
      `terminal-toggle-rememberDirectory-${PANEL}`,
      `terminal-toggle-notifications-${PANEL}`,
    ]);
  });

  it('shows each toggle’s state as pressed, and names the setting and its state (FR-002)', () => {
    const { list } = toggles({ rememberCommand: true }, { notifications: 'Ctrl+Alt+I' });
    mount(list);
    expect(button('rememberCommand').getAttribute('aria-pressed')).toBe('true');
    expect(button('rememberDirectory').getAttribute('aria-pressed')).toBe('false');
    expect(button('rememberCommand').getAttribute('title')).toBe('Remember the last running command: enabled');
    expect(button('rememberCommand').getAttribute('aria-label')).toBe('Remember the last running command: enabled');
    expect(button('rememberDirectory').getAttribute('title')).toBe('Reopen in the last directory: disabled');
    expect(button('notifications').getAttribute('title')).toBe('Terminal notifications: disabled (Ctrl+Alt+I)');
  });

  it('draws each toggle from the icon set, as an icon control with no text of its own (FR-002, SC-006)', () => {
    const { list } = toggles();
    mount(list);
    for (const t of TERMINAL_PANEL_TOGGLES) {
      const b = button(t.id);
      expect(b.querySelector('svg, img, [data-icon]'), t.id).not.toBeNull();
      expect(b.textContent?.trim(), t.id).toBe('');
      expect(b.getAttribute('style') ?? '', t.id).not.toMatch(/color/i);
    }
  });

  it('flips on a click, and on Space and Enter, and Tab reaches each toggle in order (FR-002)', async () => {
    const user = userEvent.setup({ delay: null });
    const { list, flips } = toggles();
    mount(list);
    await user.click(button('rememberCommand'));
    expect(flips.get('rememberCommand')).toHaveBeenCalledTimes(1);

    button('rememberCommand').focus();
    await user.tab();
    expect(document.activeElement).toBe(button('rememberDirectory'));
    await user.keyboard(' ');
    expect(flips.get('rememberDirectory')).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(document.activeElement).toBe(button('notifications'));
    await user.keyboard('{Enter}');
    expect(flips.get('notifications')).toHaveBeenCalledTimes(1);
  });

  it('draws an on toggle bright, and an off one greyed out with a line through it (FR-002)', () => {
    // 073 FR-007a — the look is the shared `setting-toggle` class, drawn once for every setting toggle; the terminal's
    // buttons carry it beside their own layout class.
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/common/setting-toggle.css'), 'utf8');
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(rule(".setting-toggle[aria-pressed='true'] .icon")).toMatch(/color:\s*var\(--throng-colour-text\)/);
    expect(rule(".setting-toggle[aria-pressed='false'] .icon")).toMatch(/color:\s*var\(--throng-colour-textMuted\)/);
    const slash = rule(".setting-toggle[aria-pressed='false']::after");
    expect(slash).toMatch(/content:\s*''/);
    expect(slash).toMatch(/background:\s*var\(--throng-colour-textMuted\)/);
    expect(slash).toMatch(/rotate\(45deg\)/);
    expect(rule('.setting-toggle')).toMatch(/position:\s*relative/);
  });

  it('draws every toggle with the shared setting-toggle class, beside its own layout class (073 FR-007a)', () => {
    mount(toggles().list);
    for (const id of ['rememberCommand', 'rememberDirectory', 'notifications']) {
      expect(button(id)).toHaveClass('setting-toggle', 'terminal-status-bar__toggle');
    }
  });

  it('keeps the row whole under width pressure: the toggles never shrink, the readout truncates first (FR-007)', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/terminal/terminal.css'), 'utf8');
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(rule('.terminal-status-bar__toggles')).toMatch(/flex:\s*0 0 auto/);
    expect(rule('.terminal-status-bar__toggles')).toMatch(/margin-left:\s*auto/);
    // The flavour label may shrink, but only after the readout: a lower shrink factor, and it ellipsises.
    expect(rule('.terminal-status-bar__flavour')).toMatch(/flex:\s*0 1 auto/);
    expect(rule('.terminal-status-bar__flavour')).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule('.terminal-status-bar .link-target-readout')).toMatch(/flex:\s*0 1000 auto/);
  });
});
