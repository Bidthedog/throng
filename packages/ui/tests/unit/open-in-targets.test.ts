/**
 * 043 T219 (FR-087, FR-087a, FR-087b) — the "Open In" targets, at the builder that decides every one
 * of their guarantees.
 *
 * ══ WHY THIS IS A `unit` TEST AND NOT A COMPONENT ONE ══
 *
 * The whole decision is five booleans and a title. Until this round it lived inside the explorer's
 * `onContextMenu`, so the only way to ask it a question was to mount a virtualised tree, stub the
 * bridge and drive two nested menus — which is what `explorer-open-in-target.test.ts` does, and why
 * it can only reach the combinations a mounted tree can be pushed into. `describeOpenInTargets`
 * imports nothing that touches a store, a DOM or `window`, so here the combinations are object
 * literals and the ones that matter most are the ones a mounted tree makes awkward.
 *
 * THE ASSERTION MOST LIKELY TO ROT IS THE INDEPENDENCE OF THE TWO FLAGS. `alreadyOpen` (006 FR-011a
 * — the file is open in SOME editor, app-wide) and `lastActiveHoldsFile` (006 FR-082 — the file is
 * open in THIS one, so opening there is a no-op) disable different targets for different reasons. A
 * test that only ever set them together would pass against a module that had collapsed them into
 * one boolean, and the collapse is an easy edit to make while "simplifying". Two tests below set
 * each without the other, on purpose.
 *
 * 060 FR-045 retired the two-rule split described above for an OPEN file: once it is open anywhere,
 * one Current Editor row replaces both. The control below is kept as history of why the rows were split.
 *
 * ANTI-VACUITY CONTROL (pre-FR-045), run rather than asserted:
 * `New Editor` row's `disabled` from `noTab || alreadyOpen` to `noTab || lastActiveHoldsFile` — the
 * collapse described above, in its most plausible form. **Four tests fail**, and they were counted
 * by doing it: "New Editor is disabled once the file is open anywhere", both halves of "the two
 * disable flags are independent", and "carries the disabled state through to the drawn rows".
 *
 * That fourth one was not predicted, and it is the useful part of running the control rather than
 * reasoning about it: the menu-row assertion is not a restatement of the target assertion, because
 * a collapse in the decision reaches the drawn row through a different path. Nothing here can pass
 * against a module that has stopped telling the two rules apart.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  describeOpenInTargets,
  openInMenuActions,
  type OpenInFacts,
  type OpenInTarget,
} from '../../src/renderer/editor/open-in-targets.js';

/**
 * The state the requirements are written against: one tab, an editor last active in it holding
 * something else, and the file not open anywhere. Every test below names only what it changes, so
 * the thing under test is visible in the test rather than buried in a fixture.
 */
const BASE: OpenInFacts = {
  activeTabId: 'tab-1',
  otherTabs: [],
  lastActiveEditorTitle: 'Scratch',
  lastActiveHoldsFile: false,
  alreadyOpen: false,
};

const facts = (over: Partial<OpenInFacts> = {}): OpenInFacts => ({ ...BASE, ...over });

const byKind = (targets: readonly OpenInTarget[], kind: OpenInTarget['kind']): OpenInTarget[] =>
  targets.filter((t) => t.kind === kind);

const one = (targets: readonly OpenInTarget[], kind: OpenInTarget['kind']): OpenInTarget => {
  const found = byKind(targets, kind);
  expect(found, `expected exactly one ${kind} target`).toHaveLength(1);
  return found[0]!;
};

describe('describeOpenInTargets — the label (006 FR-098)', () => {
  it('names the panel the file would land in', () => {
    const target = one(describeOpenInTargets(facts()), 'lastActive');
    expect(target.label).toBe('Last Active Editor (Scratch)');
  });

  it('falls back to the bare label with no panel to name, rather than an empty parenthesis', () => {
    const target = one(describeOpenInTargets(facts({ lastActiveEditorTitle: undefined })), 'lastActive');
    // Both halves matter: the suffix is COMPOSED, so its absence must not leave "()" behind.
    expect(target.label).toBe('Last Active Editor');
    expect(target.label).not.toContain('(');
  });
});

/*
 * 060 FR-045 (supersedes 006 FR-072's and FR-082's disabled rows for an open file): once the file is
 * open in an editor anywhere, Last Active Editor and New Editor give way to ONE Current Editor row,
 * which focuses that editor. A file is never moved between editors.
 */
describe('describeOpenInTargets — a file that is not open (006 FR-072)', () => {
  it('offers Last Active Editor and New Editor, both available, and no Current Editor', () => {
    const targets = describeOpenInTargets(facts());
    expect(one(targets, 'lastActive').disabled).toBe(false);
    expect(one(targets, 'new').disabled).toBe(false);
    expect(byKind(targets, 'current')).toHaveLength(0);
  });
});

describe('describeOpenInTargets — a file already open (060 FR-045)', () => {
  it.each([
    ['open in another editor', { alreadyOpen: true, lastActiveHoldsFile: false }],
    ['open in the last active editor', { alreadyOpen: true, lastActiveHoldsFile: true }],
    // `lastActiveHoldsFile` is this window's editor state and `alreadyOpen` main's answer; they can
    // disagree for a moment, and either one saying the file is open is enough.
    ['held here before main has said so', { alreadyOpen: false, lastActiveHoldsFile: true }],
  ] as const)('%s: one available Current Editor row in place of Last Active and New', (_name, over) => {
    const targets = describeOpenInTargets(facts(over));
    expect(one(targets, 'current')).toMatchObject({ label: 'Current Editor', disabled: false });
    expect(byKind(targets, 'lastActive')).toHaveLength(0);
    expect(byKind(targets, 'new')).toHaveLength(0);
  });

  it('draws Current Editor first, and keeps every other tab drawn but disabled', () => {
    const targets = describeOpenInTargets(
      facts({ alreadyOpen: true, otherTabs: [{ id: 'tab-2', title: 'Docs' }] }),
    );
    expect(targets.map((t) => t.kind)).toEqual(['current', 'tab']);
    expect(byKind(targets, 'tab').map((t) => t.disabled)).toEqual([true]);
  });
});

describe('describeOpenInTargets — no active tab', () => {
  it('every target is unavailable with no active tab', () => {
    const targets = describeOpenInTargets(
      facts({ activeTabId: undefined, otherTabs: [{ id: 'tab-2', title: 'Docs' }] }),
    );
    expect(targets.every((t) => t.disabled)).toBe(true);
  });
});

describe('describeOpenInTargets — Other Tab (006 FR-030)', () => {
  it('is absent, not disabled, when there is no other tab', () => {
    /*
     * The one place Constitution VI's split lands on ABSENT. A control that is temporarily
     * unavailable is drawn and disabled; one that is structurally meaningless is not drawn — and a
     * flyout naming a SET is meaningless over an empty set. Asserted at both levels, because the
     * menu row is what the user sees and the target list is what decides it.
     */
    expect(byKind(describeOpenInTargets(facts()), 'tab')).toHaveLength(0);
    expect(openInMenuActions(describeOpenInTargets(facts()), () => undefined)).toHaveLength(2);
  });

  it('lists every other tab, in layout order, carrying its own id', () => {
    const targets = byKind(
      describeOpenInTargets(
        facts({
          otherTabs: [
            { id: 'tab-2', title: 'Docs' },
            { id: 'tab-3', title: 'Notes' },
          ],
        }),
      ),
      'tab',
    );
    expect(targets.map((t) => t.label)).toEqual(['Docs', 'Notes']);
    expect(targets.map((t) => t.tabId)).toEqual(['tab-2', 'tab-3']);
  });

  it('disables every entry once the file is open anywhere', () => {
    const targets = byKind(
      describeOpenInTargets(facts({ alreadyOpen: true, otherTabs: [{ id: 'tab-2', title: 'Docs' }] })),
      'tab',
    );
    expect(targets.map((t) => t.disabled)).toEqual([true]);
  });
});

describe('openInMenuActions — the rows the two menus share', () => {
  const withTabs = (): OpenInTarget[] =>
    describeOpenInTargets(facts({ otherTabs: [{ id: 'tab-2', title: 'Docs' }] }));

  it('draws the two editor targets then the Other Tab parent, in that order', () => {
    const rows = openInMenuActions(withTabs(), () => undefined);
    expect(rows.map((r) => r.label)).toEqual([
      'Last Active Editor (Scratch)',
      'New Editor',
      'Other Tab',
    ]);
  });

  it('puts every row in the navigate section, so the flyout derives no divider', () => {
    const rows = openInMenuActions(withTabs(), () => undefined);
    const sections = [...rows, ...(rows.at(-1)?.submenu ?? [])].map((r) => r.section);
    expect(new Set(sections)).toEqual(new Set(['navigate']));
  });

  it('leaves the test ids to default from the labels, which live E2E routes depend on', () => {
    /*
     * The deliberate exception to this codebase's derive-the-id-from-the-action rule, pinned so the
     * next person to "fix" it finds out here rather than in the E2E tier. `menu-item-New Editor` is
     * the route two end-to-end specs use to create a second editor panel, and the composed
     * `menu-item-Last Active Editor (Scratch)` is what proves the panel-title suffix is composed
     * rather than constant.
     */
    const rows = openInMenuActions(withTabs(), () => undefined);
    expect(rows.every((r) => r.testId === undefined)).toBe(true);
  });

  it('hands the chosen target back rather than acting on it', () => {
    // `pick` is why one builder can serve two surfaces: the explorer performs immediately, and the
    // Find in Files panel sends the target back through its registered opener.
    const pick = vi.fn();
    const rows = openInMenuActions(withTabs(), pick);

    rows[1]?.onClick?.();
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new' }));

    rows.at(-1)?.submenu?.[0]?.onClick?.();
    expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'tab', tabId: 'tab-2' }));
  });

  it('carries the disabled state through to the drawn rows, parent and leaf alike', () => {
    const rows = openInMenuActions(
      describeOpenInTargets(facts({ alreadyOpen: true, otherTabs: [{ id: 'tab-2', title: 'Docs' }] })),
      () => undefined,
    );
    expect(rows.map((r) => r.label)).toEqual(['Current Editor', 'Other Tab']);
    expect(rows[0]?.disabled).toBe(false);
    expect(rows.at(-1)?.submenu?.[0]?.disabled).toBe(true);
  });

  it('hands Current Editor back as its own kind (060 FR-045)', () => {
    const pick = vi.fn();
    openInMenuActions(describeOpenInTargets(facts({ alreadyOpen: true })), pick)[0]?.onClick?.();
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'current' }));
  });
});
