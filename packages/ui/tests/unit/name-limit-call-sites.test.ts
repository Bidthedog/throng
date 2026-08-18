/**
 * FR-035g's structural half: there is ONE bounded rename box, and both users of it take the SAME
 * setting.
 *
 * PLACE AT: `packages/ui/tests/unit/name-limit-call-sites.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/tab-name-limit.e2e.ts` T080 (034 FR-045), with
 * `packages/ui/tests/component/name-limit-field.test.ts` carrying the behavioural half.
 *
 * ══ WHY A SOURCE WALK, AND WHY IT IS THE STRONGER CLAIM ══
 *
 * T080 renamed a PANEL in the running app and checked that its counter said the same thing the tab's
 * had said. That is a sample of two surfaces at one moment. What FR-035g actually asks for is that the
 * caps CANNOT drift — and drift is a structural property: a third rename box, or a second reading of
 * the limit, is what would cause it, and neither is visible from a rendered panel header.
 *
 * So this walks the renderer and asserts the shape directly. It is the pattern
 * `icon-call-sites.test.ts` and `icon-tokens-exist.test.ts` already use here, and for the same reason:
 * only a source walk DISCOVERS a new call site rather than checking the ones someone remembered.
 *
 * What it deliberately does NOT do is check the limit's VALUE or the counter's behaviour. Those are
 * the component test's, and restating them from source text would be asserting on a string that
 * happens to spell the behaviour rather than on the behaviour.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** As a posix-ish path relative to the renderer root, so the expectations below read as the repo does. */
const rel = (file: string): string => relative(RENDERER, file).split('\\').join('/');

/**
 * The limit, derived from the ONE setting.
 *
 * Two spellings are accepted because the two call sites legitimately differ: `panel-placeholder.tsx`
 * reads `settings.tabs.maxNameLength` on its own line, and `tab-group.tsx` destructures it out of
 * `settings.tabs` alongside four other tab settings (and hands it down as a prop to the chip that
 * renders the box). Both are "the tabs setting"; neither is a second opinion about the limit.
 */
const FROM_TAB_SETTINGS =
  /(maxNameLength\s*=\s*settings\.tabs\.maxNameLength)|(\{[^}]*\bmaxNameLength\b[^}]*\}\s*=\s*settings\.tabs\b)/;

describe('the bounded rename box has exactly two call sites', () => {
  const files = walk(RENDERER);
  const users = files.filter((f) => /<NameLimitField\b/.test(readFileSync(f, 'utf8')));

  it('is rendered by the tab strip and the panel header, and by nothing else', () => {
    /*
     * A third rename box is exactly the regression FR-035g exists to prevent, and it would not fail
     * any other test in the repository: it would simply have its own idea of the cap, and a user would
     * meet it as "the same limit behaving differently depending on what I renamed".
     *
     * If a legitimate third surface is added, this list is the place to record the decision — which is
     * the point. An addition here is a sentence in a diff; a silent second implementation is not.
     */
    expect(users.map(rel).sort()).toEqual([
      'workspace/panel-placeholder.tsx',
      'workspace/tab-group.tsx',
    ]);
  });

  it('both take their limit from `settings.tabs.maxNameLength`, and pass it as `limit`', () => {
    for (const file of users) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${rel(file)}: does not derive the limit from the tabs settings`).toMatch(
        FROM_TAB_SETTINGS,
      );
      // The prop is what the component actually applies; a call site that computed its own bound and
      // passed a literal would satisfy the regex above and still have drifted.
      expect(src, `${rel(file)}: does not pass the limit to NameLimitField`).toMatch(
        /<NameLimitField[\s\S]{0,600}?limit=\{maxNameLength\}/,
      );
    }
  });

  it('finds the usages it claims to check (guards against a vacuous pass)', () => {
    // Rename the component, or change the JSX to a spread, and every assertion above becomes trivially
    // true over an empty list. That failure mode is the whole reason source guards get distrusted.
    expect(files.length).toBeGreaterThan(50);
    expect(users.length).toBe(2);
  });
});
