import { logCaught } from '@throng/core';
import { RPC_MAX_LINE_CHARS } from '@throng/ipc-contract';
import type { DaemonClient } from './daemon-client.js';

/**
 * The most characters one `terminal.write` carries. JSON escaping grows a control character six-fold
 * (`\u0001`), so this many always fits the daemon's request-line limit with room for the envelope.
 */
const TERMINAL_WRITE_CHUNK_CHARS = Math.floor((RPC_MAX_LINE_CHARS - 4_096) / 6);

/**
 * Deliver what a terminal view typed or pasted to its session in the daemon. A failure is logged
 * and answered `{ ok: false }`, never thrown: the view's next keystroke must still go through.
 *
 * A paste larger than one request line is sent as consecutive writes, in order, stopping at the
 * first that fails: the daemon closes a connection whose line passes `RPC_MAX_LINE_CHARS`, so a
 * megabyte pasted as one write never reached the shell.
 */
export async function writeToTerminal(
  daemonClient: Pick<DaemonClient, 'call'>,
  panelId: string,
  data: string,
  answerFrom?: string,
): Promise<unknown> {
  let result: unknown = { ok: true };
  for (const part of chunks(data)) {
    result = await daemonClient.call('terminal.write', { panelId, data: part, answerFrom }).catch((error: unknown) => {
      logCaught('terminal-ipc: write', error);
      return { ok: false };
    });
    if (isFailed(result)) return result;
  }
  return result;
}

function isFailed(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === false;
}

/** `data` cut into pieces of at most `TERMINAL_WRITE_CHUNK_CHARS`, never between a surrogate pair. */
function chunks(data: string): string[] {
  if (data.length <= TERMINAL_WRITE_CHUNK_CHARS) return [data];
  const parts: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + TERMINAL_WRITE_CHUNK_CHARS, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(data.slice(start, end));
    start = end;
  }
  return parts;
}
