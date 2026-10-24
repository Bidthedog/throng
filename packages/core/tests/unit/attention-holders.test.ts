import { describe, expect, it } from 'vitest';
import {
  badgeSummary,
  describeMark,
  notificationText,
  categoryCount,
  categoryKind,
  holderCount,
  markCountLabel,
  projectCount,
  holderKind,
  holderLabel,
  marksForPanels,
  marksForProject,
  marksForProjects,
  projectKind,
  reasonLabel,
  tooltipLines,
} from '../../src/attention/attention-holders.js';
import type { AttentionMark } from '../../src/attention/attention-types.js';

function mark(panelId: string, projectId: string, overrides: Partial<AttentionMark> = {}): AttentionMark {
  return {
    panelId,
    projectId,
    panelTitle: `Panel ${panelId}`,
    projectName: `Project ${projectId}`,
    producer: 'terminal',
    kind: 'attention',
    reason: { signal: 'bell', detail: null },
    raisedAt: 0,
    dwellStartedAt: null,
    tabTitle: '',
    doing: null,
    ...overrides,
  };
}

describe('attention holders', () => {
  it('holderKind: null when none of the panels is marked, Failed wins (FR-014)', () => {
    const marks = [mark('a', 'P'), mark('b', 'P', { kind: 'failed' })];
    expect(holderKind(marks, ['x'])).toBeNull();
    expect(holderKind(marks, ['a'])).toBe('attention');
    expect(holderKind(marks, new Set(['a', 'b']))).toBe('failed');
  });

  it('projectKind aggregates by project, including unloaded projects (FR-012)', () => {
    const marks = [mark('a', 'P'), mark('b', 'Q', { kind: 'failed' }), mark('c', 'Q')];
    expect(projectKind(marks, 'P')).toBe('attention');
    expect(projectKind(marks, 'Q')).toBe('failed');
    expect(projectKind(marks, 'R')).toBeNull();
  });

  it('categoryKind covers every project of the category, marked rows a minimised category hides included (FR-013)', () => {
    const marks = [mark('a', 'P'), mark('b', 'Q', { kind: 'failed' })];
    expect(categoryKind(marks, ['P'])).toBe('attention');
    expect(categoryKind(marks, ['P', 'Q'])).toBe('failed');
    expect(categoryKind(marks, ['R'])).toBeNull();
  });

  it('selectors return the matching marks', () => {
    const marks = [mark('a', 'P'), mark('b', 'Q'), mark('c', 'Q')];
    expect(marksForPanels(marks, ['a', 'c']).map((m) => m.panelId)).toEqual(['a', 'c']);
    expect(marksForProject(marks, 'Q').map((m) => m.panelId)).toEqual(['b', 'c']);
    expect(marksForProjects(marks, ['P', 'Q'])).toHaveLength(3);
  });

  it('badgeSummary counts every mark, labels "9+" above 9 (FR-039), and is null at zero', () => {
    expect(badgeSummary([])).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => mark(`p${i}`, 'P'));
    expect(badgeSummary(nine)).toEqual({ count: 9, label: '9', kind: 'attention' });
    const ten = [...nine, mark('z', 'Q', { kind: 'failed' })];
    expect(badgeSummary(ten)).toEqual({ count: 10, label: '9+', kind: 'failed' });
  });

  it('reasonLabel names each signal', () => {
    expect(reasonLabel({ signal: 'bell', detail: null })).toBe('Wants your attention'); // FR-101
    expect(reasonLabel({ signal: 'processExited', detail: '1' })).toBe('Process exited');
    expect(reasonLabel({ signal: 'commandFinished', detail: 'npm test' })).toBe('Command finished');
    expect(reasonLabel({ signal: 'notification', detail: 'x' })).toBe('Notification');
    expect(reasonLabel({ signal: 'progressEnded', detail: null })).toBe('Progress ended');
    expect(reasonLabel({ signal: 'unseenOutput', detail: null })).toBe('Unseen output');
    expect(reasonLabel({ signal: 'outputQuiet', detail: null })).toBe('Output went quiet');
  });

  it('tooltipLines: one line per panel, "<Panel> — <project>: <reason>[ \'<detail>\'] (<Kind>)" (FR-015)', () => {
    const marks = [
      mark('a', 'P'),
      mark('b', 'Q', { kind: 'failed', reason: { signal: 'processExited', detail: '2' } }),
    ];
    expect(tooltipLines(marks)).toEqual([
      'Panel a — Project P: Wants your attention (Attention)',
      "Panel b — Project Q: Process exited '2' (Failed)",
    ]);
    expect(holderLabel(marks)).toBe(
      "Panel a — Project P: Wants your attention (Attention). Panel b — Project Q: Process exited '2' (Failed)",
    );
  });
});


// FR-117: one line under the panel's title — the program's own message, "<command> has finished", or
// "Wants your attention" — and nothing appended to it.
describe('notificationText (FR-117)', () => {
  it('is "Wants your attention" for a bell, whatever the terminal was doing', () => {
    expect(notificationText(mark('p', 'A', { doing: 'npm run build' }))).toBe('Wants your attention');
  });

  it('is the message a program sent, alone', () => {
    const sent = mark('p', 'A', { reason: { signal: 'notification', detail: 'Claude is waiting for your input' }, doing: 'Fix the login bug' });
    expect(notificationText(sent)).toBe('Claude is waiting for your input');
  });

  it('is "<command> has finished" for a finished command', () => {
    const finished = mark('p', 'A', { reason: { signal: 'commandFinished', detail: 'npm test' }, doing: 'npm test' });
    expect(notificationText(finished)).toBe('npm test has finished');
  });

  it('falls back to "Wants your attention" when a signal carried nothing to say', () => {
    expect(notificationText(mark('p', 'A', { reason: { signal: 'notification', detail: null } }))).toBe('Wants your attention');
    expect(notificationText(mark('p', 'A', { reason: { signal: 'commandFinished', detail: '' } }))).toBe('Wants your attention');
  });

  it('says what failed for a Failed mark, and nothing more', () => {
    const exited = mark('p', 'A', { kind: 'failed', reason: { signal: 'processExited', detail: '1' }, doing: 'npm run build' });
    expect(notificationText(exited)).toBe("Process exited '1'");
  });
});

describe('describeMark (FR-102)', () => {
  it('is the reason, then what the terminal was doing', () => {
    expect(describeMark(mark('p', 'A', { doing: 'Fix the login bug' }))).toBe('Wants your attention — Fix the login bug');
  });

  it('is the reason alone when nothing is known of what it was doing', () => {
    expect(describeMark(mark('p', 'A'))).toBe('Wants your attention');
  });

  it('does not repeat what the reason already names — a finished command is its own description', () => {
    const finished = mark('p', 'A', { reason: { signal: 'commandFinished', detail: 'npm test' }, doing: 'npm test' });
    expect(describeMark(finished)).toBe("Command finished 'npm test'");
  });

  it('names the command an exit ended', () => {
    const exited = mark('p', 'A', { kind: 'failed', reason: { signal: 'processExited', detail: '1' }, doing: 'npm run build' });
    expect(describeMark(exited)).toBe("Process exited '1' — npm run build");
  });
});

describe('holder counts (057 round 12, FR-131)', () => {
  const marks = [mark('a', 'P'), mark('b', 'P'), mark('c', 'Q'), mark('d', 'R')];

  it('counts the marked panels beneath each holder', () => {
    expect(holderCount(marks, ['a', 'b', 'x'])).toBe(2);
    expect(projectCount(marks, 'P')).toBe(2);
    expect(categoryCount(marks, ['P', 'Q'])).toBe(3);
    expect(categoryCount(marks, ['Z'])).toBe(0);
  });

  it('labels a count, nine and above nine as 9+', () => {
    expect(markCountLabel(1)).toBe('1');
    expect(markCountLabel(9)).toBe('9');
    expect(markCountLabel(10)).toBe('9+');
  });

  it('names the Flag reason Flagged (FR-125)', () => {
    expect(reasonLabel({ signal: 'flagged', detail: null })).toBe('Flagged');
  });
});
