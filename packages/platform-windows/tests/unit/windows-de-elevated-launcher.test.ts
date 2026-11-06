import { describe, it, expect } from 'vitest';
import { buildLaunchScript, deElevatedCommandLine } from '../../src/windows-de-elevated-launcher.js';

/**
 * 066 FR-017 / contract *PTY agent* — the de-elevated launch passes NO environment, so the agent's log
 * folder is an argument (`pty-agent-entry.js <pipe> <logDir>`). It must survive the trip intact: into
 * the shim's script and out again as the agent's command line, `appdata:<rel>` exactly as encoded and a
 * path with spaces as ONE argument.
 */

const NODE = 'C:\\Program Files\\throng\\node.exe';
const ENTRY = 'C:\\Program Files\\throng\\pty-agent-entry.js';
const PIPE = '\\\\.\\pipe\\throng.ptyagent.1.abc';

describe('deElevatedCommandLine', () => {
  it('carries an appdata: log folder argument as is', () => {
    expect(deElevatedCommandLine(NODE, [ENTRY, PIPE, 'appdata:throng\\logs'])).toBe(
      `"${NODE}" "${ENTRY}" ${PIPE} appdata:throng\\logs`,
    );
  });

  it('keeps an absolute log folder with spaces as one argument', () => {
    expect(deElevatedCommandLine(NODE, [ENTRY, PIPE, 'D:\\My Logs\\throng'])).toBe(
      `"${NODE}" "${ENTRY}" ${PIPE} "D:\\My Logs\\throng"`,
    );
  });

  it('escapes an embedded quote', () => {
    expect(deElevatedCommandLine('a', ['say "hi"'])).toBe('a "say \\"hi\\""');
  });
});

describe('buildLaunchScript', () => {
  it('hands the shim the agent command line, log folder argument included', () => {
    const script = buildLaunchScript(NODE, [ENTRY, PIPE, 'appdata:throng\\logs'], 'C:\\Windows');
    // A PowerShell single-quoted literal: no escaping beyond doubled single quotes.
    expect(script).toContain(`$cmdLine = '"${NODE}" "${ENTRY}" ${PIPE} appdata:throng\\logs'`);
  });
});
