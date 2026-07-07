import { describe, it, expect } from 'vitest';
import {
  canRunAsAdmin,
  shouldRespawnDaemonElevated,
  shouldDeElevate,
  passthroughDeElevator,
  terminalPanelType,
  type FlavourOption,
  type PanelTypeContext,
  type IElevationState,
  type IDeElevator,
} from '@throng/core';
import { runElevationContract, runDeElevatorContract } from '@throng/core/testing';

const FLAVOURS: FlavourOption[] = [
  { value: 'pwsh', label: 'PowerShell 7', defaultParams: '-NoLogo' },
];
const ctx = (o: Partial<PanelTypeContext> = {}): PanelTypeContext => ({
  projectRoot: 'C:/proj',
  flavours: FLAVOURS,
  ...o,
});

describe('canRunAsAdmin (gate: admin allowed iff the daemon is elevated, FR-025a)', () => {
  it('is false when the daemon is not elevated', () => {
    expect(canRunAsAdmin(false)).toBe(false);
  });
  it('is true when the daemon is elevated', () => {
    expect(canRunAsAdmin(true)).toBe(true);
  });
});

describe('shouldRespawnDaemonElevated (FR-025b truth table)', () => {
  it('respawns only when the app is elevated but the daemon is not', () => {
    expect(shouldRespawnDaemonElevated(true, false)).toBe(true);
    expect(shouldRespawnDaemonElevated(true, true)).toBe(false);
    expect(shouldRespawnDaemonElevated(false, false)).toBe(false);
    expect(shouldRespawnDaemonElevated(false, true)).toBe(false);
  });
});

describe('shouldDeElevate (FR-025c truth table — mixed mode)', () => {
  it('de-elevates only an unchecked terminal on an elevated host', () => {
    expect(shouldDeElevate(false, true)).toBe(true); // unchecked + elevated → drop
    expect(shouldDeElevate(true, true)).toBe(false); // admin requested → stay elevated
    expect(shouldDeElevate(false, false)).toBe(false); // nothing to drop
    expect(shouldDeElevate(true, false)).toBe(false);
  });
});

describe('IDeElevator contract suite (runDeElevatorContract)', () => {
  it('accepts the passthrough de-elevator (unavailable → wraps nothing)', () => {
    expect(() => runDeElevatorContract(() => passthroughDeElevator)).not.toThrow();
    expect(passthroughDeElevator.isAvailable()).toBe(false);
    expect(passthroughDeElevator.wrap({ file: 'cmd.exe', args: ['/K'] })).toEqual({
      file: 'cmd.exe',
      args: ['/K'],
    });
  });
  it('accepts a compliant available fake (returns a structurally valid spec)', () => {
    const shim: IDeElevator = {
      isAvailable: () => true,
      wrap: ({ file, args }) => ({ file: 'deelevate.exe', args: ['--', file, ...args] }),
    };
    expect(() => runDeElevatorContract(() => shim)).not.toThrow();
  });
  it('rejects a wrap that returns an invalid spec (empty file)', () => {
    const bad: IDeElevator = {
      isAvailable: () => true,
      wrap: () => ({ file: '', args: [] }),
    };
    expect(() => runDeElevatorContract(() => bad)).toThrow();
  });
});

describe('Terminal descriptor — runAsAdmin (FR-025)', () => {
  it("defaults runAsAdmin to the string 'false'", () => {
    expect(terminalPanelType.defaults(ctx()).runAsAdmin).toBe('false');
  });
  it("captures runAsAdmin: true when the form value is 'true'", () => {
    const config = terminalPanelType.buildConfig(
      { flavourId: 'pwsh', params: '-NoLogo', runAsAdmin: 'true' },
      ctx(),
    );
    expect(config.runAsAdmin).toBe(true);
  });
  it("captures runAsAdmin: false when the form value is 'false'", () => {
    expect(
      terminalPanelType.buildConfig({ flavourId: 'pwsh', params: '', runAsAdmin: 'false' }, ctx())
        .runAsAdmin,
    ).toBe(false);
  });
});

describe('IElevationState contract suite (runElevationContract)', () => {
  it('accepts a compliant fake (stable boolean)', () => {
    const compliant: IElevationState = { isElevated: () => false };
    expect(() => runElevationContract(() => compliant)).not.toThrow();
  });
  it('rejects a fake whose isElevated flips between calls (unstable)', () => {
    let n = 0;
    const flipping: IElevationState = { isElevated: () => ++n % 2 === 0 };
    expect(() => runElevationContract(() => flipping)).toThrow();
  });
  it('rejects a fake whose isElevated is not a boolean', () => {
    const bad = { isElevated: () => 1 as unknown as boolean };
    expect(() => runElevationContract(() => bad)).toThrow();
  });
});
