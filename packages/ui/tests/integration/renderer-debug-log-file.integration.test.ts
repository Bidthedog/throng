/**
 * #290/#162 — a renderer terminal debug line, from the channel to a real `logs/main.log`, assembled
 * as `main.ts` assembles it: `startUiDiagnostics` → `registerRendererDebugLogIpc(diagnostics.log)`.
 *
 * The lines exist to be collected from one workstation after `diagnostics.logLevel` is set to
 * `debug`, so both halves matter: present at `debug`, absent at the default `info`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogLevel } from '@throng/core';
import { startUiDiagnostics } from '../../src/main/diagnostics.js';
import {
  RENDERER_DEBUG_LOG_CHANNEL,
  registerRendererDebugLogIpc,
} from '../../src/main/renderer-debug-log.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function mainLogAfterSending(level: LogLevel, line: string): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-debuglog-'));
  dirs.push(userDataDir);
  const diagnostics = startUiDiagnostics({ userDataDir, version: 't', buildId: 't', level });
  let fire: ((event: unknown, payload: unknown) => void) | undefined;
  registerRendererDebugLogIpc(diagnostics.log, {
    on: (channel, listener) => {
      if (channel === RENDERER_DEBUG_LOG_CHANNEL) fire = listener;
    },
  });
  fire?.(undefined, line);
  // A control line at `info`, so an empty file cannot pass the absence case for the wrong reason.
  diagnostics.log.info('control');
  return readFileSync(join(diagnostics.logDir, 'main.log'), 'utf8');
}

describe('renderer terminal debug lines in main.log', () => {
  it('are written when diagnostics.logLevel is debug', () => {
    const text = mainLogAfterSending('debug', 'panel=p1 event=attach altScreen=true');
    expect(text).toContain('[renderer-terminal] panel=p1 event=attach altScreen=true');
    expect(text).toContain('DEBUG');
  });

  it('are not written at the default level', () => {
    const text = mainLogAfterSending('info', 'panel=p1 event=attach altScreen=true');
    expect(text).toContain('control');
    expect(text).not.toContain('[renderer-terminal]');
  });
});
