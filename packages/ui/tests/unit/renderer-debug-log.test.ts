import { describe, expect, it } from 'vitest';
import {
  RENDERER_DEBUG_LOG_CHANNEL,
  registerRendererDebugLogIpc,
} from '../../src/main/renderer-debug-log.js';

/** #290/#162 — the renderer's terminal debug lines reaching main.log. */
function wire() {
  const lines: string[] = [];
  let listener: ((event: unknown, payload: unknown) => void) | undefined;
  registerRendererDebugLogIpc(
    { debug: (message) => lines.push(message) },
    {
      on: (channel, fn) => {
        if (channel === RENDERER_DEBUG_LOG_CHANNEL) listener = fn;
      },
    },
  );
  return { lines, send: (payload: unknown) => listener?.(undefined, payload) };
}

describe('registerRendererDebugLogIpc', () => {
  it('writes a line at debug, marked as the renderer', () => {
    const { lines, send } = wire();
    send('panel=p1 event=wheel route="program"');
    expect(lines).toEqual(['[renderer-terminal] panel=p1 event=wheel route="program"']);
  });

  it('keeps one send to one line', () => {
    const { lines, send } = wire();
    send('a\r\nb\nc');
    expect(lines).toEqual(['[renderer-terminal] a b c']);
  });

  it('ignores a payload that is not a string, and bounds a long one', () => {
    const { lines, send } = wire();
    send({ not: 'a string' });
    send('');
    send('x'.repeat(10_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThan(4100);
  });
});
