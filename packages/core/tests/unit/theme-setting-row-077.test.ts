/**
 * 077 FR-026 — the active theme is chosen in the Themes tab, so the Settings tab draws no row for it.
 *
 * Layer: unit — which descriptors the Settings tab draws, and which keys Revert All and the JSON tab still own,
 * are decisions about the registry, with no DOM needed.
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA, descriptorsForThisPlatform, settingsLeaves } from '../../src/config/settings-metadata.js';

const KEY = 'appearance.theme';

describe('the Theme setting (077 FR-026)', () => {
  it('draws no row in the Settings tab, which leaves General with no Appearance subsection', () => {
    const drawn = descriptorsForThisPlatform(SETTINGS_METADATA);
    expect(drawn.map((d) => d.key)).not.toContain(KEY);
    expect(drawn.filter((d) => d.group === 'General' && d.subgroup === 'Appearance')).toEqual([]);
  });

  it('is still a described, configurable setting: Revert All restores it and the JSON tab checks it', () => {
    expect(SETTINGS_METADATA.find((d) => d.key === KEY)).toMatchObject({ label: 'Theme', editedIn: 'themes' });
    expect(settingsLeaves()).toContain(KEY);
  });
});
