import { describe, it, expect } from 'vitest';
import { runDeElevatorContract } from '@throng/core/testing';
import { WindowsDeElevator } from '@throng/platform-windows';

describe('WindowsDeElevator', () => {
  it('satisfies the IDeElevator contract (wrap preserves the original launch)', () => {
    runDeElevatorContract(() => new WindowsDeElevator());
  });

  it('wraps a launch through a PowerShell host carrying an encoded de-elevation script', () => {
    const wrapped = new WindowsDeElevator().wrap({ file: 'C:\\Windows\\System32\\cmd.exe', args: ['/K'] });
    expect(wrapped.file.toLowerCase()).toContain('powershell.exe');
    expect(wrapped.args).toContain('-EncodedCommand');
    // The encoded script must embed the original target so the shim runs the real
    // shell (decode the base64/UTF-16LE payload and check).
    const idx = wrapped.args.indexOf('-EncodedCommand');
    const decoded = Buffer.from(wrapped.args[idx + 1], 'base64').toString('utf16le');
    expect(decoded).toContain('cmd.exe');
    expect(decoded).toContain('CreateProcessWithTokenW');
    // The behavioural obligation (the child actually runs at medium integrity) is
    // exercised only on an elevated host via the `terminal-admin-integrity` E2E
    // (`npm run test:e2e:admin`) — never a silent pass here.
  });
});
