/**
 * 080 FR-018 (contracts/guide-map.md § PR marker) — a pull request that changes the app's source either updates
 * the guide or a reference, or says in its body that no user sees the change.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a plain .mjs CI script with no type declarations
import { checkGuidePr } from '../../../../scripts/guide-pr-check.mjs';

const SRC = 'packages/ui/src/renderer/title-bar/cog-menu.tsx';

describe('checkGuidePr (080 FR-018)', () => {
  it('fails a source change with no guide or reference change and no marker, listing the files and the line to add', () => {
    const result = checkGuidePr({ changed: [SRC, 'packages/core/src/help/help-urls.ts'], body: 'Adds a thing.' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(SRC);
    expect(result.message).toContain('packages/core/src/help/help-urls.ts');
    expect(result.message).toContain('No user-facing change: ');
  });

  it('passes with the marker line', () => {
    const body = 'Refactor.\n\nNo user-facing change: refactor\n';
    expect(checkGuidePr({ changed: [SRC], body }).ok).toBe(true);
  });

  it('does not take a marker with no reason, or one that does not start its line', () => {
    expect(checkGuidePr({ changed: [SRC], body: 'No user-facing change: ' }).ok).toBe(false);
    expect(checkGuidePr({ changed: [SRC], body: 'Note: No user-facing change: refactor' }).ok).toBe(false);
  });

  it.each(['site/guide/terminals.md', 'docs/preferences.md', 'docs/key-bindings.md', 'docs/theme-settings.md'])(
    'passes a source change that also changes %s',
    (doc) => {
      expect(checkGuidePr({ changed: [SRC, doc], body: '' }).ok).toBe(true);
    },
  );

  it('passes a change to tests, docs or tooling alone', () => {
    const changed = ['packages/ui/tests/unit/x.test.ts', 'packages/core/src/help/x.test.ts', 'docs/linux.md', 'scripts/site.mjs'];
    expect(checkGuidePr({ changed, body: '' }).ok).toBe(true);
  });

  it('reads a body with Windows line endings', () => {
    expect(checkGuidePr({ changed: [SRC], body: 'x\r\nNo user-facing change: internal\r\n' }).ok).toBe(true);
  });
});
