import type { FieldDescriptor } from '@throng/core';

/**
 * Grouping a descriptor registry into sections and subsections (040 FR-036).
 *
 * ══ WHY ONE HELPER RATHER THAN THREE COPIES ══
 *
 * Three tabs group the same descriptor shape — `settings-tab.tsx`, `keybindings-tab.tsx` and
 * `themes-tab.tsx` — and before this feature two of them held a BYTE-IDENTICAL `groupDescriptors`
 * while the third held the same function plus one `continue`. Teaching subsections to three copies
 * would make three near-copies of a rule FR-036 states must be identical: "one registry cannot
 * render two ways". The whole reason the requirement binds all three tabs is that the next
 * descriptor to carry a `subgroup` must not render correctly in one and silently flat in the others.
 *
 * The RENDERING half of that requirement lives beside this, in `subsection.tsx`, for the same
 * reason and against the same three copies: `contracts/metadata.md` pins six rendering rules on all
 * three tabs, so the markup cannot be three copies either.
 *
 * ══ NO OPTIONS PARAMETER ══
 *
 * The Themes tab excludes one key (`colours.iconColour`, which is rendered beside the icon-pack
 * selector). It COMPOSES rather than configures —
 * `groupDescriptors(matches.filter((d) => !RENDERED_ELSEWHERE.has(d.key)))` — which keeps a
 * predicate hook out of a helper only one caller would ever pass one to.
 *
 * ══ EVERY BUCKET IS CREATED LAZILY, AND THAT IS FR-036c ══
 *
 * Nothing here is seeded from the unfiltered registry or from a list of known subgroup names. A
 * bucket exists only because a descriptor that survived the caller's filter asked for it, so a
 * subgroup whose every field was filtered out is never CONSTRUCTED — it cannot render an empty
 * heading, rather than being rendered and then hidden. That is the same mechanism groups have
 * always used (the tabs group `matches`, not the registry), which is why FR-036c is phrased as
 * "disappears with its heading" rather than as a special case. Seed eagerly and you invent the bug
 * the requirement forbids.
 */

/** 054 FR-050a — a third level inside a subgroup: a subsection name and its descriptors, in order. */
export interface DescriptorSubsection {
  subsection: string;
  items: FieldDescriptor[];
}

/** One subsection: a subgroup name and the descriptors that declared it, in declaration order. */
export interface DescriptorSubgroup {
  subgroup: string;
  /** Descriptors with NO `subsection`, in declaration order — rendered first, as a group's are. */
  items: FieldDescriptor[];
  /** 054 FR-050a — nested subsections in first-appearance order, created lazily like every bucket. */
  subsections: DescriptorSubsection[];
}

/** One section: its ungrouped fields first (FR-036b), then its subsections (FR-036a). */
export interface DescriptorGroup {
  group: string;
  /** Descriptors with NO subgroup, in declaration order. Rendered FIRST (FR-036b). */
  items: FieldDescriptor[];
  /** Subsections in first-appearance order — the same rule groups themselves follow (FR-036a). */
  subgroups: DescriptorSubgroup[];
}

/**
 * Group descriptors by `group`, and within a group by the optional `subgroup`.
 *
 * Both levels keep FIRST-APPEARANCE order, which for a registry read top to bottom is declaration
 * order. A descriptor with no `subgroup` lands in `items` and renders exactly as it did before 040
 * (FR-035).
 */
export function groupDescriptors(items: readonly FieldDescriptor[]): DescriptorGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, DescriptorGroup>();
  for (const d of items) {
    let group = byGroup.get(d.group);
    if (!group) {
      group = { group: d.group, items: [], subgroups: [] };
      byGroup.set(d.group, group);
      order.push(d.group);
    }
    // FALSY, not `=== undefined`. An empty string is a subgroup name the user cannot read: it
    // renders `<h4></h4>` and a test id ending in a bare hyphen, which is the empty heading FR-036c
    // forbids arrived at from the other side — and worse, because no search can empty it and the
    // three tabs' component tests cannot see it. A field one line short of a subgroup is as likely
    // to hold an unset variable as a literal '', so the check covers the shape rather than the value.
    if (!d.subgroup) {
      group.items.push(d);
      continue;
    }
    let sub = group.subgroups.find((s) => s.subgroup === d.subgroup);
    if (!sub) {
      sub = { subgroup: d.subgroup, items: [], subsections: [] };
      group.subgroups.push(sub);
    }
    // 054 FR-050a — the same rule one level down: falsy is no subsection, and a bucket exists only
    // because a surviving descriptor asked for it.
    if (!d.subsection) {
      sub.items.push(d);
      continue;
    }
    let section = sub.subsections.find((s) => s.subsection === d.subsection);
    if (!section) {
      section = { subsection: d.subsection, items: [] };
      sub.subsections.push(section);
    }
    section.items.push(d);
  }
  return order.map((group) => byGroup.get(group)!);
}

/**
 * The identity of one foldable heading within one tab (056 data-model "FoldKey").
 *
 * A JSON array of the descriptor's OWN `group` / `subgroup` / `subsection` strings, never a
 * `data-testid`: the Themes tab borrows the Settings tab's `settings-group-` test-id prefix, and
 * names carry spaces, `·`, `/` and `-`, so a joined string could collide or be ambiguous where a JSON
 * array cannot (research R4). The per-tab namespace lives in the store, not in the key.
 */
export function foldKey(group: string, subgroup?: string, subsection?: string): string {
  if (subgroup === undefined) return JSON.stringify([group]);
  if (subsection === undefined) return JSON.stringify([group, subgroup]);
  return JSON.stringify([group, subgroup, subsection]);
}

/**
 * Rows beneath every heading, by {@link foldKey} (056 FR-006, research R5). A heading counts every
 * row beneath it, descendants included, so a folded heading says what it is hiding.
 *
 * Pure and keyed from the grouping the tab already builds: totals come from the unfiltered registry's
 * groups, matches from the filtered ones, and neither costs anything per keystroke.
 */
export function groupCounts(groups: readonly DescriptorGroup[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of groups) {
    let groupTotal = g.items.length;
    for (const sg of g.subgroups) {
      let subTotal = sg.items.length;
      for (const ss of sg.subsections) {
        counts.set(foldKey(g.group, sg.subgroup, ss.subsection), ss.items.length);
        subTotal += ss.items.length;
      }
      counts.set(foldKey(g.group, sg.subgroup), subTotal);
      groupTotal += subTotal;
    }
    counts.set(foldKey(g.group), groupTotal);
  }
  return counts;
}
