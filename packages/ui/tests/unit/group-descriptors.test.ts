/**
 * `groupDescriptors` — the one grouper the three preference tabs share (040 FR-036).
 *
 * ══ WHY THIS FILE EXISTS AT ALL ══
 *
 * The helper is pure, synchronous and dependency-free: arrays in, arrays out, no React, no DOM, no
 * `@throng/core` beyond a type import. Until now every rule it implements was reachable only
 * through a jsdom render of one of the three tabs — which means an ordering rule was being asserted
 * by mounting a component, mocking a registry module and reading `compareDocumentPosition`. Those
 * component tests are still the right place to assert what the tabs RENDER; they are the wrong
 * place to be the only assertion of what the helper COMPUTES, because a rule with no test at its
 * own layer is a rule that can only be re-checked at the cost of three renders.
 *
 * ══ WHAT THE COMPONENT TESTS CANNOT REACH ══
 *
 * Two of the cases below have no component-level expression. Interleaved declarations (a subgroup
 * re-entered after a different one) would need a registry contrived for it in all three tabs, and
 * the empty-string subgroup — the FR-036c hole fixed alongside this file — renders as a heading
 * with no text, which is exactly the kind of thing a DOM query finds hardest to say anything about.
 * Here they are two lines each.
 *
 * ══ ANTI-VACUITY ══
 *
 * Every assertion names the descriptors it expects, in order, rather than checking a length or a
 * membership. An empty result fails every test in the file.
 */
import { describe, expect, it } from 'vitest';
import type { FieldDescriptor } from '@throng/core';
import { groupDescriptors } from '../../src/renderer/preferences/group-descriptors.js';

/** A descriptor with only the fields the grouper reads; the rest are filler it never touches. */
function field(key: string, group: string, subgroup?: string): FieldDescriptor {
  return {
    key,
    label: key,
    description: `${key} description`,
    group,
    ...(subgroup === undefined ? {} : { subgroup }),
    control: 'toggle',
  };
}

/** The keys a grouping produced, flattened, so an assertion can name them in order. */
const keys = (items: readonly FieldDescriptor[]): string[] => items.map((d) => d.key);

describe('first-appearance ordering (FR-036a)', () => {
  it('orders GROUPS by first appearance, not alphabetically', () => {
    const grouped = groupDescriptors([
      field('z.one', 'Zulu'),
      field('a.one', 'Alpha'),
      field('z.two', 'Zulu'),
    ]);
    expect(grouped.map((g) => g.group)).toEqual(['Zulu', 'Alpha']);
  });

  it('orders SUBSECTIONS by first appearance, not alphabetically', () => {
    // The distinction only shows when the two disagree, so the names are reverse-alphabetical.
    const [editor] = groupDescriptors([
      field('e.beta', 'Editor', 'Beta'),
      field('e.alpha', 'Editor', 'Alpha'),
    ]);
    expect(editor.subgroups.map((s) => s.subgroup)).toEqual(['Beta', 'Alpha']);
  });

  it('keeps declaration order INSIDE a subsection', () => {
    const [editor] = groupDescriptors([
      field('e.second', 'Editor', 'Status Bar'),
      field('e.first', 'Editor', 'Status Bar'),
    ]);
    expect(keys(editor.subgroups[0].items)).toEqual(['e.second', 'e.first']);
  });
});

describe('ungrouped fields come first (FR-036b)', () => {
  it('separates a group’s loose fields from its subsections, whatever the declaration order', () => {
    /*
     * The loose field is declared LAST here. FR-036b is a rendering rule, not a re-ordering of the
     * registry: a field with no subgroup must land above every subsection even when the registry
     * put it below one, or an author who appends a plain setting to a group that has since grown a
     * subsection finds it silently filed under a heading it does not belong to.
     */
    const [editor] = groupDescriptors([
      field('e.sub', 'Editor', 'Status Bar'),
      field('e.loose', 'Editor'),
    ]);
    expect(keys(editor.items)).toEqual(['e.loose']);
    expect(keys(editor.subgroups[0].items)).toEqual(['e.sub']);
  });

  it('gives a group with no subgroups an empty `subgroups`, unchanged from before 040 (FR-035)', () => {
    const [terminal] = groupDescriptors([field('t.one', 'Terminal'), field('t.two', 'Terminal')]);
    expect(terminal.subgroups).toEqual([]);
    expect(keys(terminal.items)).toEqual(['t.one', 't.two']);
  });
});

describe('interleaved declarations merge into one bucket', () => {
  it('re-enters a subgroup declared earlier rather than starting a second one', () => {
    /*
     * `Alpha`, `Beta`, `Alpha`. A grouper that appended a bucket per descriptor — or keyed on the
     * PREVIOUS descriptor's subgroup, which is the shape a naive run-length implementation takes —
     * would emit `Alpha` twice, and the tab would render two identical `<h4>` headings with the
     * same `data-testid`. Duplicate ids are the failure that follows, and they are silent.
     */
    const [editor] = groupDescriptors([
      field('e.a1', 'Editor', 'Alpha'),
      field('e.b1', 'Editor', 'Beta'),
      field('e.a2', 'Editor', 'Alpha'),
    ]);
    expect(editor.subgroups.map((s) => s.subgroup)).toEqual(['Alpha', 'Beta']);
    expect(keys(editor.subgroups[0].items)).toEqual(['e.a1', 'e.a2']);
    expect(keys(editor.subgroups[1].items)).toEqual(['e.b1']);
  });

  it('re-enters a GROUP declared earlier the same way', () => {
    const grouped = groupDescriptors([
      field('e.one', 'Editor'),
      field('t.one', 'Terminal'),
      field('e.two', 'Editor'),
    ]);
    expect(grouped.map((g) => g.group)).toEqual(['Editor', 'Terminal']);
    expect(keys(grouped[0].items)).toEqual(['e.one', 'e.two']);
  });
});

describe('every bucket is created lazily, and that is what makes FR-036c free', () => {
  it('constructs no subsection for a subgroup whose fields the caller filtered out', () => {
    /*
     * FR-036c — "under an active search, a subgroup whose fields are all filtered out disappears
     * WITH ITS HEADING". The tabs group the already-filtered `matches`, so the requirement costs
     * nothing PROVIDED the grouper never seeds a bucket from anything but the descriptors handed
     * to it. This is that property stated directly: the survivor list is what the caller passed,
     * and the vanished subgroup is not merely empty, it does not exist.
     */
    const registry = [field('e.loose', 'Editor'), field('e.sub', 'Editor', 'Status Bar')];
    const [editor] = groupDescriptors(registry.filter((d) => d.key === 'e.loose'));
    expect(editor.subgroups).toEqual([]);
    expect(keys(editor.items)).toEqual(['e.loose']);
  });

  it('constructs no section at all for a group whose every field was filtered out', () => {
    const registry = [field('e.one', 'Editor'), field('t.one', 'Terminal')];
    const grouped = groupDescriptors(registry.filter((d) => d.group === 'Editor'));
    expect(grouped.map((g) => g.group)).toEqual(['Editor']);
  });

  it('returns nothing for an empty registry', () => {
    expect(groupDescriptors([])).toEqual([]);
  });
});

describe('an empty subgroup string is no subgroup (FR-036c)', () => {
  it('treats `subgroup: ""` as absent rather than opening a nameless subsection', () => {
    /*
     * A strict `=== undefined` check answers "yes, it has one" for the empty string, and the tabs
     * then render `<h4></h4>` inside a `<div data-testid="settings-subgroup-Editor-">` — a heading
     * with no words, and an id ending in a bare hyphen. FR-036c forbids a heading with nothing
     * under it; a heading that is nothing is the same defect arrived at from the other side, and
     * it is worse, because a search cannot empty it and no assertion in the three tabs' component
     * files could see it.
     *
     * Falsy rather than a second `=== ''` comparison: the descriptor comes from a registry that is
     * hand-written today and generated tomorrow, and the value one line short of a subgroup is as
     * likely to be an unset variable as a literal empty string.
     */
    const [editor] = groupDescriptors([field('e.blank', 'Editor', ''), field('e.loose', 'Editor')]);
    expect(editor.subgroups).toEqual([]);
    expect(keys(editor.items)).toEqual(['e.blank', 'e.loose']);
  });
});
