import { describe, it, expect } from 'vitest';
import { terminalExitNotice } from '@throng/core';

/**
 * 025 FR-041b — a failure notice has to say WHICH terminal failed.
 *
 * Reported from real use. The notice is raised after the Panel has already reverted to its
 * type-selection form, so nothing on screen still identifies the terminal; with four open,
 * "Terminal exited (code 1)" is unactionable at exactly the moment it matters.
 */
const FULL = {
  projectName: 'throng',
  tabName: 'Build',
  panelName: 'Panel 2',
  flavourLabel: 'Command Prompt',
};

describe('the terminal exit notice (025 FR-041b)', () => {
  it('names the project, tab, panel and flavour alongside the code', () => {
    const msg = terminalExitNotice(1, FULL);
    expect(msg).toContain('code 1');
    for (const part of ['throng', 'Build', 'Panel 2', 'Command Prompt']) {
      expect(msg, `the notice does not say which terminal: "${part}" is missing`).toContain(part);
    }
  });

  it('reads as one line, project first', () => {
    expect(terminalExitNotice(1, FULL)).toBe(
      'Terminal exited (code 1) — throng › Build › Panel 2 (Command Prompt)',
    );
  });

  it('drops what it does not know rather than printing a blank or "undefined"', () => {
    // A rootless Panel has no project; a Panel may never have been named.
    const msg = terminalExitNotice(3, { panelName: 'Panel 1', flavourLabel: 'Git Bash' });
    expect(msg).toBe('Terminal exited (code 3) — Panel 1 (Git Bash)');
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('›');
  });

  it('degrades to the bare message when nothing is known', () => {
    expect(terminalExitNotice(2)).toBe('Terminal exited (code 2)');
    expect(terminalExitNotice(2, { projectName: '  ' })).toBe('Terminal exited (code 2)');
  });

  it('still renders a code that could not be read', () => {
    // FR-041b: an unreadable code surfaces rather than being hidden.
    expect(terminalExitNotice(null, { panelName: 'Panel 1' })).toContain('code —');
  });
});
