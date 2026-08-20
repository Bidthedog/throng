import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * A tooltip tells you what a thing IS, never how to interact with it (017 / #57, FR-010).
 *
 * PLACE AT: `packages/ui/tests/unit/tooltip-instructions.test.ts`
 * MIGRATED FROM (035 FR-001): `packages/ui/tests/e2e/panel-tooltips.e2e.ts:115`
 * — `test('the interaction instructions appear NOWHERE in the workspace chrome')`.
 *
 * ══ WHY THIS IS STRONGER THAN THE TEST IT REPLACES, NOT MERELY CHEAPER ══
 *
 * The E2E swept every `[title]` element **on the page** and asserted none carried the instruction
 * list. Its own comment explains the intent, and the intent is right: *"Not merely absent from the
 * elements we changed — absent from every title attribute on the page. A guard shaped like the
 * change would pass while the string survived somewhere else."*
 *
 * But "on the page" is the weak part. It could only see what one window had rendered at that
 * moment: one project, one tab, one untyped panel, no terminal, no editor, no failure banner, no
 * sub-workspace. The string could sit on a control that renders only for a terminal panel, or only
 * after a failure, and that sweep would pass every time.
 *
 * Reading the SOURCE has no such blind spot. Every tooltip the app can ever draw is here, whether
 * or not anything has rendered it — which is what "appears nowhere" was always trying to say.
 *
 * ══ WHY IT STRIPS COMMENTS FIRST ══
 *
 * `panel-placeholder.tsx:465` explains, in prose, that this tooltip *used to* spend itself on
 * "Click: Activate · Drag: …". That comment is the reason the rule exists and is exactly the kind
 * of thing a codebase should keep. A guard that punished a file for explaining its own history
 * would be deleted, and would deserve to be.
 */
const SRC = join(process.cwd(), 'packages', 'ui', 'src', 'renderer');

/**
 * The instruction lists #57 removed. Kept as fragments rather than whole sentences: the point is
 * that a tooltip must not START teaching interaction, and the tail of the sentence is free to
 * change without weakening the rule.
 */
const INSTRUCTIONS = ['Click: Activate', 'Click: Switch', 'Drag: Move'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Block and line comments removed, so a file may explain the rule without violating it. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sources = walk(SRC).filter((f) => /\.[cm]?tsx?$/.test(f));

describe('interaction instructions never reach a tooltip (#57, FR-010)', () => {
  it('reads the renderer sources at all', () => {
    // Every assertion below passes vacuously on an empty scan — a moved directory would make this
    // file go quietly green while the rule it guards stopped being checked.
    expect(sources.length).toBeGreaterThan(50);
  });

  it('finds no instruction list in any renderer source', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const phrase of INSTRUCTIONS) {
        if (code.includes(phrase)) offenders.push(`${file.replace(/\\/g, '/').split('/src/')[1]} — ${phrase}`);
      }
    }
    expect(
      offenders.sort(),
      `a tooltip exists to say what a thing IS. #57 removed these instruction lists because the ` +
        `panel header's tooltip was spending itself on them while the title it was supposed to ` +
        `reveal stayed ellipsised. They remain discoverable from the right-click menu, which is ` +
        `where they belong:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('gives the tab chip no native tooltip, so it cannot race the popover (031 FR-051)', () => {
    /*
     * MIGRATED FROM `panel-tooltips.e2e.ts:95` — the half of that test the popover's own component
     * suite does not cover. `tab-popover.test.ts` mounts the POPOVER and proves what it says; this
     * is about the chip that summons it.
     *
     * 031 replaced the chip's `title` with a portalled popover, because a `title` attribute cannot
     * indent or format a panel list. Leaving both would give one chip two tooltips — and the native
     * one wins the race, so the user would see the unformatted version the popover exists to
     * replace. The absence is the requirement, which is why it is asserted rather than assumed.
     *
     * Read from the source rather than a render: the chip's own JSX is where the attribute would
     * come back, and a component test would have to render a strip to look at it.
     */
    const chipFile = sources.find((f) => f.replace(/\\/g, '/').endsWith('workspace/tab-group.tsx'));
    expect(chipFile, 'tab-group.tsx has moved — this guard is looking at nothing').toBeTruthy();

    const code = stripComments(readFileSync(chipFile as string, 'utf8'));
    // The chip's element opens with its className and testid; a `title` anywhere in that element's
    // attribute list is the regression. Bounded to the chip's own opening tag rather than the file,
    // because the strip legitimately titles its scroll buttons.
    const chipTag = /className=\{`tab-chip[\s\S]{0,400}?>/.exec(code)?.[0] ?? '';
    expect(chipTag, 'the tab-chip element was not found in tab-group.tsx').not.toBe('');
    expect(chipTag).not.toMatch(/\btitle=/);
  });

  it('still finds the tooltips that legitimately carry CONTENT', () => {
    /*
     * The control against a rule that would be satisfied by having no tooltips at all.
     *
     * FR-010 keeps the tooltips that name an action or a value — the panel-add button, the icon
     * controls the constitution requires to be titled. If this count ever fell to zero, the
     * assertion above would be perfectly green and the app would have lost every tooltip it has.
     */
    const withTitles = sources.filter((f) => /\btitle=/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(withTitles.length).toBeGreaterThan(5);
  });
});
