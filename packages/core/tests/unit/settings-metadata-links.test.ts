import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 045 FR-061, FR-080c, and the 2026-09-18 amendment FR-112, FR-120 — the descriptors' CONTENT.
 *
 * `settings-metadata.test.ts` is the completeness gate: it says every leaf has a descriptor and no
 * descriptor names a leaf that does not exist. It cannot say whether a descriptor tells the user
 * anything true. These cases carry the pieces of descriptor text that a REQUIREMENT depends on:
 *
 *  - FR-120 requires the existence-check timeout to say it applies with no restart — a user raising
 *    it for a slow share must not be left wondering whether anything happened.
 *  - FR-080c requires the hyperlink-advertising switch to SAY that it applies to terminals started
 *    afterwards, because a toggle that silently does nothing to what is on screen reads as broken.
 *
 * ══ SUPERSEDED 2026-09-18 (T143) ══
 *
 * The `editor.links.defaultAction` block (FR-050's select, its labels, its FR-039 / FR-052
 * description) is gone with the setting (FR-112). What replaces it asserts the descriptor is ABSENT,
 * and that the three `Editor · Links` descriptors — the two switches and the new timeout — still sit
 * together.
 */

const descriptor = (key: string) => {
  const found = SETTINGS_METADATA.find((d) => d.key === key);
  expect(found, `no descriptor for ${key}`).toBeDefined();
  return found!;
};

const LINK_KEYS = [
  'editor.links.detectInEditors',
  'editor.links.detectInTerminals',
  'editor.links.existenceCheckTimeoutMs',
] as const;

describe('editor.links.defaultAction is retired (FR-112)', () => {
  it('has no descriptor', () => {
    expect(SETTINGS_METADATA.find((d) => d.key === 'editor.links.defaultAction')).toBeUndefined();
  });
});

describe('editor.links.existenceCheckTimeoutMs (FR-120, FR-061)', () => {
  const d = () => descriptor('editor.links.existenceCheckTimeoutMs');

  it('is a slider over 250 – 25,000 in steps of 250', () => {
    expect(d().control).toBe('slider');
    expect(d().min).toBe(250);
    expect(d().max).toBe(25_000);
    expect(d().step).toBe(250);
  });

  it('is labelled Existence-check timeout', () => {
    expect(d().label).toBe('Existence-check timeout');
  });

  it('says it applies with no restart', () => {
    const text = d().description.toLowerCase();
    expect(text).toMatch(/restart/);
    expect(text).toMatch(/\bno restart\b|without (a )?restart|next check/);
  });

  it('says what it is for — a slow network location', () => {
    expect(d().description.toLowerCase()).toMatch(/network/);
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

describe('FR-061: the three Editor · Links settings sit together, and the hyperlink switch does not', () => {
  it('all three are Editor · Links', () => {
    for (const key of LINK_KEYS) {
      expect(descriptor(key).group, key).toBe('Editor');
      expect(descriptor(key).subgroup, key).toBe('Links');
    }
  });

  it('they are declared consecutively, because the editor buckets in declaration order', () => {
    const indices = LINK_KEYS.map((key) => SETTINGS_METADATA.findIndex((d) => d.key === key));
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
