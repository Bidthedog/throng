import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  createPanelTypeRegistry,
  defaultPanelTypeRegistry,
  terminalPanelType,
  FIND_IN_FILES_KIND,
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
  { value: 'pwsh', label: 'PowerShell 7', defaultShellArguments: '-NoLogo' },
  { value: 'bash', label: 'Git Bash', defaultShellArguments: '-i -l' },
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

  /*
   * 039 FR-004 — `rememberCommand` seeds 'false' below, where it seeded 'true' before.
   *
   * These deps build a context with no `terminalDefaults`, so the descriptor falls back to the
   * SHIPPED preference, which is off (039 FR-002, restoring 025 FR-015). The change is the point
   * of #223, not a side effect of it: the real form passes the user's actual preferences.
   */
  it('selecting Terminal seeds the descriptor defaults and enables Confirm', () => {
    const d = deps();
    const s = selectKind(initialFormState(), 'terminal', d);
    expect(s.selectedKind).toBe('terminal');
    expect(s.values).toEqual({
      flavourId: 'pwsh',
      shellArguments: '-NoLogo',
      startupCommand: '',
      rememberCommand: 'false',
      rememberDirectory: 'true',
      runAsAdmin: 'false',
    });
    expect(canConfirm(s, d)).toBe(true);
  });

  it('confirmConfig returns the assigned kind + built config when valid', () => {
    const d = deps();
    const s = selectKind(initialFormState(), 'terminal', d);
    expect(confirmConfig(s, d)).toEqual({
      kind: 'terminal',
      config: {
        flavourId: 'pwsh',
        flavourLabel: 'PowerShell 7',
        shellArguments: '-NoLogo',
        startupCommand: '',
        rememberCommand: false,
        rememberDirectory: true,
        runAsAdmin: false,
      },
    });
  });

  it('clearing an empty required value disables Confirm', () => {
    const d = deps();
    let s = selectKind(initialFormState(), 'terminal', d);
    s = setValue(s, 'flavourId', '');
    expect(canConfirm(s, d)).toBe(false);
    expect(confirmConfig(s, d)).toBeNull();
  });

  it('editing Shell Arguments is captured in the built config', () => {
    const d = deps();
    let s = selectKind(initialFormState(), 'terminal', d);
    s = setValue(s, 'shellArguments', '-NoLogo -NoProfile');
    expect(confirmConfig(s, d)).toEqual({
      kind: 'terminal',
      config: {
        flavourId: 'pwsh',
        flavourLabel: 'PowerShell 7',
        shellArguments: '-NoLogo -NoProfile',
        startupCommand: '',
        rememberCommand: false,
        rememberDirectory: true,
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

/**
 * 043 FR-017 — Find in Files is registered, and the New Panel dialog never offers it.
 *
 * The dropdown is built in `panel-type-form.tsx`, which the unit project cannot render (node env,
 * no DOM), so the second assertion is a SOURCE guard — the idiom `icon-call-sites.test.ts` and
 * `panel-identity-key.test.ts` established for exactly this. It is the assertion that matters:
 * `listOfferable()` filtering correctly is worth nothing while the form still calls `list()`, and
 * that regression is an EDIT AWAY at all times, with nothing in the type system to catch it — both
 * methods return `PanelTypeDescriptor[]`.
 */
const FORM_SOURCE = fileURLToPath(
  new URL('../../src/renderer/panel-type/panel-type-form.tsx', import.meta.url),
);

describe('the New Panel dialog does not offer Find in Files (FR-017)', () => {
  it('the shared registry offers Terminal and Editor, and resolves — but does not offer — Find in Files', () => {
    const offered = defaultPanelTypeRegistry.listOfferable().map((d) => d.id);
    expect(offered).toEqual(['terminal', 'editor']);
    expect(offered).not.toContain(FIND_IN_FILES_KIND);
    // …and it is still registered, which is what gives the panel its header label and icon (R17).
    expect(defaultPanelTypeRegistry.get(FIND_IN_FILES_KIND)?.label).toBe('Find in Files');
  });

  it('the form sources its options from listOfferable(), never from list()', () => {
    const code = readFileSync(FORM_SOURCE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    expect(code).toMatch(/registry\.listOfferable\(\)/);
    expect(
      code,
      'the New Panel dropdown is built from registry.list(), so every registered type is offered — ' +
        'including the ones FR-017 says must not be',
    ).not.toMatch(/registry\.list\(\)/);
  });
});
