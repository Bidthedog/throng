import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings, type ISystemNotifier } from '@throng/core';
import { NoticeOs } from '../../src/main/notice-os.js';

// 057 FR-109/FR-110 — main's half of an ordinary notice reaching the OS.
function rig() {
  const shown: Parameters<ISystemNotifier['show']>[0][] = [];
  const handlers: Array<(id: string) => void> = [];
  const raised: number[] = [];
  const state = { focused: null as number | null };
  const settings = structuredClone(DEFAULT_APP_SETTINGS) as AppSettings;
  settings.notifications.error.os = true;
  const notifier: ISystemNotifier = {
    show: (n) => shown.push(n),
    close: () => {},
    onClick: (h) => handlers.push(h),
  };
  const os = new NoticeOs({
    notifier,
    windows: { focusedId: () => state.focused, mainId: () => 1, raise: (id) => raised.push(id) },
    settings: () => settings,
  });
  return { os, shown, raised, state, settings, click: (id: string) => handlers.forEach((h) => h(id)) };
}

const failure = { severity: 'error', title: 'Could not save notes.md', body: 'Access is denied.' };

describe('NoticeOs (057 FR-110)', () => {
  it('shows a notice whose type has the OS on while no throng window is focused', () => {
    const r = rig();
    r.os.show(failure);
    expect(r.shown).toEqual([
      expect.objectContaining({ title: 'Could not save notes.md', body: 'Access is denied.', kind: 'failed' }),
    ]);
    expect(r.shown[0]!.id).toMatch(/^notice:/);
  });

  it('shows nothing while a throng window is focused', () => {
    const r = rig();
    r.state.focused = 3;
    r.os.show(failure);
    expect(r.shown).toEqual([]);
  });

  it("shows nothing for a type whose OS switch is off, or with the global switch off (FR-109)", () => {
    const r = rig();
    r.os.show({ ...failure, severity: 'info' });
    r.settings.notifications.os = false;
    r.os.show(failure);
    expect(r.shown).toEqual([]);
  });

  it('gives every notice its own notification', () => {
    const r = rig();
    r.os.show(failure);
    r.os.show(failure);
    expect(new Set(r.shown.map((n) => n.id)).size).toBe(2);
  });

  it('ignores a malformed payload', () => {
    const r = rig();
    for (const bad of [null, 5, { ...failure, severity: 'fatal' }, { ...failure, title: 7 }]) r.os.show(bad);
    expect(r.shown).toEqual([]);
  });

  it('a click brings the main window forward; a mark\'s click is not its business', () => {
    const r = rig();
    r.click('notice:1');
    r.click('p1');
    expect(r.raised).toEqual([1]);
  });
});
