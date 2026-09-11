/**
 * The Find in Files panel type (043 FR-017, R17, data-model.md §4).
 *
 * The one thing worth stating plainly, because it looks like a contradiction: this type is
 * REGISTERED and NOT OFFERED. Registration is not what puts it in the New Panel dropdown — the form
 * filters on `listOfferable()` — it is what gives a panel of this kind a header label and an icon,
 * both of which `panel-placeholder.tsx` and `use-panel-display-names.ts` resolve through
 * `registry.get(panel.kind)`. Leaving the type unregistered would satisfy FR-017 by breaking the
 * panel header, which is a worse answer than the flag.
 */
import { describe, it, expect } from 'vitest';
import {
  FIND_IN_FILES_KIND,
  findInFilesPanelType,
} from '../../src/find-in-files/panel-type.js';
import { defaultPanelTypeRegistry } from '../../src/panel-type/default-registry.js';
import type { PanelTypeContext } from '../../src/panel-type/descriptor.js';

const withRoot: PanelTypeContext = { projectRoot: 'C:/proj', flavours: [] };
const rootless: PanelTypeContext = { projectRoot: null, flavours: [], rootless: true };
const noProject: PanelTypeContext = { projectRoot: null, flavours: [] };

describe('findInFilesPanelType descriptor', () => {
  it('has id "findInFiles", a human label, an icon token and no configuration inputs', () => {
    expect(findInFilesPanelType.id).toBe(FIND_IN_FILES_KIND);
    expect(FIND_IN_FILES_KIND).toBe('findInFiles');
    expect(findInFilesPanelType.label).toBe('Find in Files');
    expect(findInFilesPanelType.icon).toBe('findInFiles');
    expect(findInFilesPanelType.inputs).toEqual([]);
  });

  it('is registered but NOT offered (FR-017)', () => {
    expect(findInFilesPanelType.offered).toBe(false);
  });

  it('validates only with an open project — a search over nothing has no scope (FR-018)', () => {
    expect(findInFilesPanelType.validate({}, withRoot)).toEqual({ ok: true });
    expect(findInFilesPanelType.validate({}, noProject)).toEqual({ ok: false, errors: {} });
  });

  it('a rootless sub-workspace Panel is NOT a substitute for a project (FR-018)', () => {
    // The editor type accepts `rootless` because a sub-workspace can own a document. A search
    // cannot: FR-018 confines every scan to the ACTIVE PROJECT's tree, and a rootless Panel names
    // no tree to confine it to.
    expect(findInFilesPanelType.validate({}, rootless)).toEqual({ ok: false, errors: {} });
  });

  it('builds an empty config — the query is written by the panel, not by a form', () => {
    expect(findInFilesPanelType.buildConfig({}, withRoot)).toEqual({});
    expect(findInFilesPanelType.defaults(withRoot)).toEqual({});
  });
});

describe('registration in the shared registry', () => {
  it('get() resolves it, so a panel of this kind has a header label and icon (R17)', () => {
    expect(defaultPanelTypeRegistry.get(FIND_IN_FILES_KIND)).toBe(findInFilesPanelType);
  });

  it('list() includes it — list() stays EVERY registered type', () => {
    expect(defaultPanelTypeRegistry.list().map((d) => d.id)).toEqual([
      'terminal',
      'editor',
      'findInFiles',
    ]);
  });

  it('listOfferable() excludes it — the New Panel dialog never offers it (FR-017)', () => {
    expect(defaultPanelTypeRegistry.listOfferable().map((d) => d.id)).toEqual([
      'terminal',
      'editor',
    ]);
  });
});
