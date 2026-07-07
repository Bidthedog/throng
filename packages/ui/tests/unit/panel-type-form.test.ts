import { describe, it, expect } from 'vitest';
import {
  createPanelTypeRegistry,
  terminalPanelType,
  type FlavourOption,
  type PanelTypeContext,
} from '@throng/core';
import {
  initialFormState,
  selectKind,
  setValue,
  clearForm,
  canConfirm,
  confirmConfig,
  type FormDeps,
} from '../../src/renderer/panel-type/form-state.js';

const FLAVOURS: FlavourOption[] = [
  { value: 'pwsh', label: 'PowerShell 7', defaultParams: '-NoLogo' },
  { value: 'bash', label: 'Git Bash', defaultParams: '-i -l' },
];

function deps(overrides: Partial<PanelTypeContext> = {}): FormDeps {
  const registry = createPanelTypeRegistry();
  registry.register(terminalPanelType);
  return { registry, ctx: { projectRoot: 'C:/proj', flavours: FLAVOURS, ...overrides } };
}

describe('panel-type form reducer', () => {
  it('starts with no type selected and Confirm disabled', () => {
    const d = deps();
    const s = initialFormState();
    expect(s.selectedKind).toBeNull();
    expect(canConfirm(s, d)).toBe(false);
    expect(confirmConfig(s, d)).toBeNull();
  });

  it('selecting Terminal seeds the descriptor defaults and enables Confirm', () => {
    const d = deps();
    const s = selectKind(initialFormState(), 'terminal', d);
    expect(s.selectedKind).toBe('terminal');
    expect(s.values).toEqual({ flavourId: 'pwsh', params: '-NoLogo', runAsAdmin: 'false' });
    expect(canConfirm(s, d)).toBe(true);
  });

  it('confirmConfig returns the assigned kind + built config when valid', () => {
    const d = deps();
    const s = selectKind(initialFormState(), 'terminal', d);
    expect(confirmConfig(s, d)).toEqual({
      kind: 'terminal',
      config: { flavourId: 'pwsh', flavourLabel: 'PowerShell 7', params: '-NoLogo', runAsAdmin: false },
    });
  });

  it('clearing an empty required value disables Confirm', () => {
    const d = deps();
    let s = selectKind(initialFormState(), 'terminal', d);
    s = setValue(s, 'flavourId', '');
    expect(canConfirm(s, d)).toBe(false);
    expect(confirmConfig(s, d)).toBeNull();
  });

  it('editing Startup Params is captured in the built config', () => {
    const d = deps();
    let s = selectKind(initialFormState(), 'terminal', d);
    s = setValue(s, 'params', '-NoLogo -NoProfile');
    expect(confirmConfig(s, d)).toEqual({
      kind: 'terminal',
      config: {
        flavourId: 'pwsh',
        flavourLabel: 'PowerShell 7',
        params: '-NoLogo -NoProfile',
        runAsAdmin: false,
      },
    });
  });

  it('Clear resets the type selection and inputs to the initial empty state', () => {
    const d = deps();
    let s = selectKind(initialFormState(), 'terminal', d);
    s = clearForm();
    expect(s.selectedKind).toBeNull();
    expect(s.values).toEqual({});
    expect(canConfirm(s, d)).toBe(false);
  });

  it('Confirm stays disabled with no active project root (no-project edge)', () => {
    const d = deps({ projectRoot: null });
    const s = selectKind(initialFormState(), 'terminal', d);
    expect(canConfirm(s, d)).toBe(false);
  });

  it('ignores selecting an unknown panel type', () => {
    const d = deps();
    const s = selectKind(initialFormState(), 'nope', d);
    expect(s.selectedKind).toBeNull();
    expect(canConfirm(s, d)).toBe(false);
  });
});
