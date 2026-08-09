import { describe, it, expect } from 'vitest';
import { resolveThrongHolder, type KnownTerminal, type PanelIdentity } from '../../src/main/throng-holder.js';

/**
 * 029 FR-013 / FR-013b — is one of throng's OWN terminals holding this folder, and which one?
 *
 * The join itself is a prefix match, and prefix matches over paths are where quiet wrongness lives:
 * case, trailing separators, and the sibling that merely SHARES A PREFIX with the failed path. Each
 * of those produces a confident, specific, wrong sentence rather than an obvious failure.
 */

const identities = (entries: Record<string, PanelIdentity>): ReadonlyMap<string, PanelIdentity> =>
  new Map(Object.entries(entries));

const NONE = identities({});
const term = (panelId: string, cwd?: string): KnownTerminal => ({ panelId, cwd });

describe('resolveThrongHolder (029 FR-013)', () => {
  it('names the panel whose shell sits exactly there', () => {
    const holder = resolveThrongHolder(
      'C:/proj/Inner',
      [term('p1', 'C:/proj/Inner')],
      identities({ p1: { panelTitle: 'Build' } }),
    );
    expect(holder).toEqual({ isThrong: true, panelTitle: 'Build' });
  });

  it('names it when the shell is DEEPER than the folder, because Windows holds every ancestor', () => {
    // A shell in `Inner\src` blocks a rename of `Inner` just as firmly. Matching only equality would
    // send the user hunting for a foreign process while their own terminal sat two levels down.
    const holder = resolveThrongHolder(
      'C:/proj/Inner',
      [term('p1', 'C:/proj/Inner/src/deep')],
      identities({ p1: { panelTitle: 'Build' } }),
    );
    expect(holder?.panelTitle).toBe('Build');
  });

  it('ignores a SIBLING that merely shares the name as a prefix', () => {
    // `C:/proj/Inner2` starts with `C:/proj/Inner`. A bare `startsWith` says throng is holding the
    // folder and names a terminal that is nowhere near it — worse than the errno, because it is
    // specific enough to be believed.
    expect(resolveThrongHolder('C:/proj/Inner', [term('p1', 'C:/proj/Inner2')], NONE)).toBeUndefined();
  });

  it('ignores a shell in an ANCESTOR — the project root does not hold a subfolder', () => {
    // The commonest false positive available: every terminal starts at the project root, so an
    // ancestor match would name a holder for every rename anywhere in the tree.
    expect(resolveThrongHolder('C:/proj/Inner', [term('p1', 'C:/proj')], NONE)).toBeUndefined();
  });

  it('matches regardless of case and trailing separators', () => {
    // Windows-first: `C:\Work` and `c:\work` are one folder, and cwds arrive spelled either way.
    const holder = resolveThrongHolder(
      'C:/Proj/Inner/',
      [term('p1', 'c:\\proj\\inner')],
      identities({ p1: { panelTitle: 'Build' } }),
    );
    expect(holder?.panelTitle).toBe('Build');
  });

  it('says throng WITHOUT a panel when the id is unknown (FR-013b)', () => {
    const holder = resolveThrongHolder('C:/proj/Inner', [term('p1', 'C:/proj/Inner')], NONE);

    // Not `undefined`. "throng is holding this and cannot say which panel" still tells the user to
    // look at their own terminals rather than hunt for a foreign process — and it is deliberately
    // the same degrade an unresolvable third party takes, so neither can rot unnoticed.
    expect(holder).toEqual({ isThrong: true });
  });

  it('carries the sub-workspace window when the identity has one (FR-013a)', () => {
    const holder = resolveThrongHolder(
      'C:/proj/Inner',
      [term('p1', 'C:/proj/Inner')],
      identities({ p1: { panelTitle: 'Logs', windowTitle: 'Deploy' } }),
    );
    expect(holder).toEqual({ isThrong: true, panelTitle: 'Logs', windowTitle: 'Deploy' });
  });

  it('skips a session that has not reported a cwd', () => {
    // `cwd` is optional: a session that has never been polled has none. Treating absent as a match
    // would name the first terminal in the list for every failure.
    expect(resolveThrongHolder('C:/proj/Inner', [term('p1')], NONE)).toBeUndefined();
  });

  it('is undefined when nothing of throng’s is there — which is NOT "nothing is"', () => {
    // The caller then reports the third-party wording. Asserted so the two outcomes stay distinct:
    // `undefined` means "not throng", never "not held".
    expect(resolveThrongHolder('C:/proj/Inner', [term('p1', 'C:/elsewhere')], NONE)).toBeUndefined();
  });
});
