/**
 * 057 — main's AttentionService (T020, T031, T040, T041, T046, T051, T054).
 *
 * Layer: unit — the service drives core's pure model through ports (windows, daemon, OS notifier, taskbar
 * badge) that are all faked here; nothing it decides needs Electron or a daemon to be observed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AttentionLedgerEntry,
  type AttentionSignal,
  type FocusReport,
  type ISystemNotifier,
  type ITaskbarBadge,
} from '@throng/core';
import {
  TERMINAL_ATTENTION_CONFIG_METHOD,
  TERMINAL_ATTENTION_LEDGER_METHOD,
  TERMINAL_ATTENTION_SYNC_METHOD,
} from '@throng/ipc-contract';
import {
  AttentionService,
  type AttentionDaemon,
  type AttentionSettingsSource,
  type AttentionWindows,
} from '../../src/main/attention-service.js';

type Sent = { windowId: number | 'all'; channel: string; payload: any };

interface Rig {
  service: AttentionService;
  sent: Sent[];
  toasts: () => Sent[];
  daemonCalls: Array<{ method: string; params: any }>;
  notifier: { shown: any[]; closed: string[]; click: (id: string) => void };
  badge: { calls: Array<{ op: 'set' | 'clear'; image?: string; description?: string }> };
  raised: number[];
  state: {
    focused: number | null;
    main: number | null;
    ids: number[];
    hosts: number[];
    badgeNulls: number;
    badgeRequests: number;
  };
  settings: AttentionSettingsSource;
  ledger: AttentionLedgerEntry[];
  setSettings: (mutate: (s: AttentionSettingsSource) => void) => void;
}

function settingsFromDefaults(): AttentionSettingsSource {
  const s = structuredClone(DEFAULT_APP_SETTINGS) as AppSettings;
  return { attention: s.attention, notifications: s.notifications, terminals: { attention: s.terminals.attention } };
}

function rig(ledger: AttentionLedgerEntry[] = []): Rig {
  const sent: Sent[] = [];
  const daemonCalls: Rig['daemonCalls'] = [];
  const shown: any[] = [];
  const closed: string[] = [];
  const clickHandlers: Array<(id: string) => void> = [];
  const badgeCalls: Rig['badge']['calls'] = [];
  const raised: number[] = [];
  const state = {
    focused: null as number | null,
    main: 1 as number | null,
    ids: [1] as number[],
    hosts: [1] as number[],
    badgeNulls: 0,
    badgeRequests: 0,
  };
  let settings = settingsFromDefaults();

  const windows: AttentionWindows = {
    ids: () => state.ids,
    focusedId: () => state.focused,
    mainId: () => state.main,
    toastHostIds: () => state.hosts,
    send: (windowId, channel, payload) => sent.push({ windowId, channel, payload }),
    broadcast: (channel, payload) => sent.push({ windowId: 'all', channel, payload }),
    raise: (id) => raised.push(id),
    requestBadgeImage: async (_id, req) => {
      state.badgeRequests += 1;
      if (state.badgeNulls > 0) {
        state.badgeNulls -= 1;
        return null;
      }
      return `img:${req.kind}:${req.count}`;
    },
  };
  const daemon: AttentionDaemon = {
    call: async <T>(method: string, params: unknown) => {
      daemonCalls.push({ method, params });
      if (method === TERMINAL_ATTENTION_LEDGER_METHOD) return { entries: ledger } as T;
      return { ok: true } as T;
    },
  };
  const notifier: ISystemNotifier = {
    show: (n) => shown.push(n),
    close: (id) => closed.push(id),
    onClick: (h) => clickHandlers.push(h),
  };
  const badge: ITaskbarBadge = {
    set: (image, description) => badgeCalls.push({ op: 'set', image, description }),
    clear: () => badgeCalls.push({ op: 'clear' }),
  };
  const service = new AttentionService({ windows, daemon, notifier, badge, settings: () => settings });
  const r: Rig = {
    service,
    sent,
    toasts: () => sent.filter((s) => s.channel === 'throng:attention:toast'),
    daemonCalls,
    notifier: { shown, closed, click: (id) => clickHandlers.forEach((h) => h(id)) },
    badge: { calls: badgeCalls },
    raised,
    state,
    get settings() {
      return settings;
    },
    ledger,
    setSettings: (mutate) => {
      const prev = settings;
      settings = structuredClone(prev);
      mutate(settings);
      service.onSettingsChanged(prev, settings);
    },
  } as Rig;
  return r;
}

let seq = 0;
function signal(over: Partial<AttentionSignal> = {}): AttentionSignal {
  return {
    panelId: 'p1',
    projectId: 'proj-a',
    signal: 'bell',
    kind: 'attention',
    detail: null,
    startup: false,
    panelTitle: 'Build',
    projectName: 'Alpha',
    at: 1000 + seq++,
    ...over,
  };
}

function report(over: Partial<FocusReport> = {}): FocusReport {
  return {
    windowId: 1,
    windowFocused: true,
    focusedPanelId: null,
    hostedPanels: [],
    ...over,
  };
}

const changed = (r: Rig) => r.sent.filter((s) => s.channel === 'throng:attention:changed');
const lastMarks = (r: Rig) => changed(r).at(-1)?.payload.marks ?? [];
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  seq = 0;
});
afterEach(() => vi.useRealTimers());

describe('AttentionService — marks (T020)', () => {
  it('a signal for an unattended panel creates a mark and broadcasts it to every window', () => {
    const r = rig();
    r.service.onSignal(signal());
    const c = changed(r);
    expect(c).toHaveLength(1);
    expect(c[0]!.windowId).toBe('all');
    expect(c[0]!.payload.marks.map((m: any) => m.panelId)).toEqual(['p1']);
  });

  it('a focus report naming the panel focused in a focused window clears it after the clear delay (FR-095)', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onSignal(signal());
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    expect(lastMarks(r)).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(lastMarks(r)).toEqual([]);
  });

  it('a signal for the attended panel is ignored', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    r.service.onSignal(signal());
    expect(changed(r)).toHaveLength(0);
    expect(r.toasts()).toHaveLength(0);
    expect(r.notifier.shown).toHaveLength(0);
  });

  it('pushes the producer config to the daemon on connect and again on a terminals.attention change', async () => {
    const r = rig();
    await r.service.onDaemonConnected();
    const cfg = r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_CONFIG_METHOD);
    expect(cfg).toHaveLength(1);
    expect(cfg[0]!.params).toEqual({
      enabled: true,
      signals: {
        processExited: true,
        commandFinished: true,
        bell: true,
        notification: true,
        progressEnded: true,
        unseenOutput: false,
        outputQuiet: false,
      },
      quietMs: 10_000,
    });
    r.setSettings((s) => {
      s.terminals.attention.signals.bell = false;
    });
    await settle();
    const after = r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_CONFIG_METHOD);
    expect(after).toHaveLength(2);
    expect(after[1]!.params.signals.bell).toBe(false);
  });

  it('does not push the config for a change that is not under terminals.attention', async () => {
    const r = rig();
    await r.service.onDaemonConnected();
    r.setSettings((s) => {
      s.attention.taskbarBadge = false;
    });
    await settle();
    expect(r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_CONFIG_METHOD)).toHaveLength(1);
  });

  it("a FocusReport hosting a marked panel under another project moves the mark's project and title", () => {
    const r = rig();
    r.service.onSignal(signal());
    r.service.onFocusReport(
      report({ hostedPanels: [{ panelId: 'p1', projectId: 'proj-b', title: 'Renamed' }] }),
    );
    expect(lastMarks(r)[0]).toMatchObject({ projectId: 'proj-b', panelTitle: 'Renamed' });
  });

  it('a panel destroy or project delete clears its marks without notifying (FR-007)', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1', projectId: 'proj-a' }));
    r.service.onSignal(signal({ panelId: 'p2', projectId: 'proj-b' }));
    r.sent.length = 0;
    r.notifier.shown.length = 0;
    r.service.onPanelDestroyed('p1');
    r.service.onProjectDeleted('proj-b');
    expect(lastMarks(r)).toEqual([]);
    expect(r.notifier.shown).toHaveLength(0);
    expect(r.toasts().every((t) => t.payload.op === 'dismiss')).toBe(true);
  });

  it('reconcileProjects clears marks whose project no longer exists, keeping the rest', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1', projectId: 'proj-a' }));
    r.service.onSignal(signal({ panelId: 'p2', projectId: 'proj-b' }));
    r.service.reconcileProjects(new Set(['proj-a']));
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['p1']);
  });

  it('SC-003: a transcript of typing, bells, prompt redraws and short commands in the focused panel yields zero marks', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    const transcript: Array<Partial<AttentionSignal>> = [
      { signal: 'bell' },
      { signal: 'commandFinished', detail: 'ls' },
      { signal: 'bell' },
      { signal: 'commandFinished', detail: 'git status' },
      // Heuristics are off by default; a stray one must not raise either.
      { signal: 'unseenOutput' },
      { signal: 'outputQuiet' },
    ];
    for (const t of transcript) r.service.onSignal(signal(t));
    expect(changed(r)).toHaveLength(0);
    expect(r.toasts()).toHaveLength(0);
    expect(r.notifier.shown).toHaveLength(0);
  });
});

describe('AttentionService — restore and sync (T031)', () => {
  const entry: AttentionLedgerEntry = {
    panelId: 'p9',
    projectId: 'proj-a',
    kind: 'failed',
    reason: { signal: 'processExited', detail: '1' },
    raisedAt: 5,
    whileDetached: true,
    panelTitle: 'Server',
    projectName: 'Alpha',
  };

  it('on connect reads the ledger and restores marks without notifications (FR-038)', async () => {
    const r = rig([entry]);
    await r.service.onDaemonConnected();
    expect(r.daemonCalls.some((c) => c.method === TERMINAL_ATTENTION_LEDGER_METHOD)).toBe(true);
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['p9']);
    expect(r.toasts()).toHaveLength(0);
    expect(r.notifier.shown).toHaveLength(0);
  });

  it('a signal on a restored mark that still shows announces nothing (FR-134; #524)', async () => {
    const r = rig([{ ...entry, panelId: 'p1' }]);
    await r.service.onDaemonConnected();
    r.service.onSignal(signal({ signal: 'bell' }));
    expect(r.toasts()).toHaveLength(0);
    expect(r.notifier.shown).toHaveLength(0);
    expect(lastMarks(r).map((m: any) => m.reason.signal)).toEqual(['bell']);
  });

  it('flush() sends a pending sync at once instead of waiting out the debounce (FR-091 on quit)', async () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1' }));
    expect(r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_SYNC_METHOD)).toHaveLength(0);
    await r.service.flush();
    const syncs = r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_SYNC_METHOD);
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.params.entries.map((e: any) => e.panelId)).toEqual(['p1']);
    // The debounce timer was consumed: it does not send a second copy.
    await vi.advanceTimersByTimeAsync(500);
    expect(r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_SYNC_METHOD)).toHaveLength(1);
  });

  // A quit holds only while there is something to flush (main.ts will-quit).
  it('reports a pending sync until it is flushed', async () => {
    const r = rig();
    expect(r.service.hasPendingSync()).toBe(false);
    r.service.onSignal(signal({ panelId: 'p1' }));
    expect(r.service.hasPendingSync()).toBe(true);
    await r.service.flush();
    expect(r.service.hasPendingSync()).toBe(false);
  });

  it('flush() with nothing pending sends nothing', async () => {
    const r = rig();
    await r.service.flush();
    expect(r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_SYNC_METHOD)).toHaveLength(0);
  });

  it('does not restore while terminal attention is switched off', async () => {
    const r = rig([entry]);
    r.setSettings((s) => {
      s.terminals.attention.enabled = false;
    });
    await r.service.onDaemonConnected();
    expect(changed(r)).toHaveLength(0);
  });

  it('syncs the mark set to the daemon debounced at 250 ms', async () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1' }));
    r.service.onSignal(signal({ panelId: 'p2' }));
    await vi.advanceTimersByTimeAsync(249);
    expect(r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_SYNC_METHOD)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const syncs = r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_SYNC_METHOD);
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.params.entries.map((e: any) => e.panelId).sort()).toEqual(['p1', 'p2']);
  });
});

describe('AttentionService — delivery (T040)', () => {
  const toastOps = (r: Rig) => r.toasts().map((t) => t.payload.op);

  // FR-111: one Attention type for both kinds; its toast is always sent (the renderer applies its display
  // mode), and its OS switch adds a Windows notification while no window is focused (FR-110).
  it('raises a toast and, while no window is focused, a Windows notification', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1' }));
    expect(toastOps(r)).toEqual(['raise']);
    expect(r.notifier.shown).toHaveLength(1);
    r.state.focused = 1;
    r.service.onSignal(signal({ panelId: 'p2' }));
    expect(toastOps(r)).toEqual(['raise', 'raise']);
    expect(r.notifier.shown).toHaveLength(1);
  });

  it("notifications.attention.os off sends the toast alone (FR-110)", () => {
    const r = rig();
    r.setSettings((s) => {
      s.notifications.attention.os = false;
    });
    r.service.onSignal(signal());
    expect(toastOps(r)).toEqual(['raise']);
    expect(r.notifier.shown).toHaveLength(0);
  });

  it('notifications.os off sends nothing to the OS, whatever Attention says (FR-109)', () => {
    const r = rig();
    r.setSettings((s) => {
      s.notifications.os = false;
    });
    r.service.onSignal(signal());
    expect(toastOps(r)).toEqual(['raise']);
    expect(r.notifier.shown).toHaveLength(0);
  });

  it('a Failed mark follows the Attention settings too (FR-111)', () => {
    const r = rig();
    r.setSettings((s) => {
      s.notifications.attention.os = false;
    });
    r.service.onSignal(signal({ kind: 'failed', signal: 'processExited', detail: '2' }));
    expect(r.notifier.shown).toHaveLength(0);
    expect(r.toasts()[0]!.payload).toMatchObject({ op: 'raise', kind: 'failed', panelId: 'p1' });
  });

  it('announces a mark once: a later raise updates its toast and raises no new Windows notification (FR-112)', () => {
    const r = rig();
    r.service.onSignal(signal({ signal: 'progressEnded' }));
    r.service.onSignal(signal({ signal: 'notification', detail: 'Claude is waiting for your input' }));
    expect(toastOps(r)).toEqual(['raise', 'update']);
    expect(r.notifier.shown.map((n) => n.id)).toEqual(['p1']);
    expect(r.toasts()[1]!.payload.reason).toContain('Claude is waiting'); // FR-116: the newest message
  });

  it('announces again once the mark has cleared (FR-112)', () => {
    const r = rig();
    r.service.onSignal(signal({ signal: 'bell' }));
    r.service.onPanelDestroyed('p1');
    r.service.onSignal(signal({ signal: 'bell' }));
    expect(toastOps(r)).toEqual(['raise', 'dismiss', 'raise']);
    expect(r.notifier.shown.map((n) => n.id)).toEqual(['p1', 'p1']);
  });

  it('ignores a click on a notice\'s Windows notification, which is not a mark (FR-110)', () => {
    const r = rig();
    r.notifier.click('notice:1');
    expect(r.notifier.closed).toEqual([]);
    expect(r.raised).toEqual([]);
  });

  it('a clear dismisses the toast and closes the OS notification (FR-036)', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onSignal(signal());
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    vi.advanceTimersByTime(1000);
    expect(toastOps(r)).toEqual(['raise', 'dismiss']);
    expect(r.notifier.closed).toContain('p1');
  });

  it('sends the toast to the focused window, else the main window', () => {
    const r = rig();
    r.state.ids = [1, 2];
    r.state.hosts = [1, 2];
    r.state.focused = 2;
    r.service.onSignal(signal({ panelId: 'p1' }));
    expect(r.toasts()[0]!.windowId).toBe(2);
    r.state.focused = null;
    r.service.onSignal(signal({ panelId: 'p2' }));
    expect(r.toasts()[1]!.windowId).toBe(1);
  });

  // FR-115: a notification is the panel's title — the terminal's window title unless the user named it —
  // over "Wants your attention"; no kind in brackets, no project, no "what it was doing".
  it('titles a notification with the panel and says "Wants your attention" (FR-115)', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1', signal: 'notification', detail: 'Claude is waiting', doing: 'Fix the login bug', tabTitle: 'Agents' }));
    const text = 'Claude is waiting'; // FR-117: the program's message, alone
    // FR-120: the project and the tab, then the panel, as the toast's subject reads them.
    expect(r.toasts()[0]!.payload).toMatchObject({ title: 'Build', projectName: 'Alpha', tabTitle: 'Agents', reason: text, kind: 'attention' });
    expect(r.notifier.shown[0]).toMatchObject({ title: 'Alpha — Agents — Build', body: text, kind: 'attention' });
  });

  it('says what failed for a Failed mark, still without the kind in brackets (FR-115)', () => {
    const r = rig();
    r.service.onSignal(signal({ kind: 'failed', signal: 'processExited', detail: '3', doing: 'npm test' }));
    expect(r.notifier.shown[0]).toMatchObject({ title: 'Alpha — Build', kind: 'failed' }); // no tab known: left out
    expect(r.notifier.shown[0].body).toContain('3');
    expect(r.notifier.shown[0].body).toBe("Process exited '3'"); // FR-117
    expect(r.notifier.shown[0].body).not.toMatch(/\(Failed\)/);
    expect(r.toasts()[0]!.payload.reason).toBe(r.notifier.shown[0].body);
  });
});

describe('AttentionService — taskbar badge (T041)', () => {
  it('shows the count across all projects and the Failed style when any is Failed', async () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1', projectId: 'a' }));
    await settle();
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set', image: 'img:attention:1' });
    r.service.onSignal(signal({ panelId: 'p2', projectId: 'b', kind: 'failed', signal: 'processExited' }));
    await settle();
    const last = r.badge.calls.at(-1)!;
    expect(last).toMatchObject({ op: 'set', image: 'img:failed:2' });
    expect(last.description).toMatch(/2/);
    expect(last.description).toMatch(/failed/i);
  });

  it('is cleared at zero', async () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onSignal(signal());
    await settle();
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.badge.calls.at(-1)).toEqual({ op: 'clear' });
  });

  it('is unaffected by the notification settings', async () => {
    const r = rig();
    r.setSettings((s) => {
      s.notifications.os = false;
      s.notifications.attention.mode = 'never';
    });
    r.service.onSignal(signal());
    await settle();
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set' });
  });

  it('is off when attention.taskbarBadge is false, and comes back when switched on', async () => {
    const r = rig();
    r.setSettings((s) => {
      s.attention.taskbarBadge = false;
    });
    r.service.onSignal(signal());
    await settle();
    expect(r.badge.calls.some((c) => c.op === 'set')).toBe(false);
    r.setSettings((s) => {
      s.attention.taskbarBadge = true;
    });
    await settle();
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set', image: 'img:attention:1' });
  });

  it('counts restored marks', async () => {
    const r = rig([
      {
        panelId: 'p9',
        projectId: 'a',
        kind: 'attention',
        reason: { signal: 'bell', detail: null },
        raisedAt: 1,
        whileDetached: true,
      },
    ]);
    await r.service.onDaemonConnected();
    await settle();
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set', image: 'img:attention:1' });
  });
});

describe('AttentionService — goTo (T046)', () => {
  it('raises the sub-workspace window that hosts the panel and sends it focusPanel', () => {
    const r = rig();
    r.state.ids = [1, 2];
    r.service.onSignal(signal({ panelId: 'p1', projectId: 'proj-a' }));
    r.service.onFocusReport(
      report({ windowId: 2, windowFocused: false, hostedPanels: [{ panelId: 'p1', projectId: 'proj-a', title: 'Build' }] }),
    );
    r.service.goTo('p1');
    expect(r.raised).toEqual([2]);
    const focus = r.sent.filter((s) => s.channel === 'throng:attention:focusPanel');
    expect(focus).toEqual([
      { windowId: 2, channel: 'throng:attention:focusPanel', payload: { panelId: 'p1', projectId: 'proj-a' } },
    ]);
  });

  it('otherwise raises the main window and tells it to switch project', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1', projectId: 'proj-z' }));
    r.service.goTo('p1');
    expect(r.raised).toEqual([1]);
    expect(r.sent.filter((s) => s.channel === 'throng:attention:focusPanel')).toEqual([
      { windowId: 1, channel: 'throng:attention:focusPanel', payload: { panelId: 'p1', projectId: 'proj-z' } },
    ]);
  });

  it('a panel that no longer exists only dismisses the notification', () => {
    const r = rig();
    r.service.goTo('gone');
    expect(r.raised).toEqual([]);
    expect(r.sent.filter((s) => s.channel === 'throng:attention:focusPanel')).toEqual([]);
    expect(r.notifier.closed).toContain('gone');
    expect(r.toasts().map((t) => t.payload)).toEqual([]);
  });

  it('an OS notification click calls goTo', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1' }));
    r.notifier.click('p1');
    expect(r.raised).toEqual([1]);
    expect(r.sent.some((s) => s.channel === 'throng:attention:focusPanel')).toBe(true);
  });
});

describe('AttentionService — switches (T051)', () => {
  it('switching terminals.attention.enabled off withdraws every mark and dismisses their notifications (FR-063)', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1' }));
    r.service.onSignal(signal({ panelId: 'p2' }));
    r.setSettings((s) => {
      s.terminals.attention.enabled = false;
    });
    expect(lastMarks(r)).toEqual([]);
    expect(r.notifier.closed.sort()).toEqual(['p1', 'p2']);
    expect(r.toasts().filter((t) => t.payload.op === 'dismiss')).toHaveLength(2);
  });

  it('raises no new marks while the master switch is off', () => {
    const r = rig();
    r.setSettings((s) => {
      s.terminals.attention.enabled = false;
    });
    r.service.onSignal(signal());
    expect(changed(r)).toHaveLength(0);
  });

  it('switching one signal off keeps existing marks (US4 AS4)', () => {
    const r = rig();
    r.service.onSignal(signal({ signal: 'bell' }));
    r.setSettings((s) => {
      s.terminals.attention.signals.bell = false;
    });
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['p1']);
  });
});

describe('AttentionService — startup commands (T054)', () => {
  it('a startup signal raises the mark and counts on the badge but no toast and no OS notification (FR-038a)', async () => {
    const r = rig();
    r.service.onSignal(signal({ signal: 'commandFinished', startup: true }));
    await settle();
    expect(lastMarks(r)).toHaveLength(1);
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set' });
    expect(r.toasts()).toHaveLength(0);
    expect(r.notifier.shown).toHaveLength(0);
  });

  it('a later signal while the startup mark still shows announces nothing (FR-134, superseding FR-038a)', () => {
    const r = rig();
    r.service.onSignal(signal({ signal: 'commandFinished', startup: true }));
    r.service.onSignal(signal({ signal: 'bell' }));
    expect(r.toasts()).toHaveLength(0);
    expect(r.notifier.shown).toHaveLength(0);
  });

  it('once the startup mark has cleared, the next signal announces (FR-134)', () => {
    const r = rig();
    r.service.onSignal(signal({ signal: 'commandFinished', startup: true }));
    r.service.onPanelDestroyed('p1');
    r.service.onSignal(signal({ signal: 'bell' }));
    expect(r.toasts().map((t) => t.payload.op)).toEqual(['raise']);
    expect(r.notifier.shown).toHaveLength(1);
  });
});

describe('AttentionService — dwell clearing is driven by a timer', () => {
  it('clears a mark after attention.clearDelayMs of its panel holding focus in a focused window (FR-095)', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onSignal(signal());
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    expect(lastMarks(r)).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(lastMarks(r)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(lastMarks(r)).toEqual([]);
  });

  it('never clears a mark whose panel is only active, however long (FR-095)', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onSignal(signal());
    r.service.onFocusReport(report({}));
    vi.advanceTimersByTime(60_000);
    expect(lastMarks(r)).toHaveLength(1);
  });
});

describe('AttentionService — review fixes', () => {
  it('never sends a toast to a window that does not mount toasts (Preferences, About)', () => {
    const r = rig();
    r.state.ids = [1, 3];
    r.state.hosts = [1];
    r.state.focused = 3;
    r.service.onSignal(signal());
    expect(r.toasts()[0]!.windowId).toBe(1);
  });

  it('a window that main says is unfocused is not attending, whatever its last report said', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    // The window is minimised: rAF stopped, so no blur is ever reported, but main sees it.
    r.state.focused = null;
    r.service.onWindowFocusChanged();
    r.service.onSignal(signal({ panelId: 'p1' }));
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['p1']);
  });

  it('judges attendance by main’s focus at the raise itself, even if no focus event arrived', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    r.state.focused = null;
    r.service.onSignal(signal({ panelId: 'p1' }));
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['p1']);
  });

  it('closing a window forgets its toasts; a later signal on the announced mark raises none elsewhere (FR-112)', () => {
    const r = rig();
    r.state.ids = [1, 2];
    r.state.hosts = [1, 2];
    r.state.focused = 2;
    r.service.onSignal(signal({ signal: 'bell' }));
    expect(r.toasts()[0]!.windowId).toBe(2);
    r.state.ids = [1];
    r.state.hosts = [1];
    r.state.focused = null;
    r.service.onWindowClosed(2);
    r.service.onSignal(signal({ signal: 'commandFinished', detail: 'x' }));
    expect(r.toasts().map((t) => [t.windowId, t.payload.op])).toEqual([[2, 'raise']]);
  });

  it('after restoring on connect, pushes the full current mark set to the daemon (a restarted daemon has none)', async () => {
    const r = rig([]);
    r.service.onSignal(signal({ panelId: 'p1' }));
    await vi.advanceTimersByTimeAsync(300); // the debounced sync from the raise, cleared below
    r.daemonCalls.length = 0;
    await r.service.onDaemonConnected();
    const syncs = r.daemonCalls.filter((c) => c.method === TERMINAL_ATTENTION_SYNC_METHOD);
    expect(syncs).toHaveLength(1);
    expect(syncs[0]!.params.entries.map((e: any) => e.panelId)).toEqual(['p1']);
    const order = r.daemonCalls.map((c) => c.method);
    expect(order.indexOf(TERMINAL_ATTENTION_LEDGER_METHOD)).toBeLessThan(order.indexOf(TERMINAL_ATTENTION_SYNC_METHOD));
  });
});

describe('AttentionService — late windows (T068)', () => {
  it('currentMarks() answers the live set for a renderer that pulls on registration', () => {
    const r = rig();
    r.service.onSignal(signal({ panelId: 'p1' }));
    expect(r.service.currentMarks().map((m) => m.panelId)).toEqual(['p1']);
  });

  it('sendMarksTo pushes the current set to ONE window that has just loaded', () => {
    const r = rig();
    r.state.ids = [1, 2];
    r.service.onSignal(signal({ panelId: 'p1' }));
    r.sent.length = 0;
    r.service.sendMarksTo(2);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ windowId: 2, channel: 'throng:attention:changed' });
    expect(r.sent[0]!.payload.marks.map((m: any) => m.panelId)).toEqual(['p1']);
  });
});

describe('AttentionService — badge when no window can draw it (T069)', () => {
  const restoredEntry: AttentionLedgerEntry = {
    panelId: 'p9',
    projectId: 'a',
    kind: 'attention',
    reason: { signal: 'bell', detail: null },
    raisedAt: 1,
    whileDetached: true,
  };

  it('counts marks restored before any window exists, once a window can answer', async () => {
    const r = rig([restoredEntry]);
    r.state.main = null;
    r.state.ids = [];
    await r.service.onDaemonConnected();
    await settle();
    expect(r.badge.calls.some((c) => c.op === 'set')).toBe(false);
    r.state.main = 1;
    r.state.ids = [1];
    r.service.onBadgeAnswererReady();
    await settle();
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set', image: 'img:attention:1' });
  });

  it('retries after a null reply', async () => {
    const r = rig();
    r.state.badgeNulls = 1;
    r.service.onSignal(signal());
    await settle();
    expect(r.badge.calls.some((c) => c.op === 'set')).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set', image: 'img:attention:1' });
  });

  it('retries a bounded number of times, then stops', async () => {
    const r = rig();
    r.state.badgeNulls = 1000;
    r.service.onSignal(signal());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.state.badgeRequests).toBeGreaterThan(1);
    expect(r.state.badgeRequests).toBeLessThanOrEqual(6);
    expect(r.badge.calls.some((c) => c.op === 'set')).toBe(false);
  });

  it('a window becoming ready resets the retries', async () => {
    const r = rig();
    r.state.badgeNulls = 1000;
    r.service.onSignal(signal());
    await vi.advanceTimersByTimeAsync(60_000);
    r.state.badgeNulls = 0;
    r.service.onBadgeAnswererReady();
    await settle();
    expect(r.badge.calls.at(-1)).toMatchObject({ op: 'set' });
  });
});

describe('AttentionService — Output went quiet only for unattended output (T070)', () => {
  const quiet = (activityAt: number | undefined, panelId = 'p1') =>
    signal({ panelId, signal: 'outputQuiet', ...(activityAt === undefined ? {} : { activityAt }) });

  function quietRig() {
    const r = rig();
    r.setSettings((s) => {
      s.terminals.attention.signals.outputQuiet = true;
    });
    return r;
  }
  const attend = (r: Rig) => {
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
  };
  const unattend = (r: Rig) => {
    r.state.focused = null;
    r.service.onWindowFocusChanged();
  };

  it('drops it when the burst began while the panel was attended', () => {
    const r = quietRig();
    vi.setSystemTime(10_000);
    attend(r);
    vi.setSystemTime(20_000);
    unattend(r);
    vi.setSystemTime(40_000);
    r.service.onSignal(quiet(15_000));
    expect(lastMarks(r)).toEqual([]);
  });

  it('raises it when the burst began after the panel stopped being attended', () => {
    const r = quietRig();
    vi.setSystemTime(10_000);
    attend(r);
    vi.setSystemTime(20_000);
    unattend(r);
    vi.setSystemTime(40_000);
    r.service.onSignal(quiet(25_000));
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['p1']);
  });

  it('drops it when the panel was attended again after the burst began', () => {
    const r = quietRig();
    vi.setSystemTime(10_000);
    attend(r);
    vi.setSystemTime(20_000);
    unattend(r);
    vi.setSystemTime(30_000);
    attend(r);
    vi.setSystemTime(40_000);
    unattend(r);
    vi.setSystemTime(50_000);
    r.service.onSignal(quiet(25_000));
    expect(lastMarks(r)).toEqual([]);
  });

  it('raises it for a panel that was never attended', () => {
    const r = quietRig();
    r.service.onSignal(quiet(5_000, 'never'));
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['never']);
  });

  it('leaves every other signal alone', () => {
    const r = quietRig();
    vi.setSystemTime(10_000);
    attend(r);
    vi.setSystemTime(20_000);
    unattend(r);
    r.service.onSignal(signal({ signal: 'bell' }));
    expect(lastMarks(r).map((m: any) => m.panelId)).toEqual(['p1']);
  });
});

// 057 FR-099 — main is the one judge of attendance, so it tells the daemon the attended set; the daemon
// tells each focus-reporting program. Sent whole, so a reconnect needs no history.
describe('AttentionService — focus reports to the daemon (FR-099)', () => {
  const focusCalls = (r: Rig) =>
    r.daemonCalls.filter((c) => c.method === 'terminal.attentionFocus').map((c) => (c.params as { attended: string[] }).attended);

  it('sends the attended set when a panel becomes attended, and again when it stops', async () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    r.service.onFocusReport(report({ focusedPanelId: null }));
    await settle();
    expect(focusCalls(r)).toEqual([['p1'], []]);
  });

  it('sends nothing when a report leaves the set as it was', () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    r.service.onFocusReport(report({ focusedPanelId: 'p1', hostedPanels: [] }));
    expect(focusCalls(r)).toEqual([['p1']]);
  });

  it('a window main sees lose focus empties the set, even though its renderer never said so', async () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    r.state.focused = null;
    r.service.onWindowFocusChanged();
    await settle();
    expect(focusCalls(r)).toEqual([['p1'], []]);
  });

  it('a closed window stops attending', async () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    r.service.onWindowClosed(1);
    await settle();
    expect(focusCalls(r)).toEqual([['p1'], []]);
  });

  it('sends the current set on every daemon (re)connect, whatever the attention settings', async () => {
    const r = rig();
    r.setSettings((s) => {
      s.terminals.attention.enabled = false;
    });
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    await r.service.onDaemonConnected();
    expect(focusCalls(r)).toEqual([['p1'], ['p1']]);
  });
});

// Review fix: each push used to go out on its own connection, so two in quick succession could be handled
// out of order and leave a stale set in force. One in flight; whatever changed meanwhile goes next.
describe('AttentionService — attended-set pushes stay in order (FR-099, review)', () => {
  const focusCalls = (r: Rig) =>
    r.daemonCalls.filter((c) => c.method === 'terminal.attentionFocus').map((c) => (c.params as { attended: string[] }).attended);

  it('holds a second push until the first is answered, then sends only the latest set', async () => {
    const r = rig();
    r.state.focused = 1;
    r.service.onFocusReport(report({ focusedPanelId: 'p1' }));
    r.service.onFocusReport(report({ focusedPanelId: 'p2' }));
    r.service.onFocusReport(report({ focusedPanelId: null }));
    expect(focusCalls(r)).toEqual([['p1']]);
    await settle();
    expect(focusCalls(r)).toEqual([['p1'], []]);
    await settle();
    expect(focusCalls(r)).toEqual([['p1'], []]);
  });
});
