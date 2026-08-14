import { describe, it, expect } from 'vitest';
import { supersede } from '../../src/renderer/common/notice-suppression.js';

/**
 * 030 FR-029 / FR-034a — a consolidated notice SUPERSEDES the surface-level one it shares a cause
 * with, and inherits the raw error it was carrying.
 *
 * ══ THE DEFECT ══
 *
 * Reported from a real session, and the diagnostics log has both halves 265 ms apart:
 *
 *   ERROR [renderer-notice] subject="test 1" action="list the contents of" cause="path-missing:test 1"
 *   ERROR [renderer-notice] subject="test 1" action="open"                 affected=1
 *
 * Rename a project's root folder while throng is closed, then reopen the project, and TWO notices
 * arrive for one absent folder — exactly the storm FR-029 exists to end, reduced from twelve to two
 * rather than to one.
 *
 * The supersede rule was implemented and correct; it matches on `causeKey`, and the consolidated
 * notice had none. `missing-file-watcher.tsx` reported each defeated editor without a cause — its
 * type even documented that as "the common case for editors" — so the notice that says MORE could
 * not displace the one that says less. The terminal path did supply a cause, which is why
 * `project-missing-root-wedge.e2e.ts` asserts this behaviour, passes, and never covered the editor
 * half of the same rule.
 *
 * ══ WHY THIS IS A PURE FUNCTION AND NOT AN INLINE FILTER ══
 *
 * It was an inline `live.current.filter(...)` in the provider, which is why the only test that could
 * reach it was an E2E driving a terminal. The rule now lives beside the other pure notice rules, so
 * the editor case costs a unit test rather than a two-second Electron launch — and so the second
 * half of it, below, is testable at all.
 */

interface TestNotice {
  id: string;
  causeKey?: string;
  copyDetail?: string;
  affected?: readonly { panelId: string }[];
}

const surface = (id: string, causeKey: string, copyDetail?: string): TestNotice => ({
  id,
  causeKey,
  ...(copyDetail ? { copyDetail } : {}),
});

const consolidated = (id: string, causeKey?: string): TestNotice => ({
  id,
  ...(causeKey ? { causeKey } : {}),
  affected: [{ panelId: 'p1' }],
});

describe('supersede — one cause, one notice, whichever reported first (FR-029)', () => {
  it('drops the surface-level notice the consolidated one shares a cause with', () => {
    const live = [surface('n1', 'path-missing:test 1')];
    const result = supersede(live, consolidated('n2', 'path-missing:test 1'));
    expect(result.keep).toEqual([]);
  });

  it('leaves a surface-level notice about a DIFFERENT cause alone', () => {
    // Two real problems are two notices — #178, and the reason the key is the cause and never the
    // surface. A user whose folder went missing AND whose save was refused has two things to fix.
    const live = [surface('n1', 'permission-denied:Notes')];
    const result = supersede(live, consolidated('n2', 'path-missing:test 1'));
    expect(result.keep.map((n) => n.id)).toEqual(['n1']);
  });

  it('never supersedes another CONSOLIDATED notice, even on the same cause', () => {
    // Two projects can be defeated by one cause key only if they are named the same; each still
    // holds its own panel list, and dropping one would silently discard casualties.
    const live = [consolidated('n1', 'path-missing:test 1')];
    const result = supersede(live, consolidated('n2', 'path-missing:test 1'));
    expect(result.keep.map((n) => n.id)).toEqual(['n1']);
  });

  it('supersedes NOTHING when the incoming notice carries no panels', () => {
    // The exemption runs the other way: a surface-level notice never displaces anything. It is the
    // consolidated one that says more, and only it earns the right to replace.
    const live = [surface('n1', 'path-missing:test 1')];
    const result = supersede(live, { causeKey: 'path-missing:test 1' });
    expect(result.keep.map((n) => n.id)).toEqual(['n1']);
  });

  it('supersedes nothing when the incoming notice has no cause key', () => {
    // Precisely the reported defect: no key, no match, two notices. Asserted so that a future change
    // which stops supplying the cause fails here rather than in a user's session.
    const live = [surface('n1', 'path-missing:test 1')];
    const result = supersede(live, consolidated('n2'));
    expect(result.keep.map((n) => n.id)).toEqual(['n1']);
  });

  it('does not match on an EMPTY cause key', () => {
    // FR-011b: a failure matching none of the five kinds has no cause. Treating '' as a key would
    // collapse every unclassified failure into whichever consolidated notice arrived next.
    const live = [{ id: 'n1', causeKey: '' }];
    const result = supersede(live, { ...consolidated('n2'), causeKey: '' });
    expect(result.keep.map((n) => n.id)).toEqual(['n1']);
  });
});

describe('supersede — the raw error is inherited, never discarded (FR-034a)', () => {
  it('carries the superseded notice’s raw error out for the survivor to keep', () => {
    /*
     * THE HALF THAT MAKES THE FIX SAFE.
     *
     * The superseded notice was the only thing carrying `ENOENT … realpath 'D:\…\test 1'` — the
     * one line naming the path that is not there. The consolidated notice's rows name each missing
     * FILE; neither names the folder whose disappearance took them all. Dropping the notice without
     * its detail would fix the duplicate by losing the fact the duplicate was carrying, which is a
     * worse bug than the one being fixed and an invisible one.
     */
    const live = [surface('n1', 'path-missing:test 1', "ENOENT: no such file or directory, realpath 'D:\\x\\test 1'")];
    const result = supersede(live, consolidated('n2', 'path-missing:test 1'));
    expect(result.carried).toEqual(["ENOENT: no such file or directory, realpath 'D:\\x\\test 1'"]);
  });

  it('carries nothing from a superseded notice that had no raw error', () => {
    const live = [surface('n1', 'path-missing:test 1')];
    expect(supersede(live, consolidated('n2', 'path-missing:test 1')).carried).toEqual([]);
  });

  it('de-duplicates identical raw errors from several superseded notices', () => {
    // The file tree and a sibling surface can report the same errno for the same folder. Pasting it
    // twice into one copy is noise, and the user is reading it to find a path.
    const live = [
      surface('n1', 'path-missing:test 1', 'ENOENT: realpath'),
      surface('n2', 'path-missing:test 1', 'ENOENT: realpath'),
    ];
    const result = supersede(live, consolidated('n3', 'path-missing:test 1'));
    expect(result.keep).toEqual([]);
    expect(result.carried).toEqual(['ENOENT: realpath']);
  });

  it('carries nothing when nothing was superseded', () => {
    const live = [surface('n1', 'permission-denied:Notes', 'EACCES')];
    expect(supersede(live, consolidated('n2', 'path-missing:test 1')).carried).toEqual([]);
  });
});
