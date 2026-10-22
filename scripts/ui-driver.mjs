// The node side of the UI Automation helper (scripts/ui-automation.ps1) for the hand-test driver.
// `uiArgs` is the pure half (the command line for one request); the rest runs the helper.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(new URL('./ui-automation.ps1', import.meta.url));

/**
 * @param {string} command
 * @param {{title?: string, processId?: number, name?: string, path?: string, timeoutSec?: number}} params
 */
export function uiArgs(command, params = {}) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Command', command];
  if (params.title !== undefined) args.push('-Title', params.title);
  if (params.processId !== undefined) args.push('-ProcessId', String(params.processId));
  if (params.name !== undefined) args.push('-Name', params.name);
  if (params.path !== undefined) args.push('-Path', params.path);
  if (params.timeoutSec !== undefined) args.push('-TimeoutSec', String(params.timeoutSec));
  return args;
}

/** Run one request; never throws. `{ok: false, error}` when the helper failed or said so. */
export function ui(command, params = {}) {
  const timeout = ((params.timeoutSec ?? 30) + 30) * 1000;
  const r = spawnSync('powershell.exe', uiArgs(command, params), { encoding: 'utf8', timeout, windowsHide: true });
  const last = String(r.stdout ?? '').trim().split(/\r?\n/).pop() ?? '';
  try {
    return JSON.parse(last);
  } catch {
    return { ok: false, error: `the UI helper gave no answer (exit ${r.status}): ${String(r.stderr ?? r.stdout ?? '').slice(0, 300)}` };
  }
}

/** A full-screen PNG; the path is returned either way, with `ok` saying whether it exists. */
export function screenshot(dir, label) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${label.replace(/[^\w.-]+/g, '-')}.png`);
  mkdirSync(dirname(path), { recursive: true });
  return { path, ...ui('shot', { path, timeoutSec: 20 }) };
}

/** Wait for a window and return its text, or null. */
export function windowText(params) {
  const r = ui('text', { timeoutSec: 30, ...params });
  return r.ok ? r.text : null;
}

/** Click a button, retrying briefly: a page can still be repainting when it is first found. */
export async function clickButton(params, attempts = 3) {
  let last = { ok: false, error: 'not tried' };
  for (let i = 0; i < attempts; i++) {
    last = ui('click', { timeoutSec: 30, ...params });
    if (last.ok) return last;
    await delay(1500);
  }
  return last;
}
