import { describe, expect, it } from 'vitest';
import { isDevProcess } from '../../../../scripts/clear-dev-state-lib.mjs';

const ROOT = '/repo';

describe('which processes clear-dev-state may end (062 T035)', () => {
  it('takes the app, its daemon and its helpers', () => {
    expect(isDevProcess(['/repo/node_modules/electron/dist/electron', '--type=renderer'], ROOT)).toBe(true);
    expect(isDevProcess(['/usr/bin/node', '/repo/packages/daemon/dist/main.js'], ROOT)).toBe(true);
    expect(isDevProcess(['node', '/repo/packages/daemon/dist/pty-agent-entry.js'], ROOT)).toBe(true);
  });

  it('leaves work that merely names the repository', () => {
    expect(isDevProcess(['vim', '/repo/electron-builder.yml'], ROOT)).toBe(false);
    expect(isDevProcess(['bash', '-c', 'cat /repo/packages/ui/dist/main/main.js'], ROOT)).toBe(false);
    expect(isDevProcess(['/usr/bin/node', '/repo/node_modules/vitest/vitest.mjs'], ROOT)).toBe(false);
  });

  it('leaves a sibling folder and a worktree of this checkout', () => {
    expect(isDevProcess(['/usr/bin/node', '/repo-old/packages/daemon/dist/main.js'], ROOT)).toBe(false);
    expect(isDevProcess(['/usr/bin/node', '/repo/.claude/worktrees/x/packages/daemon/dist/main.js'], ROOT)).toBe(false);
  });

  it('leaves another Electron app', () => {
    expect(isDevProcess(['/opt/slack/electron', '/opt/slack/main.js'], ROOT)).toBe(false);
  });
});
