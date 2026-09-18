import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { DEFAULT_LINK_ACTIONS } from '../../src/links/default-action.js';

/**
 * 045 FR-061, FR-080c — the four descriptors' CONTENT.
 *
 * `settings-metadata.test.ts` is the completeness gate: it says every leaf has a descriptor and no
 * descriptor names a leaf that does not exist. It cannot say whether a descriptor tells the user
 * anything true. These cases carry the two pieces of descriptor text that a REQUIREMENT depends on:
 *
 *  - FR-039 and FR-052 are behaviours a user would otherwise report as a bug — a click on an `.exe`
 *    that reveals rather than runs, and a link with a line number that ignores their preference for
 *    previews. If the setting does not say so, the setting is wrong however the code behaves.
 *  - FR-080c requires the hyperlink-advertising switch to SAY that it applies to terminals started
 *    afterwards, because a toggle that silently does nothing to what is on screen reads as broken.
 */

const descriptor = (key: string) => {
  const found = SETTINGS_METADATA.find((d) => d.key === key);
  expect(found, `no descriptor for ${key}`).toBeDefined();
  return found!;
};

describe('editor.links.defaultAction (FR-050, FR-061)', () => {
  const d = () => descriptor('editor.links.defaultAction');

  it('is a select over FR-050’s values, in FR-050’s order', () => {
    expect(d().control).toBe('select');
    expect(d().allowedValues).toEqual([...DEFAULT_LINK_ACTIONS]);
  });

  it('labels the WHOLE set — all or none (metadata.ts:107-120)', () => {
    const labels = d().optionLabels;
    expect(labels).toBeDefined();
    expect(Object.keys(labels!).sort()).toEqual([...DEFAULT_LINK_ACTIONS].sort());
  });

  it('uses the labels the rest of the app already ships, verbatim', () => {
    expect(d().optionLabels).toEqual({
      throng: 'Open in throng',
      editor: 'Open in Editor',
      preview: 'Open in Preview',
      osExplorer: 'Open in OS Explorer',
      osDefaultProgram: 'Open in OS Default Program',
    });
  });

  it('FR-052: its description says a link with a line and column always opens an editor', () => {
    const text = d().description.toLowerCase();
    expect(text).toMatch(/line/);
    expect(text).toMatch(/column/);
    expect(text).toMatch(/editor/);
  });

  it('FR-039: its description says a click never runs an executable', () => {
    const text = d().description.toLowerCase();
    expect(text).toMatch(/never|not/);
    expect(text).toMatch(/run/);
  });
});

describe('the two detection switches (FR-060, FR-061)', () => {
  it('are toggles', () => {
    expect(descriptor('editor.links.detectInEditors').control).toBe('toggle');
    expect(descriptor('editor.links.detectInTerminals').control).toBe('toggle');
  });

  it('say what keeps working when they are off — explicit hyperlinks and web links', () => {
    const text = descriptor('editor.links.detectInTerminals').description.toLowerCase();
    expect(text).toMatch(/hyperlink/);
  });
});

describe('FR-061: the three link settings sit together, and the fourth does not', () => {
  it('all three are Editor · Links', () => {
    for (const key of [
      'editor.links.defaultAction',
      'editor.links.detectInEditors',
      'editor.links.detectInTerminals',
    ]) {
      expect(descriptor(key).group, key).toBe('Editor');
      expect(descriptor(key).subgroup, key).toBe('Links');
    }
  });

  it('they are declared consecutively, because the editor buckets in declaration order', () => {
    const indices = [
      'editor.links.defaultAction',
      'editor.links.detectInEditors',
      'editor.links.detectInTerminals',
    ].map((key) => SETTINGS_METADATA.findIndex((d) => d.key === key));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect(Math.max(...indices) - Math.min(...indices)).toBe(indices.length - 1);
  });

  it('terminals.advertiseHyperlinks sits in the flat Terminal group, with no subgroup', () => {
    const d = descriptor('terminals.advertiseHyperlinks');
    expect(d.group).toBe('Terminal');
    expect(d.subgroup).toBeUndefined();
    expect(d.control).toBe('toggle');
  });
});

describe('terminals.advertiseHyperlinks’ description carries FR-080a and FR-080c', () => {
  const text = () => descriptor('terminals.advertiseHyperlinks').description.toLowerCase();

  it('FR-080c: it says the setting applies to terminals started afterwards', () => {
    expect(text()).toMatch(/new terminal|terminals started|next terminal|already running/);
  });

  it('FR-080c: it says a terminal already running is not changed', () => {
    expect(text()).toMatch(/already running|existing|does not change/);
  });

  it('FR-080a: it says a FORCE_HYPERLINK the user set is never overridden', () => {
    expect(descriptor('terminals.advertiseHyperlinks').description).toContain('FORCE_HYPERLINK');
    expect(text()).toMatch(/never|not/);
  });
});
