/**
 * 058 research D9 / data-model `InstallInUse`: who is using THIS copy's install root?
 *
 * The classifier is the pure half of the in-use helper that both installers run before replacing or
 * removing a copy. Its job is to split the processes running from one install root into the
 * performing account's and everyone else's, and to name the accounts that must close throng.
 *
 * Layer: unit — pure function over plain data; the OS query is the helper script's.
 */
import { describe, expect, it } from 'vitest';
import { classifyInstallUse, type InUseProcess } from '../../src/config/install-in-use.js';

const ROOT = 'C:\\Program Files\\throng';
const ME = 'S-1-5-21-1-1-1-1001';
const ALICE = 'S-1-5-21-1-1-1-1002';
const BOB = 'S-1-5-21-1-1-1-1003';

const proc = (pid: number, executablePath: string, ownerSid: string, ownerName: string): InUseProcess => ({
  pid,
  executablePath,
  ownerSid,
  ownerName,
});

describe('classifyInstallUse', () => {
  it('is free when nothing runs from the install root', () => {
    const r = classifyInstallUse([], ROOT, ME);
    expect(r).toEqual({ own: [], others: [], decision: 'free', message: null });
  });

  it("is own-only when only the performing account's processes run from the root", () => {
    const r = classifyInstallUse(
      [proc(10, `${ROOT}\\throng.exe`, ME, 'PC\\me'), proc(11, `${ROOT}\\resources\\runtime\\node.exe`, ME, 'PC\\me')],
      ROOT,
      ME,
    );
    expect(r.decision).toBe('own-only');
    expect(r.own).toEqual([10, 11]);
    expect(r.others).toEqual([]);
    expect(r.message).toBeNull();
  });

  it('is others when another account runs from the root, one entry per account', () => {
    const r = classifyInstallUse(
      [
        proc(20, `${ROOT}\\throng.exe`, ALICE, 'PC\\alice'),
        proc(21, `${ROOT}\\resources\\runtime\\node.exe`, ALICE, 'PC\\alice'),
        proc(30, `${ROOT}\\throng.exe`, BOB, 'PC\\bob'),
        proc(10, `${ROOT}\\throng.exe`, ME, 'PC\\me'),
      ],
      ROOT,
      ME,
    );
    expect(r.decision).toBe('others');
    expect(r.own).toEqual([10]);
    expect(r.others).toEqual([
      { account: 'PC\\alice', pids: [20, 21] },
      { account: 'PC\\bob', pids: [30] },
    ]);
  });

  it('refuses with exactly the contract text, naming every other account', () => {
    const r = classifyInstallUse(
      [proc(20, `${ROOT}\\throng.exe`, ALICE, 'PC\\alice'), proc(30, `${ROOT}\\throng.exe`, BOB, 'PC\\bob')],
      ROOT,
      ME,
    );
    expect(r.message).toBe(
      'throng is in use by other people signed in to this computer: PC\\alice, PC\\bob. ' +
        'Nothing has been changed. Ask them to close throng, then try again.',
    );
  });

  it('names a single account without a separator', () => {
    const r = classifyInstallUse([proc(20, `${ROOT}\\throng.exe`, ALICE, 'PC\\alice')], ROOT, ME);
    expect(r.message).toBe(
      'throng is in use by other people signed in to this computer: PC\\alice. ' +
        'Nothing has been changed. Ask them to close throng, then try again.',
    );
  });

  it("ignores processes under a DIFFERENT copy's root, whoever owns them (FR-017)", () => {
    const r = classifyInstallUse(
      [
        proc(20, 'C:\\Users\\alice\\AppData\\Local\\Programs\\throng\\throng.exe', ALICE, 'PC\\alice'),
        proc(21, 'C:\\Program Files\\throng MSI\\throng.exe', ALICE, 'PC\\alice'),
      ],
      ROOT,
      ME,
    );
    expect(r.decision).toBe('free');
    expect(r.others).toEqual([]);
  });

  it('does not treat a sibling folder that merely starts with the same text as under the root', () => {
    // "C:\Program Files\throng" must not claim "C:\Program Files\throng-tools\x.exe".
    const r = classifyInstallUse([proc(20, 'C:\\Program Files\\throng-tools\\x.exe', ALICE, 'PC\\alice')], ROOT, ME);
    expect(r.decision).toBe('free');
  });

  it('compares paths case-insensitively with separators normalised and a trailing separator ignored', () => {
    const r = classifyInstallUse(
      [proc(20, 'c:/program files/THRONG/throng.exe', ALICE, 'PC\\alice')],
      'C:\\Program Files\\throng\\',
      ME,
    );
    expect(r.decision).toBe('others');
    expect(r.others).toEqual([{ account: 'PC\\alice', pids: [20] }]);
  });

  it('compares account SIDs case-insensitively', () => {
    const r = classifyInstallUse([proc(10, `${ROOT}\\throng.exe`, ME.toLowerCase(), 'PC\\me')], ROOT, ME);
    expect(r.decision).toBe('own-only');
  });

  it('counts a process whose owner could not be read as another account, never as the performing one', () => {
    const r = classifyInstallUse([proc(40, `${ROOT}\\throng.exe`, '', '')], ROOT, ME);
    expect(r.decision).toBe('others');
    expect(r.others).toHaveLength(1);
    expect(r.others[0]?.pids).toEqual([40]);
    expect(r.others[0]?.account).not.toBe('');
  });

  it('ignores processes with no executable path', () => {
    const r = classifyInstallUse([proc(50, '', ALICE, 'PC\\alice')], ROOT, ME);
    expect(r.decision).toBe('free');
  });

  it('lets another account outweigh the performing account (decision is others)', () => {
    const r = classifyInstallUse(
      [proc(10, `${ROOT}\\throng.exe`, ME, 'PC\\me'), proc(20, `${ROOT}\\throng.exe`, ALICE, 'PC\\alice')],
      ROOT,
      ME,
    );
    expect(r.decision).toBe('others');
    expect(r.own).toEqual([10]);
  });
});
