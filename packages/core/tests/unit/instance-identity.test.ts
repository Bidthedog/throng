import { describe, expect, it } from 'vitest';

import {
  copyIdentity,
  differentCopyNoticeText,
  instanceLockName,
  isPackagedEntry,
  isSameCopy,
  parseLaunchMessage,
} from '../../src/config/instance-identity.js';

/**
 * 058 FR-018 / FR-018b — one running throng per user (contracts/instance-lock.md, research D5).
 *
 * The pure half of the instance guard: the lock's name, a copy's identity, the comparison that
 * decides whether a launch was of a DIFFERENT copy, the one-line launch message the losing launch
 * sends, and the notice's wording. The pipe and Electron edges live in `packages/ui/src/main/
 * instance-guard.ts`, tested at the integration layer.
 */
describe('instance identity (058 FR-018)', () => {
  describe('instanceLockName', () => {
    it('is the namespace pipe with an .instance suffix', () => {
      expect(instanceLockName('\\\\.\\pipe\\throng.alice.0123abcd.daemon')).toBe(
        '\\\\.\\pipe\\throng.alice.0123abcd.daemon.instance',
      );
    });

    it('follows the namespace, so a dev pipe yields a dev lock', () => {
      expect(instanceLockName('\\\\.\\pipe\\x.daemon.dev')).toBe('\\\\.\\pipe\\x.daemon.dev.instance');
    });
  });

  describe('copyIdentity', () => {
    it('takes the folder holding the executable as the install root', () => {
      expect(copyIdentity('C:\\Program Files\\throng\\throng.exe', '1.2.3')).toEqual({
        installRoot: 'C:\\Program Files\\throng',
        version: '1.2.3',
      });
    });

    it('accepts forward slashes too', () => {
      expect(copyIdentity('D:/portable/throng/throng.exe', '1.0.0')).toEqual({
        installRoot: 'D:/portable/throng',
        version: '1.0.0',
      });
    });
  });

  describe('isSameCopy', () => {
    const a = { installRoot: 'C:\\Program Files\\throng', version: '1.0.0' };

    it('is true for the same root', () => {
      expect(isSameCopy(a, { ...a })).toBe(true);
    });

    it('ignores case', () => {
      expect(isSameCopy(a, { installRoot: 'c:\\program files\\THRONG', version: '1.0.0' })).toBe(true);
    });

    it('normalises separators and a trailing separator', () => {
      expect(isSameCopy(a, { installRoot: 'C:/Program Files/throng/', version: '1.0.0' })).toBe(true);
    });

    it('compares the root only, not the version', () => {
      expect(isSameCopy(a, { installRoot: a.installRoot, version: '2.0.0' })).toBe(true);
    });

    it('is false for a different root', () => {
      expect(
        isSameCopy(a, { installRoot: 'C:\\Users\\u\\AppData\\Local\\Programs\\throng', version: '1.0.0' }),
      ).toBe(false);
    });
  });

  describe('parseLaunchMessage', () => {
    it('accepts an execPath with a version', () => {
      expect(parseLaunchMessage('{"execPath":"C:\\\\t\\\\throng.exe","version":"1.2.3"}')).toEqual({
        execPath: 'C:\\t\\throng.exe',
        version: '1.2.3',
      });
    });

    it('accepts a null version', () => {
      expect(parseLaunchMessage('{"execPath":"C:/t/throng.exe","version":null}')).toEqual({
        execPath: 'C:/t/throng.exe',
        version: null,
      });
    });

    it('tolerates the trailing newline that ends the line', () => {
      expect(parseLaunchMessage('{"execPath":"x","version":"1"}\n')).toEqual({ execPath: 'x', version: '1' });
    });

    it.each([
      ['not JSON', 'hello'],
      ['an array', '[]'],
      ['null', 'null'],
      ['a missing execPath', '{"version":"1"}'],
      ['an empty execPath', '{"execPath":"","version":"1"}'],
      ['a non-string execPath', '{"execPath":3,"version":"1"}'],
      ['a missing version', '{"execPath":"x"}'],
      ['a numeric version', '{"execPath":"x","version":1}'],
    ])('rejects %s', (_label, raw) => {
      expect(parseLaunchMessage(raw)).toBeNull();
    });
  });

  describe('isPackagedEntry (research D7)', () => {
    it.each([
      ['C:\\Program Files\\throng\\resources\\app\\packages\\daemon\\dist\\main.js', true],
      ['c:/users/u/appdata/local/programs/throng/RESOURCES/APP/packages/daemon/dist/main.js', true],
      ['C:\\Users\\u\\AppData\\Local\\Temp\\2abc\\resources\\app\\packages\\daemon\\dist\\main.js', true],
      ['D:\\git\\throng\\packages\\daemon\\dist\\main.js', false],
      ['D:\\git\\throng\\resources\\application\\main.js', false],
      ['', false],
    ])('%s → %s', (entry, expected) => {
      expect(isPackagedEntry(entry)).toBe(expected);
    });
  });

  describe('differentCopyNoticeText', () => {
    it('produces the contract text exactly', () => {
      expect(
        differentCopyNoticeText({
          runningRoot: 'C:\\Program Files\\throng',
          runningVersion: '1.2.3',
          launchedRoot: 'D:\\portable\\throng',
        }),
      ).toBe(
        'throng is already running from C:\\Program Files\\throng (version 1.2.3). ' +
          'To open the copy at D:\\portable\\throng, close this one first.',
      );
    });
  });
});
