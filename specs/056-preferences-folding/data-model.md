# Data Model: Fold and Unfold Preferences Sections (056)

## FoldKey

Identity of one foldable heading within one tab.

| Field | Type | Notes |
|---|---|---|
| value | string | `JSON.stringify([group])`, `JSON.stringify([group, subgroup])` or `JSON.stringify([group, subgroup, subsection])` |

- Built from the descriptor's own `group` / `subgroup` / `subsection` strings, **never** from a
  `data-testid` (the Themes tab shares the `settings-group-` test-id prefix with Settings — research R4).
- The Themes tab's hand-built Icons section is `["Icons"]` in the `themes` namespace.

## PreferencesFoldState (persisted)

`localStorage["throng.preferences.folds"]`, JSON:

```json
{
  "v": 1,
  "settings":    ["[\"Editor\"]", "[\"Editor\",\"Previews\"]"],
  "keybindings": [],
  "themes":      ["[\"Icons\"]"]
}
```

| Field | Type | Rule |
|---|---|---|
| v | `1` | Schema version; any other value, or unparseable JSON, reads as empty (all unfolded, FR-012) *(superseded: see Version 2 below)* |
| settings / keybindings / themes | `string[]` of FoldKey | Keys of headings the **user** folded. A missing array reads as empty |

- **Only folded keys are stored.** Absent = unfolded. So a heading that is new since the state was written
  opens unfolded, and a key naming a heading that no longer exists matches nothing (FR-011a).
- **Writes**: on every user fold change outside a search (click, keyboard, Expand All, Collapse All). A
  write rewrites only its own tab's array and prunes keys that name no current heading in that tab.
- **Never written**: during an active search (FR-008, FR-009), or because a search unfolded something.
- Read/write failures (storage unavailable, quota) are swallowed: folding still works for the session.

### Version 2 (Session 2026-10-15, FR-016, FR-017, research R9)

**Supersedes the `v: 1` shape above.** A version 1 document is still read: each listed key becomes
`key → true`. *(Review 2026-10-15: dropped — v1 never shipped, so a v1 document reads as empty, every
heading at its default, like any other unknown version.)*

```json
{
  "v": 2,
  "settings":    { "[\"Editor\"]": false, "[\"Editor\",\"Previews\"]": true },
  "keybindings": {},
  "themes":      { "[\"Icons\"]": false }
}
```

| Field | Type | Rule |
|---|---|---|
| v | `2` (a `1` reads as empty — review 2026-10-15) | Any other value, or unparseable JSON, reads as empty: every heading at its default |
| settings / keybindings / themes | `Record<FoldKey, boolean>` | The user's **explicit** choice: `true` folded, `false` unfolded. A missing object reads as empty |

- **Default** for a key with no entry:
  - a **section** (FoldKey of length 1, `["Icons"]` included) → **folded** (FR-016);
  - a **subgroup or subsection** → **unfolded**;
  - with the test seam `foldDefault=open` (research R10), sections default to **unfolded** too.
- **Writes**: unchanged triggers. A toggle records the flipped *effective* value for that key. Expand All
  records `false` for every current key, and Collapse All records `true`. Each write prunes keys that name
  no current heading (FR-011a).

## TransientSearchFolds (in memory)

| Field | Type | Rule |
|---|---|---|
| folded | `Set<FoldKey>` | Toggles made while the debounced query is non-empty. Reset whenever the applied query changes; discarded when it clears |

**Spec's "Pre-search fold state"**: realised without a copy. A search never writes the persisted set, so
the persisted set *is* the pre-search state, and clearing the search restores it by rendering it again
(research R6).

## Effective fold state (derived, per render)

```
folded(key) =
  applied query non-empty ? searchFolds.has(key)
                          : persisted[tab].has(key)
```

Version 2 (FR-016): `persisted[tab].has(key)` becomes `persisted[tab][key] ?? defaultFor(key)`, where
`defaultFor(key)` is the section default (folded, or open under the test seam) when the key has length 1,
and unfolded otherwise. The search and debounce-gap rules are unchanged; the gap shows the *effective*
persisted state.

## HeadingCount (derived)

| Field | Type | Rule |
|---|---|---|
| total | number | Rows beneath the heading in the **unfiltered** registry, descendants included |
| matches | number | Rows beneath it in the **filtered** groups (equal to total with no search) |
| label | string | `formatGrouped(total)`; under a search `"<matches> of <total>"`, both digit-grouped |

## InvalidMarker (derived, DOM)

`true` while the heading is folded **and** its content container holds `[aria-invalid="true"]`. Observed with
an attribute-filtered `MutationObserver` attached only while folded.
