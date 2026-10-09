import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 051 FR-013a — the end limit is ONE constant, and the composition root is what hands it to the
 * terminal service (Principle IX). Read from source rather than by building the container: the
 * container loads node-pty and koffi, which is an integration concern, and the claim here is only
 * that the wiring names the constant rather than a second literal.
 */
const source = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('051 FR-013a — the end limit reaches the terminal service from the one constant', () => {
  it('the composition root passes TERMINAL_END_TIMEOUT_MS to TerminalService', () => {
    const root = source('../../src/composition-root.ts');
    const construction = root.slice(root.indexOf('new TerminalService('));
    const args = construction.slice(0, construction.indexOf(');'));
    expect(args).toContain('TERMINAL_END_TIMEOUT_MS');
  });

  it('no daemon or platform source hard-codes a 5000 ms process-request limit beside it', () => {
    for (const file of [
      '../../src/pty-agent-host.ts',
      '../../../platform-windows/src/node-pty-host.ts',
    ]) {
      expect(source(file), file).not.toMatch(/timeout:\s*5000|},\s*5000\)/);
    }
  });
});
