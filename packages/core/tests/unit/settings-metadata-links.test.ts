import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 045 FR-061, FR-080c, and the 2026-09-18 amendment FR-112, FR-120 — the descriptors' CONTENT.
 *
 * `settings-metadata.test.ts` is the completeness gate: it says every leaf has a descriptor and no
 * descriptor names a leaf that does not exist. It cannot say whether a descriptor tells the user
 * anything true. These cases carry the pieces of descriptor text that a REQUIREMENT depends on:
 *
 *  - FR-080c requires the hyperlink-advertising switch to SAY that it applies to terminals started
 *    afterwards, because a toggle that silently does nothing to what is on screen reads as broken.
 *
 * ══ SUPERSEDED 2026-09-18 (T143) ══
 *
 * The `editor.links.defaultAction` block (FR-050's select, its labels, its FR-039 / FR-052
 * description) is gone with the setting (FR-112). What replaces it asserts the descriptor is ABSENT.
 *
 * ══ SUPERSEDED AGAIN — round five (#408) ══
 *
 * Round five changes what the meaning of it all is:
 *
 *  - The two detection switches now govern EVERY kind of link (detected paths, web links,
 *    allowlisted protocol links, OSC 8 hyperlinks), not detected paths alone. The T232-era cases that
 *    pinned the OLD narrower meaning are replaced by cases pinning the new one.
 *  - `editor.links.existenceCheckTimeoutMs` keeps its KEY (renaming it would drop every persisted
 *    value) but is relabelled — nothing has checked existence before drawing a link since round four,
 *    so "Existence-check timeout" was already wrong.
 *  - `editor.links.knownFileExtensions.added` / `.removed` are gone; `editor.links.knownFileExtensions`
 *    is now the one array the preferences editor shows and edits directly, so its description no
 *    longer needs to spell out the shipped list in prose.
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
  'editor.links.protocolAllowlist',
  'editor.links.knownFileExtensions',
] as const;

const LIST_KEYS = ['editor.links.protocolAllowlist', 'editor.links.knownFileExtensions'] as const;

describe('editor.links.defaultAction is retired (FR-112)', () => {
  it('has no descriptor', () => {
    expect(SETTINGS_METADATA.find((d) => d.key === 'editor.links.defaultAction')).toBeUndefined();
  });
});

describe('editor.links.knownFileExtensions.added / .removed are retired (round five, #408)', () => {
  it('neither has a descriptor', () => {
    expect(
      SETTINGS_METADATA.find((d) => d.key === 'editor.links.knownFileExtensions.added'),
    ).toBeUndefined();
    expect(
      SETTINGS_METADATA.find((d) => d.key === 'editor.links.knownFileExtensions.removed'),
    ).toBeUndefined();
  });
});

describe('terminals.linkHoverDelayMs is retired (round five, #408)', () => {
  it('has no descriptor', () => {
    expect(SETTINGS_METADATA.find((d) => d.key === 'terminals.linkHoverDelayMs')).toBeUndefined();
  });
});

describe('editor.links.existenceCheckTimeoutMs — renamed, key kept (round five, FR-120, #408)', () => {
  const d = () => descriptor('editor.links.existenceCheckTimeoutMs');

  it('is a slider over 250 – 25,000 in steps of 250', () => {
    expect(d().control).toBe('slider');
    expect(d().min).toBe(250);
    expect(d().max).toBe(25_000);
    expect(d().step).toBe(250);
  });

  it('is no longer labelled Existence-check timeout — nothing checks existence any more', () => {
    expect(d().label).not.toBe('Existence-check timeout');
    expect(d().label.toLowerCase()).not.toMatch(/existence/);
  });

  it('says it applies with no restart', () => {
    const text = d().description.toLowerCase();
    expect(text).toMatch(/restart/);
    expect(text).toMatch(/\bno restart\b|without (a )?restart|next check/);
  });

  it('says what it is for — a slow network location', () => {
    expect(d().description.toLowerCase()).toMatch(/network/);
  });

  it('names following a link and opening the Link menu — a resolution bound, not an existence check', () => {
    const text = d().description.toLowerCase();
    expect(text).toMatch(/follow/);
    expect(text).toMatch(/link menu/);
    expect(text).not.toMatch(/exist/);
  });
});

describe('the two detection switches now govern every kind of link (round five, #408)', () => {
  it('are toggles', () => {
    expect(descriptor('editor.links.detectInEditors').control).toBe('toggle');
    expect(descriptor('editor.links.detectInTerminals').control).toBe('toggle');
  });

  it('both say they govern web links, protocol links and hyperlinks too — not detected paths alone', () => {
    for (const key of ['editor.links.detectInEditors', 'editor.links.detectInTerminals'] as const) {
      const text = descriptor(key).description.toLowerCase();
      expect(text, key).toMatch(/web link/);
      expect(text, key).toMatch(/protocol link/);
      expect(text, key).toMatch(/hyperlink/);
    }
  });

  it('neither says the other kinds keep working when it is off — off now means none of them', () => {
    for (const key of ['editor.links.detectInEditors', 'editor.links.detectInTerminals'] as const) {
      const text = descriptor(key).description.toLowerCase();
      expect(text, key).not.toMatch(/keep working|stay(s)? a link|still (a link|work)/);
    }
  });

  it('neither says a path must name something that exists — validity is syntactic (FR-155)', () => {
    for (const key of ['editor.links.detectInEditors', 'editor.links.detectInTerminals'] as const) {
      expect(descriptor(key).description.toLowerCase(), key).not.toMatch(/exist/);
    }
  });
});

describe('FR-061: the Editor · Links settings sit together, and the hyperlink switch does not', () => {
  it('every one is Editor · Links', () => {
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

describe('the allowlist and the known-extensions list (round five, FR-159, #408)', () => {
  it('are string lists — array control, text items, clearable', () => {
    for (const key of LIST_KEYS) {
      expect(descriptor(key).control, key).toBe('array');
      expect(descriptor(key).itemControl, key).toBe('text');
      expect(descriptor(key).clearable, key).toBe(true);
    }
  });

  it('the allowlist description says it applies to terminals AND editors (FR-159)', () => {
    const text = descriptor('editor.links.protocolAllowlist').description.toLowerCase();
    expect(text).toMatch(/terminal/);
    expect(text).toMatch(/editor/);
  });

  it('the known-extensions description says it applies to terminals AND editors', () => {
    const text = descriptor('editor.links.knownFileExtensions').description.toLowerCase();
    expect(text).toMatch(/terminal/);
    expect(text).toMatch(/editor/);
  });

  it('the known-extensions description does NOT spell out the shipped list — the array control shows it', () => {
    const text = descriptor('editor.links.knownFileExtensions').description;
    // A prose list of every shipped extension is the exact duplication round five removed; a short
    // description stays well under the length round four's spelled-out list needed.
    expect(text.length).toBeLessThan(300);
  });

  it('the known-extensions description says an entry is taken with or without its dot, and without case', () => {
    const text = descriptor('editor.links.knownFileExtensions').description.toLowerCase();
    expect(text).toMatch(/dot/);
    expect(text).toMatch(/case/);
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
