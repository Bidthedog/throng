# Contract: `FieldDescriptor.subgroup`

**Feature**: 040 | **Surface**: `packages/core/src/config/metadata.ts`, consumed by all three
preference editor tabs

`FieldDescriptor` is the single registry three separate renderers read. A field added to it is a
contract between one producer and three consumers, which is why the rendering rules are pinned here
and not left to whichever tab is written first.

---

## The field

```ts
/**
 * Optional second level of grouping inside `group` (040, FR-035).
 *
 * Absent on every descriptor that existed before this feature, and a descriptor without one renders
 * exactly as it always has.
 */
subgroup?: string;
```

**One level only.** There is no `subsubgroup` and no recursion. The requirement was a hierarchy for
the status-bar settings, and one level satisfies it; a general tree is a renderer nobody needs and
three tabs' worth of code to maintain.

---

## Rendering rules — binding on all three tabs

`settings-tab.tsx`, `keybindings-tab.tsx` and `themes-tab.tsx` each implement their own grouping over
this one registry. **All three must implement these rules** (FR-036), or one registry renders two
ways and the next descriptor to carry a subgroup renders correctly in one tab and silently flat in
the others.

| # | Rule | Requirement |
|---|---|---|
| 1 | A subgroup renders as a **subsection inside its group's section** | FR-036a |
| 2 | Subsections appear in **declaration order** — the same rule groups already follow | FR-036a |
| 3 | A subsection is **not collapsible** | FR-036a |
| 4 | Fields with **no subgroup render first**, above every subsection | FR-036b |
| 5 | Under an active search, a subgroup whose fields are all filtered out **disappears with its heading** | FR-036c |
| 6 | A descriptor with no `subgroup` renders **exactly as before this feature** | FR-035 |
| 7 | A subsection is a **labelled group to assistive technology** — `role="group"` with `aria-labelledby` pointing at its heading, not an anonymous `<div>` | FR-015 – FR-018's spirit |

**Rule 7 was added after the fact, and the reason is worth recording.** The first implementation put
the subsection markup in all three tabs — three copies of the same `<div>` + `<h4>`. An adversarial
review pointed out that this is the duplication FR-036 exists to prevent: the *grouping* had been
extracted (it was already byte-identical, and was the easy half), while the **rendering** — which is
what "one registry cannot render two ways" actually binds — became three near-copies with only one
of them tested. Changing any rendering rule would have meant three edits with nothing failing if one
were missed.

Extracting a single `Subsection` component fixed that, and made rule 7 cheap enough to be obvious:
with one place to add `role`/`aria-labelledby`, there was no reason not to. It is stated here because
the contract otherwise understates what the three tabs now guarantee.

### Why rule 3 rather than a collapse control

The `<section>` elements that *contain* these subsections are not collapsible today
(`settings-tab.tsx:414` renders a plain `<section>` with an `<h3>`). A subsection that folds inside a
section that cannot is the odd one out, and minimisable grouping is #292's, on a different surface.

### Why rule 5 is not "hide the heading if empty"

It is the same rule the existing grouping already obeys: grouping runs over the **already-filtered**
descriptor list (`settings-tab.tsx:168` groups `matches`, not the whole registry), so a group with no
surviving fields never gets constructed at all. Subgroups inherit that mechanism rather than adding a
special case, which is why the rule is phrased as "disappears with its heading" rather than "is
hidden".

---

## What this contract does NOT change

- **No `ControlKind` is added.** `subgroup` is a descriptor field, not a control type, so 007 FR-028's
  exhaustively-declared **control vocabulary** is untouched and **#79 is unaffected**. This is worth
  stating because "we extended the descriptor" sounds like it should touch the vocabulary, and a
  reviewer who assumes it does will look for a spec conflict that is not there.
- **No key, default or control type changes** (FR-039).
- **The Keybindings and Themes tabs declare no subgroups in this feature.** They gain the *ability* to
  render one so the registry cannot diverge; nothing in them moves (US3 scenario 9).

---

## Test id convention

`settings-tab.tsx:414` already emits `data-testid={\`settings-group-${group}\`}`. A subsection needs
its own id or a test cannot tell a subsection from the section containing it. Use
`settings-subgroup-${group}-${subgroup}` — group-qualified, because two groups may one day both have
a `Status Bar` subsection and an unqualified id would match both.

**Do NOT slugify it.** The shipped ids are the raw group strings, spaces, middle dots and all —
`settings-group-Editor · Navigation`, `settings-group-Editor · Indentation`,
`settings-group-File Explorer`. Slugifying only the new subsection id would make it the one id in the
registry that does not match its group string, which is worse than an id with a space in it: a test
author reading the file cannot tell which convention applies to what. So the id for this feature's
subsection is literally:

```
settings-subgroup-Editor-Status Bar
```

Ugly, and consistent — and consistency is what a test id is for.

**Each tab uses its own prefix**, because each already does for groups:

| Tab | Group id (shipped) | Subgroup id (this feature) |
|---|---|---|
| Settings | `settings-group-${group}` | `settings-subgroup-${group}-${subgroup}` |
| Keybindings | `keybindings-group-${group}` | `keybindings-subgroup-${group}-${subgroup}` |
| Themes | `settings-group-${group}` — **it borrows the Settings tab's prefix** (`themes-tab.tsx:646`) | **`themes-subgroup-${group}-${subgroup}`** — deliberately NOT `settings-subgroup-…`: the group ids already collide across the two tabs, and there is no reason to *extend* that collision into the ids this feature adds |

All unslugified. The keybindings and themes registries declare no subgroups in this feature, so
their subsection ids are exercised only by a test that **injects a synthetic descriptor** — which is
the point of asserting them at all: the renderer must be correct before the first real subgroup
arrives, not after.

**How the synthetic descriptor is injected** is the tab's own affair and must be settled by whoever
writes the test, but it has to be settled *explicitly* rather than assumed: neither tab takes a
descriptor list as a prop today, so the test either mocks the registry module or the tab gains a
test-only seam. A test that cannot inject one can only assert the no-op half, and should say so
rather than appearing to cover the renderer.
