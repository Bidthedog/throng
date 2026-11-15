import { describe, expect, it } from 'vitest';
import type { IProcessIdentity } from '@throng/core';
import { ClaudeSessionResolver } from '../../src/claude-session-resolver.js';

/** 070 research R32: the resolver's `os` was `windows | linux`, so a Mac was routed through one or the other. */
const SESSION = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const record = (body: object) => (): Promise<string> => Promise.resolve(JSON.stringify(body));

describe('ClaudeSessionResolver on macOS', () => {
  it('takes argv from the process identity, never from splitting a Windows command line', async () => {
    const identity: IProcessIdentity = { argv: async () => undefined, startMarker: async () => undefined };
    const resolver = new ClaudeSessionResolver({
      configDir: '/Users/dev/.claude',
      os: 'macos',
      identity,
      timeoutMs: 2000,
      readFile: record({ pid: 9, sessionId: SESSION, startedAt: 1_700_000_000_000 }),
    });
    expect(await resolver.resolve({ pid: 9, startedAt: 1_700_000_000_000, commandLine: '"/opt/claude" --x' }, [])).toEqual({
      none: 'unreadable',
    });
  });

  it('identifies the session from argv and the recorded start time when the platform has no tick marker', async () => {
    const identity: IProcessIdentity = { argv: async () => ['/opt/homebrew/bin/claude', '--add-dir', '/Users/dev/My Dir'], startMarker: async () => undefined };
    const resolver = new ClaudeSessionResolver({
      configDir: '/Users/dev/.claude',
      os: 'macos',
      identity,
      timeoutMs: 2000,
      readFile: record({ pid: 9, sessionId: SESSION, startedAt: 1_700_000_000_000 }),
    });
    expect(await resolver.resolve({ pid: 9, startedAt: 1_700_000_000_300, commandLine: 'claude' }, [])).toEqual({
      sessionId: SESSION,
      argv: ['/opt/homebrew/bin/claude', '--add-dir', '/Users/dev/My Dir'],
    });
  });
});
