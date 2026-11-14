import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { COMPONENT_DESCRIPTIONS, ROLE_DESCRIPTIONS } from '../../src/resources/descriptions.js';

/**
 * 068 FR-065 / constitution v6.5.0, Principle VI — user-visible text names the operating system "the OS",
 * never "Windows" or "Linux". Product and format names that contain the word stay: they name a thing, not
 * the OS.
 *
 * A guard over the two catalogues of user-visible copy that live in core — every settings descriptor
 * (label, description, option labels; a `description` getter runs, under the default Windows host traits,
 * which is the branch that used to say "Windows") and the Resource Monitor's process descriptions — so a new
 * entry that names the OS fails here rather than in a hand test.
 */
const KEPT_NAMES = [/Windows PowerShell/g, /Windows-\d+/g, /Windows Code Pages/g, /Git for Windows/g, /\((Windows|Linux)\)/g];

function osMentions(text: string): string[] {
  const stripped = KEPT_NAMES.reduce((t, name) => t.replace(name, ''), text);
  return stripped.match(/\b(Windows|Linux)\b/g) ?? [];
}

describe('user-visible text names the OS generically (068 FR-065)', () => {
  it('no settings label, description or option names Windows or Linux', () => {
    const offenders = SETTINGS_METADATA.flatMap((d) => {
      // JSON.stringify reads every enumerable getter, so a computed description is checked as rendered.
      const text = JSON.stringify(d);
      return osMentions(text).length > 0 ? [`${'key' in d ? String(d.key) : d.label}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('no Resource Monitor process description names Windows or Linux', () => {
    const offenders = Object.entries({ ...COMPONENT_DESCRIPTIONS, ...ROLE_DESCRIPTIONS }).filter(
      ([, text]) => osMentions(text).length > 0,
    );
    expect(offenders).toEqual([]);
  });

  it('keeps product and format names that contain the word (anti-vacuity)', () => {
    expect(osMentions('Windows PowerShell, Windows-1252, Git for Windows, Absolute (Windows)')).toEqual([]);
    expect(osMentions('Raise a Windows notification')).toEqual(['Windows']);
  });
});
