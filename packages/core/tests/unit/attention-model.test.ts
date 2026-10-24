import { describe, expect, it } from 'vitest';
import { AttentionModel } from '../../src/attention/attention-model.js';
import type { AttentionSignal, FocusReport } from '../../src/attention/attention-types.js';

function harness(clearDelayMs = 1000) {
  let clock = 10_000;
  const model = new AttentionModel({ clearDelayMs, now: () => clock });
  const cleared: string[] = [];
  let changes = 0;
  model.onCleared((id) => cleared.push(id));
  model.onChange(() => changes++);
  return {
    model,
    cleared,
    changes: () => changes,
    advance(ms: number) {
      clock += ms;
      model.tick();
    },
  };
}

function signal(overrides: Partial<AttentionSignal> = {}): AttentionSignal {
  return {
    panelId: 'p1',
    projectId: 'A',
    signal: 'bell',
    kind: 'attention',
    detail: null,
    startup: false,
    panelTitle: 'Build',
    projectName: 'Alpha',
    at: 0,
    ...overrides,
  };
}

function report(overrides: Partial<FocusReport> = {}): FocusReport {
  return {
    windowId: 1,
    windowFocused: true,
    focusedPanelId: null,
    hostedPanels: [],
    ...overrides,
  };
}

describe('AttentionModel', () => {
  it('raise creates a mark carrying the signal', () => {
    const { model } = harness();
    model.raise(signal({ detail: 'x' }));
    expect(model.marks()).toHaveLength(1);
    expect(model.marks()[0]).toMatchObject({
      panelId: 'p1',
      projectId: 'A',
      panelTitle: 'Build',
      projectName: 'Alpha',
      producer: 'terminal',
      kind: 'attention',
      reason: { signal: 'bell', detail: 'x' },
      dwellStartedAt: null,
    });
  });

  it('ignores a raise on the attended panel — focused panel in a focused window (FR-004)', () => {
    const { model } = harness();
    model.applyFocusReport(report({ focusedPanelId: 'p1' }));
    model.raise(signal());
    expect(model.marks()).toEqual([]);
  });

  it('does not treat the focused panel of an unfocused window as attended', () => {
    const { model } = harness();
    model.applyFocusReport(report({ windowFocused: false, focusedPanelId: 'p1' }));
    model.raise(signal());
    expect(model.marks()).toHaveLength(1);
  });

  it('a repeat raise replaces the reason and makes Failed sticky (FR-002)', () => {
    const { model } = harness();
    model.raise(signal({ kind: 'failed', signal: 'processExited', detail: '1' }));
    model.raise(signal({ kind: 'attention', signal: 'bell' }));
    expect(model.marks()).toHaveLength(1);
    expect(model.marks()[0]!.kind).toBe('failed');
    expect(model.marks()[0]!.reason).toEqual({ signal: 'bell', detail: null });
  });

  it('a repeat Attention raise followed by a Failed one becomes Failed', () => {
    const { model } = harness();
    model.raise(signal());
    model.raise(signal({ kind: 'failed', signal: 'progressEnded' }));
    expect(model.marks()[0]!.kind).toBe('failed');
  });

  // FR-095 (Session 2026-10-19, round 2) supersedes FR-005 and FR-006: a mark clears only once its
  // panel has been FOCUSED — keyboard focus in the workspace pane, in a focused window — continuously for
  // the clear delay. Being the active panel, however long, no longer clears it.
  describe('clearing on focus (FR-095)', () => {
    it('focusing the panel starts the delay, and the mark clears once it has held focus that long', () => {
      const h = harness(1000);
      h.model.raise(signal());
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      expect(h.model.marks()).toHaveLength(1);
      expect(h.model.nextTickAt()).toBe(11_000);
      h.advance(999);
      expect(h.model.marks()).toHaveLength(1);
      h.advance(1);
      expect(h.model.marks()).toEqual([]);
      expect(h.cleared).toEqual(['p1']);
    });

    it('being the active panel without focus never clears it — a project switched to from the list', () => {
      const h = harness(1000);
      h.model.raise(signal());
      h.model.applyFocusReport(report({}));
      expect(h.model.nextTickAt()).toBeNull();
      h.advance(60_000);
      expect(h.model.marks()).toHaveLength(1);
    });

    it('losing focus before the delay restarts it', () => {
      const h = harness(1000);
      h.model.raise(signal());
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      h.advance(700);
      h.model.applyFocusReport(report({ focusedPanelId: null }));
      h.advance(5000);
      expect(h.model.marks()).toHaveLength(1);
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      h.advance(999);
      expect(h.model.marks()).toHaveLength(1);
      h.advance(1);
      expect(h.model.marks()).toEqual([]);
    });

    it('the delay pauses while the window is unfocused and starts again from zero', () => {
      const h = harness(1000);
      h.model.raise(signal());
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      h.advance(600);
      h.model.applyFocusReport(report({ windowFocused: false, focusedPanelId: 'p1' }));
      h.advance(5000);
      expect(h.model.marks()).toHaveLength(1);
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      h.advance(999);
      expect(h.model.marks()).toHaveLength(1);
      h.advance(1);
      expect(h.model.marks()).toEqual([]);
    });

    it('focus in an unfocused window does not start it', () => {
      const h = harness(1000);
      h.model.raise(signal());
      h.model.applyFocusReport(report({ windowFocused: false, focusedPanelId: 'p1' }));
      expect(h.model.nextTickAt()).toBeNull();
      h.advance(5000);
      expect(h.model.marks()).toHaveLength(1);
    });

    it('clearDelayMs 0 clears on focus, and still not on becoming active', () => {
      const h = harness(0);
      h.model.raise(signal());
      h.model.applyFocusReport(report({}));
      expect(h.model.marks()).toHaveLength(1);
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      expect(h.model.marks()).toEqual([]);
    });

    it('a mark restored onto the panel that already has focus starts its delay at once (review)', () => {
      const h = harness(1000);
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      h.model.restore([
        { panelId: 'p1', projectId: 'A', kind: 'attention', reason: { signal: 'bell', detail: null }, raisedAt: 5, whileDetached: true },
      ]);
      expect(h.model.nextTickAt()).toBe(11_000);
      h.advance(1000);
      expect(h.model.marks()).toEqual([]);
    });

    it('only the focused panel’s mark clears — another active panel’s stays', () => {
      const h = harness(0);
      h.model.raise(signal({ panelId: 'p1' }));
      h.model.raise(signal({ panelId: 'p2' }));
      h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
      expect(h.model.marks().map((m) => m.panelId)).toEqual(['p2']);
    });
  });

  it('withdraw(terminal) clears every mark (FR-008, FR-063)', () => {
    const h = harness();
    h.model.raise(signal());
    h.model.raise(signal({ panelId: 'p2' }));
    h.model.withdraw('terminal');
    expect(h.model.marks()).toEqual([]);
    expect(h.cleared.sort()).toEqual(['p1', 'p2']);
  });

  it('panelDestroyed and projectDeleted clear (FR-007)', () => {
    const h = harness();
    h.model.raise(signal());
    h.model.raise(signal({ panelId: 'p2', projectId: 'B' }));
    h.model.raise(signal({ panelId: 'p3', projectId: 'B' }));
    h.model.panelDestroyed('p1');
    h.model.projectDeleted('B');
    expect(h.model.marks()).toEqual([]);
    expect(h.cleared.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it("a hosting FocusReport moves the mark to the panel's project and live title", () => {
    const { model } = harness();
    model.raise(signal());
    model.applyFocusReport(
      report({ windowFocused: false, hostedPanels: [{ panelId: 'p1', projectId: 'B', title: 'Renamed' }] }),
    );
    expect(model.marks()[0]).toMatchObject({ projectId: 'B', panelTitle: 'Renamed' });
  });

  it('removeWindow stops that window counting as attending', () => {
    const { model } = harness();
    model.applyFocusReport(report({ focusedPanelId: 'p1' }));
    model.removeWindow(1);
    model.raise(signal());
    expect(model.marks()).toHaveLength(1);
  });

  it('restore brings marks back without raising clears', () => {
    const { model, cleared } = harness();
    model.restore([
      {
        panelId: 'p1',
        projectId: 'A',
        kind: 'failed',
        reason: { signal: 'bell', detail: null },
        raisedAt: 5,
        whileDetached: false,
      },
    ]);
    expect(model.marks()[0]).toMatchObject({ panelId: 'p1', kind: 'failed', raisedAt: 5 });
    expect(cleared).toEqual([]);
    expect(model.ledgerEntries()).toEqual([
      expect.objectContaining({ panelId: 'p1', kind: 'failed', whileDetached: false }),
    ]);
  });

  it('notifies onChange once per effective change', () => {
    const h = harness();
    h.model.raise(signal());
    expect(h.changes()).toBe(1);
    h.model.applyFocusReport(report());
    expect(h.changes()).toBe(1);
  });
});


// 057 FR-100 / FR-102 — a mark carries its tab's name and what its terminal was doing.
describe('AttentionModel — tab and activity (FR-100, FR-102)', () => {
  it('keeps the signal\'s tab title and activity, and defaults them when a signal has none', () => {
    const { model } = harness();
    model.raise(signal({ tabTitle: 'Agents', doing: 'Fix the login bug' }));
    model.raise(signal({ panelId: 'p2' }));
    expect(model.marks().find((m) => m.panelId === 'p1')).toMatchObject({ tabTitle: 'Agents', doing: 'Fix the login bug' });
    expect(model.marks().find((m) => m.panelId === 'p2')).toMatchObject({ tabTitle: '', doing: null });
  });

  it('a later raise replaces both: the newest signal says what is happening now', () => {
    const { model } = harness();
    model.raise(signal({ tabTitle: 'Agents', doing: 'first' }));
    model.raise(signal({ tabTitle: 'Renamed', doing: 'second', at: 5 }));
    expect(model.marks()[0]).toMatchObject({ tabTitle: 'Renamed', doing: 'second' });
  });

  it('a later raise never blanks a known tab title, and a hosting window\'s name beats the daemon\'s (review)', () => {
    const { model } = harness();
    model.raise(signal({ tabTitle: 'Agents' }));
    model.raise(signal({ tabTitle: '', at: 5 }));
    expect(model.marks()[0]!.tabTitle).toBe('Agents');
    model.applyFocusReport(report({ hostedPanels: [{ panelId: 'p1', projectId: 'A', title: 'Build', tabTitle: 'Renamed' }] }));
    model.raise(signal({ tabTitle: 'Agents', at: 9 })); // the store has not saved the rename yet
    expect(model.marks()[0]!.tabTitle).toBe('Renamed');
  });

  // FR-116: the notification goes out at the raise, so the title must already be the live one then.
  it('names a new mark with the hosting window\'s live panel title, ahead of the daemon\'s', () => {
    const { model } = harness();
    model.applyFocusReport(report({ windowFocused: false, hostedPanels: [{ panelId: 'p1', projectId: 'A', title: '✳ Fix the login bug' }] }));
    model.raise(signal({ panelTitle: 'Command Prompt' }));
    expect(model.marks()[0]!.panelTitle).toBe('✳ Fix the login bug');
    model.raise(signal({ panelId: 'p2', panelTitle: 'Command Prompt' })); // hosted nowhere: the daemon's
    expect(model.marks().find((m) => m.panelId === 'p2')!.panelTitle).toBe('Command Prompt');
  });

  it('a window hosting the panel refreshes its tab title, as it does the panel title', () => {
    const { model } = harness();
    model.raise(signal({ tabTitle: 'Agents' }));
    model.applyFocusReport(report({ hostedPanels: [{ panelId: 'p1', projectId: 'A', title: 'Build', tabTitle: 'Moved here' }] }));
    expect(model.marks()[0]!.tabTitle).toBe('Moved here');
  });

  it('round-trips both through the ledger', () => {
    const { model } = harness();
    model.raise(signal({ tabTitle: 'Agents', doing: 'npm test' }));
    const entries = model.ledgerEntries();
    expect(entries[0]).toMatchObject({ tabTitle: 'Agents', doing: 'npm test' });
    const restored = harness().model;
    restored.restore(entries);
    expect(restored.marks()[0]).toMatchObject({ tabTitle: 'Agents', doing: 'npm test' });
  });
});

describe('AttentionModel — manual flags (057 round 12: FR-125, FR-127, FR-128)', () => {
  const flag = { panelId: 'p1', projectId: 'A', panelTitle: 'Notes', tabTitle: 'Docs', projectName: 'Alpha', at: 5 };

  it('flag raises a user mark, Attention, reason Flagged (FR-125)', () => {
    const { model } = harness();
    expect(model.flag(flag)).toBe(true);
    expect(model.marks()[0]).toMatchObject({
      panelId: 'p1',
      producer: 'user',
      kind: 'attention',
      reason: { signal: 'flagged', detail: null },
      tabTitle: 'Docs',
    });
  });

  it('flag on a panel already marked changes nothing (FR-125)', () => {
    const { model } = harness();
    model.raise(signal({ kind: 'failed', signal: 'processExited', detail: '1' }));
    const before = model.marks();
    expect(model.flag(flag)).toBe(false);
    expect(model.marks()).toBe(before);
  });

  it('a flag raised on the focused panel does not clear while that focus holds, however long (FR-127)', () => {
    const h = harness();
    h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
    h.model.flag(flag);
    h.advance(60_000);
    expect(h.model.marks()).toHaveLength(1);
    expect(h.model.nextTickAt()).toBeNull();
  });

  it('once focus has left and come back, the clear delay runs as usual (FR-127)', () => {
    const h = harness();
    h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
    h.model.flag(flag);
    h.model.applyFocusReport(report({ focusedPanelId: 'p2' }));
    h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
    h.advance(999);
    expect(h.model.marks()).toHaveLength(1);
    h.advance(1);
    expect(h.model.marks()).toHaveLength(0);
    expect(h.cleared).toEqual(['p1']);
  });

  it('a flag raised on an unfocused panel is not held: focusing it clears it after the delay', () => {
    const h = harness();
    h.model.flag(flag);
    h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
    h.advance(1000);
    expect(h.model.marks()).toHaveLength(0);
  });

  it('a terminal raise on a flagged panel updates its reason but keeps it the user\'s (R20)', () => {
    const { model } = harness();
    model.flag(flag);
    model.raise(signal({ signal: 'bell' }));
    expect(model.marks()[0]).toMatchObject({ producer: 'user', reason: { signal: 'bell' } });
  });

  it('withdrawing the terminal producer leaves user flags (FR-128)', () => {
    const { model } = harness();
    model.flag(flag);
    model.raise(signal({ panelId: 'p2' }));
    model.withdraw('terminal');
    expect(model.marks().map((m) => m.panelId)).toEqual(['p1']);
  });

  it('the ledger carries terminal marks only (R19)', () => {
    const { model } = harness();
    model.flag(flag);
    model.raise(signal({ panelId: 'p2' }));
    expect(model.ledgerEntries().map((e) => e.panelId)).toEqual(['p2']);
  });

  it('restoreFlags reinstates user marks, unheld and without clear events (FR-128)', () => {
    const h = harness();
    h.model.restoreFlags([{ panelId: 'p1', projectId: 'A', panelTitle: 'Notes', tabTitle: 'Docs', projectName: 'Alpha', raisedAt: 5 }]);
    expect(h.model.marks()[0]).toMatchObject({ producer: 'user', reason: { signal: 'flagged' }, raisedAt: 5 });
    expect(h.cleared).toEqual([]);
    h.model.applyFocusReport(report({ focusedPanelId: 'p1' }));
    h.advance(1000);
    expect(h.model.marks()).toHaveLength(0);
  });
});
