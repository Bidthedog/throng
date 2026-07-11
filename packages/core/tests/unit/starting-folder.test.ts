import { describe, it, expect } from 'vitest';
import {
  resolveStartingFolder,
  isOverrideResolvable,
} from '../../src/config/starting-folder.js';

const PROFILE = 'C:/Users/dev';

describe('resolveStartingFolder (011 US3, FR-040/041/043)', () => {
  it('profile -> just the profile dir', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'profile', overridePath: 'D:/x', lastProjectFolder: 'D:/y' },
        { profileDir: PROFILE },
      ),
    ).toEqual([PROFILE]);
  });

  it('lastViewed -> the last project folder, then the profile dir', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'lastViewed', overridePath: 'D:/x', lastProjectFolder: 'D:/last' },
        { profileDir: PROFILE },
      ),
    ).toEqual(['D:/last', PROFILE]);
  });

  it('lastViewed -> just the profile dir when no folder has been chosen yet', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'lastViewed', overridePath: '', lastProjectFolder: '' },
        { profileDir: PROFILE },
      ),
    ).toEqual([PROFILE]);
  });

  it('override -> cascades override, then last viewed, then the profile dir', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'override', overridePath: 'D:/override', lastProjectFolder: 'D:/last' },
        { profileDir: PROFILE },
      ),
    ).toEqual(['D:/override', 'D:/last', PROFILE]);
  });

  it('override -> skips a blank override and cascades last viewed, then profile', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'override', overridePath: '', lastProjectFolder: 'D:/last' },
        { profileDir: PROFILE },
      ),
    ).toEqual(['D:/last', PROFILE]);
  });

  it('override -> override then profile when no folder has been viewed yet', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'override', overridePath: 'D:/override', lastProjectFolder: '' },
        { profileDir: PROFILE },
      ),
    ).toEqual(['D:/override', PROFILE]);
  });

  it('drops blank candidates (e.g. a renderer that leaves profileDir to UI-main)', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'override', overridePath: 'D:/override', lastProjectFolder: 'D:/last' },
        { profileDir: '' },
      ),
    ).toEqual(['D:/override', 'D:/last']);
  });

  it('de-duplicates repeated candidates (last viewed == profile)', () => {
    expect(
      resolveStartingFolder(
        { startingFolder: 'override', overridePath: 'D:/override', lastProjectFolder: PROFILE },
        { profileDir: PROFILE },
      ),
    ).toEqual(['D:/override', PROFILE]);
  });
});

describe('isOverrideResolvable (011 US3, FR-044)', () => {
  it('is false for a blank override', () => {
    expect(isOverrideResolvable('', () => true)).toBe(false);
  });

  it('reflects the existence check for a set override', () => {
    expect(isOverrideResolvable('D:/gone', () => false)).toBe(false);
    expect(isOverrideResolvable('D:/here', () => true)).toBe(true);
  });
});
