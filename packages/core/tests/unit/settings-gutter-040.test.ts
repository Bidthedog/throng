/**
 * `editor.showGutter` — the key, its default, and the descriptor that puts it on the form
 * (040 US4 — FR-040, FR-050).
 *
 * ══ WHY THE UNIT TIER ══
 *
 * Every claim here is a fact about two pure registries — `DEFAULT_APP_SETTINGS` and
 * `SETTINGS_METADATA`. A key exists, a default is `true`, a descriptor names a group and declines a
 * subgroup, a sentence was written by a person. None of it needs a DOM.
 *
 * And it must NOT need one: the `unit` project is `environment: 'node'` and does not load the
 * component setup file, so a render assertion added here would run in no project at all — green by
 * never executing. FR-053's half of this setting is `packages/ui/tests/component/gutter-setting-row.test.ts`,
 * at the component tier, where a real form is rendered.
 *
 * ══ THE ONE THING WORTH SAYING ABOUT THE SUBGROUP ══
 *
 * `editor.showGutter` is NOT a status-bar setting, and the absence of a subgroup is the assertion
 * that says so. 040 added `subgroup` for the three `Editor → Status Bar` settings, and the tempting
 * mistake while that mechanism is fresh is to reach for it again — which would file the gutter
 * toggle under a heading it has nothing to do with. `settings-metadata-040.test.ts` guards the
 * converse (no OTHER Editor setting acquires a subgroup); this guards this one.
 */
import { describe, it, expect } from 'vitest';
import { SETTINGS_METADATA, settingsLeaves } from '../../src/config/settings-metadata.js';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import type { FieldDescriptor } from '../../src/config/metadata.js';

const KEY = 'editor.showGutter';

const descriptor = (key: string): FieldDescriptor => {
  const found = SETTINGS_METADATA.find((d) => d.key === key);
  expect(found, `no descriptor for ${key}`).toBeDefined();
  return found as FieldDescriptor;
};

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-040 — the key exists, is boolean, and ships ON
 * ────────────────────────────────────────────────────────────────────────── */

describe('editor.showGutter exists and ships on (FR-040)', () => {
  it('is a boolean defaulting to true', () => {
    // Shipped ON: the gutter is what every editor in this class draws by default, and a preference
    // that reclaims width is opt-IN. Shipping it off would change what today's users see on upgrade
    // without anyone asking.
    expect(DEFAULT_APP_SETTINGS.editor.showGutter).toBe(true);
    expect(typeof DEFAULT_APP_SETTINGS.editor.showGutter).toBe('boolean');
  });

  it('counts as a configurable leaf, not internal bookkeeping', () => {
    expect(settingsLeaves()).toContain(KEY);
  });

  it('survives the parse path — a stored false comes back false', () => {
    /*
     * THE SILENT-DROP GUARD, and the reason this test is worth more than the two above it.
     *
     * `editorSettings` reads each field into a local and then returns an explicit, HAND-LISTED
     * object literal. A field added to the interface and to the local but not to the literal
     * compiles, ships, and is dropped on every read — the user's `false` reads back as the default
     * `true`, and nothing anywhere says so. Asserting the DEFAULT alone cannot see it: the default
     * is what a dropped field falls back to.
     */
    expect(parseAppSettings({ editor: { showGutter: false } }).editor.showGutter).toBe(false);
    expect(parseAppSettings({ editor: { showGutter: true } }).editor.showGutter).toBe(true);
  });

  it('falls back to the default for a non-boolean, rather than trusting it', () => {
    // The tolerant-per-field shape the rest of the section uses: a bad leaf takes its own default
    // and the document still loads (FR-051's neighbour).
    expect(parseAppSettings({ editor: { showGutter: 'yes' } }).editor.showGutter).toBe(true);
    expect(parseAppSettings({ editor: {} }).editor.showGutter).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-040 / FR-050 — a descriptor, under Editor, with no subgroup
 * ────────────────────────────────────────────────────────────────────────── */

describe('it is described as a plain Editor toggle (FR-040, FR-050)', () => {
  it('is a toggle so the visual editor can reach it', () => {
    expect(descriptor(KEY).control).toBe('toggle');
  });

  it('sits under Editor — not under one of the sibling-string Editor groups', () => {
    expect(descriptor(KEY).group).toBe('Editor');
  });

  it('declares NO subgroup: it is not a status-bar setting', () => {
    expect(descriptor(KEY).subgroup).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-040 — the copy is hand-written, and says what the setting does
 * ────────────────────────────────────────────────────────────────────────── */

describe('the label and description were written by a person (FR-040)', () => {
  it('carries a label that names the gutter', () => {
    const label = descriptor(KEY).label;
    expect(label.length).toBeGreaterThan(0);
    // Not a key echoed back: `showGutter` or `editor.showGutter` as a label is the tell of a
    // descriptor added to satisfy the completeness gate rather than to be read.
    expect(label).not.toBe(KEY);
    expect(label).not.toMatch(/showGutter/);
    expect(label.toLowerCase()).toContain('gutter');
  });

  it('describes what the gutter IS and what hiding it buys', () => {
    const text = descriptor(KEY).description;
    expect(text.length).toBeGreaterThan(0);
    const lower = text.toLowerCase();
    // The user needs to know which strip of the panel this is — "gutter" alone is jargon.
    expect(lower, 'name what the gutter shows').toContain('line number');
    // …and why they might turn it off. FR-041's whole point is that the width comes back to the text.
    expect(lower, 'say the width is reclaimed').toMatch(/width|space|room|reclaim/);
  });

  it('says nothing about the status bar — it is a different setting on a different row', () => {
    expect(descriptor(KEY).description.toLowerCase()).not.toContain('status bar');
  });
});
