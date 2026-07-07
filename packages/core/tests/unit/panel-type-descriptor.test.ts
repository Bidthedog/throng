import { describe, it, expect } from 'vitest';
import {
  terminalPanelType,
  type FlavourOption,
  type PanelTypeContext,
} from '@throng/core';

const FLAVOURS: FlavourOption[] = [
  { value: 'pwsh', label: 'PowerShell 7', defaultParams: '-NoLogo' },
  { value: 'bash', label: 'Git Bash', defaultParams: '-i -l' },
];

function ctx(overrides: Partial<PanelTypeContext> = {}): PanelTypeContext {
  return { projectRoot: 'C:/proj', flavours: FLAVOURS, ...overrides };
}

describe('Terminal descriptor — metadata', () => {
  it('declares the Flavour dropdown and Startup Params inputs', () => {
    expect(terminalPanelType.id).toBe('terminal');
    expect(terminalPanelType.label).toBe('Terminal');
    const keys = terminalPanelType.inputs.map((i) => i.key);
    expect(keys).toEqual(['flavourId', 'params']);
    const flavour = terminalPanelType.inputs.find((i) => i.key === 'flavourId')!;
    expect(flavour.control).toBe('dropdown');
    expect(flavour.options!(ctx())).toEqual([
      { value: 'pwsh', label: 'PowerShell 7' },
      { value: 'bash', label: 'Git Bash' },
    ]);
  });
});

describe('Terminal descriptor — defaults', () => {
  it('seeds the first flavour and its default params', () => {
    expect(terminalPanelType.defaults(ctx())).toEqual({
      flavourId: 'pwsh',
      params: '-NoLogo',
      runAsAdmin: 'false',
    });
  });

  it('seeds empty values when no flavours are available', () => {
    expect(terminalPanelType.defaults(ctx({ flavours: [] }))).toEqual({
      flavourId: '',
      params: '',
      runAsAdmin: 'false',
    });
  });
});

describe('Terminal descriptor — validate (gates Confirm, FR-005)', () => {
  it('is ok for a known flavour with an active project root', () => {
    expect(terminalPanelType.validate({ flavourId: 'pwsh', params: '-NoLogo' }, ctx())).toEqual({
      ok: true,
    });
  });

  it('rejects when no flavour is selected', () => {
    const r = terminalPanelType.validate({ flavourId: '', params: '' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.flavourId).toBeTruthy();
  });

  it('rejects an unknown/unavailable flavour (FR-019 restore edge)', () => {
    const r = terminalPanelType.validate({ flavourId: 'ghost', params: '' }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.flavourId).toBeTruthy();
  });

  it('rejects when there is no active project root (no-project edge)', () => {
    const r = terminalPanelType.validate({ flavourId: 'pwsh', params: '-NoLogo' }, ctx({ projectRoot: null }));
    expect(r.ok).toBe(false);
  });

  it('is ok with a null root when the Panel is rootless (sub-workspace-owned → home dir)', () => {
    // A Panel created inside a sub-workspace has no owning project; its terminal
    // launches at the user's default home directory, so a null root is allowed
    // when `rootless` is set (FR-028).
    const r = terminalPanelType.validate(
      { flavourId: 'pwsh', params: '-NoLogo' },
      ctx({ projectRoot: null, rootless: true }),
    );
    expect(r.ok).toBe(true);
  });

  it('still requires a chosen flavour even when rootless', () => {
    const r = terminalPanelType.validate(
      { flavourId: '', params: '' },
      ctx({ projectRoot: null, rootless: true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.flavourId).toBeTruthy();
  });
});

describe('Terminal descriptor — buildConfig', () => {
  it('captures the chosen flavour and edited params', () => {
    expect(
      terminalPanelType.buildConfig({ flavourId: 'pwsh', params: '-NoLogo -X', runAsAdmin: 'false' }, ctx()),
    ).toEqual({
      flavourId: 'pwsh',
      flavourLabel: 'PowerShell 7',
      params: '-NoLogo -X',
      runAsAdmin: false,
    });
  });
});
