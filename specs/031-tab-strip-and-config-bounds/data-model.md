# Data Model: Tab strip overflow, name limits, and bounded configuration

**Feature**: 031 | Phase 1 output

Entities, their fields, and the rules that constrain them. Nothing here is a new persisted store —
this feature adds three settings leaves and a body of derived, in-memory state.

---

## 1. Settings (persisted — `settings.json`)

### 1.1 New leaves

**Current as of User Story 7, including the post-US7 default changes.** This feature adds **seven**
settings, all keyed `tabs.*`. The `Tabs` **group** renders **eight** rows, because FR-062 moved the
pre-existing `behaviour.tabHoverActivateMs` into it — that row is listed last and is the only one
whose key does not begin `tabs.`.

| Key | Type | Range | **Step** | Default | Requirement |
|---|---|---|---|---|---|
| `tabs.smoothScrollMs` | number | 0–**1500** | **50** | **300** | FR-030, narrowed by FR-055 |
| `tabs.closeArmingDelayMs` | number | 0–**1500** | **50** | **300** | FR-044h, narrowed by FR-056 |
| `tabs.popoverDelayMs` | number | 0–1500 | **25** | **500** | FR-058 |
| `tabs.maxNameLength` | number | 10–128 | **2** | **64** | FR-034 |
| `tabs.maxWidth` | number | 10–128 | **2** | **32** | FR-050 |
| `tabs.newTabPosition` | enum | `afterActive` \| `end` | — | `afterActive` | FR-053a |
| `tabs.chevronRepeatDelayMs` | number | 100–3000 | **50** | **350** | FR-054a |
| `behaviour.tabHoverActivateMs` | number | 0–5000 | **50** | **600** | FR-062 — **relocated, not added**; key unchanged |

**Two defaults changed after US7 shipped**, from using the strip rather than from a review:
`chevronRepeatDelayMs` 500 → **350** and `popoverDelayMs` 300 → **500**. Both remain on a slider
stop and inside their declared range, which is the only property that could have broken. No
migration exists or is needed — a stored value outside a declared range is already clamped on read,
which is the whole point of #227.

Both US7 narrowings are of **already-guarded** settings, so a stored value above the new maximum is
clamped on read and the write-back records the correction (FR-013). No migration exists or is needed
— which is exactly the property #227 was built to give.

**The steps are not free choices.** `slider-descriptors.test.ts` enforces that a slider's step is at
least **1% of its range** — "a slider you can actually aim". A step of 1 on `tabs.maxNameLength`
(range 118) is 0.85% and **fails that shipped test**, which is why the limit steps in twos. Each
step was then checked against its own default being reachable:

| Setting | Range | Step | % of range | Default reachable? |
|---|---|---|---|---|
| `tabs.smoothScrollMs` | 1500 | 50 | 3.33% | 300 = 0 + 50×6 ✓ |
| `tabs.closeArmingDelayMs` | 1500 | 50 | 3.33% | 300 = 0 + 50×6 ✓ |
| `tabs.maxNameLength` | 118 | 2 | 1.69% | 64 = 10 + 2×27 ✓ |
| `tabs.maxWidth` | 118 | 2 | 1.69% | 32 = 10 + 2×11 ✓ |
| `tabs.chevronRepeatDelayMs` | 2900 | 50 | 1.72% | 350 = 100 + 50×5 ✓ |
| `tabs.popoverDelayMs` | 1500 | 25 | 1.67% | 500 = 0 + 25×20 ✓ |

The first two ranges are the **narrowed** ones (FR-055, FR-056): the check has to be re-done against
the range that ships, not the one first proposed, or a step passes the 1% rule against a range
nobody has.

All sit in a new **`Tabs`** settings group. Each gets a `FieldDescriptor` in
`SETTINGS_METADATA` with `control: 'slider'` (the descriptor contract requires `min`, `max` and
`step` for a slider), which is what makes them editable in the Settings form (FR-047) and, more
importantly, what makes them *guarded* — the guard reads the same declaration (FR-041).

`tabs.maxNameLength` governs **both** tab names and panel names: one setting, deliberately, per
FR-033.

### 1.2 Changed behaviour on existing leaves

**Corrected after `/speckit-analyze`.** An earlier draft of this section claimed
`linkHoverDelayMs` was "the single exception" where a declared and a hand-written range disagree.
That was wrong — there are **four**, and one of them is deliberate.

| Key | Declared | Parsed today | Becomes | Requirement |
|---|---|---|---|---|
| `terminals.linkHoverDelayMs` | 0–2000 | 0–5000 | **0–2000** — declaration wins | FR-015 |
| `diagnostics.keepFiles` | 1–20 | 1–50 | **1–20** — declaration wins | FR-015 |
| `search.asYouTypeDebounceMs` | 0–1000 | 0–unbounded | **0–1000** — declaration wins | FR-015 |
| `diagnostics.maxFileSizeKb` | 64–4096 | 64–65536 | **`hardMax: 65536`** — the wider bound is *deliberate* and is now declared instead of implied | FR-015a–c |
| `terminals.commandPollMs` | 250–5000 | 250–5000 | unchanged; the hand-written clamp is removed as redundant | FR-016 |
| `editor.indentByLanguage` | columns 1–16 | unguarded | **enforced per entry** | FR-008a |

The `maxFileSizeKb` case is the one that matters. Its descriptor says the 4096 ceiling exists so the
slider stays aimable, and that "a larger cap is still settable by hand — the parser accepts up to
64 MB". Enforcing the declared max would have silently rewritten a user's deliberate 64 MB log cap
to 4 MB on the next start — a capability revoked by a change that was meant to be a safety net.

### 1.3 `hardMin` / `hardMax` (new, optional)

| Field | Meaning |
|---|---|
| `min` / `max` | The **control's** range — what the slider offers. Unchanged in meaning |
| `hardMin` / `hardMax` | The bound the **guard** enforces. Defaults to `min`/`max` when absent |

Every existing descriptor is unaffected, because absent means "same as `min`/`max`". Only
`diagnostics.maxFileSizeKb` declares one today. The point is FR-015c: a wider hard bound must be
**declared, not implied** — a comment explaining that the parser accepts more is invisible to the
guard, which is precisely how this divergence survived unnoticed.

---

## 2. Bounds-guard model (pure, in-memory)

### 2.1 `CorrectionOutcome<T>`

The value the guard returns, and the reason `FileConfigStore.read()` can honour FR-014.

| Field | Type | Meaning |
|---|---|---|
| `value` | `T` | The corrected settings document. Always usable — the guard never throws (FR-011) |
| `corrected` | `boolean` | True if **anything** was clamped, replaced or dropped. Drives write-back (FR-013), and its falsity is what prevents rewriting a clean file (FR-014) |
| `corrections` | `Correction[]` | What changed, for diagnostics and for tests that must assert *which* leaf moved |

### 2.2 `Correction`

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Dotted path, e.g. `panes.projects.maxWidth`, or `editor.indentByLanguage.python.indentWidth` for a table cell |
| `kind` | `'clamped-min' \| 'clamped-max' \| 'default-substituted' \| 'entry-restored' \| 'entry-dropped'` | Which rule fired |
| `from` | unknown | What the file said |
| `to` | unknown | What is being used |

### 2.3 Rules, in precedence order

1. **Wrong shape → shipped default.** Absent, `null`, non-finite, or not the declared type
   (FR-011, FR-012).
2. **Out of declared set → shipped default.** An enum value outside `allowedValues`; a non-boolean
   where a boolean belongs (FR-012).
3. **Out of declared range → nearest bound.** Below `min` → `min`; above `max` → `max` (FR-008).
4. **Keyed tables recurse.** Each entry's columns are corrected by rules 1–3 against the column's
   own declared bounds (FR-008a).
5. **A malformed entry is restored, then dropped.** Restored from the shipped default *for that key*
   if the defaults carry it; dropped if they do not (FR-008b, FR-008c).
6. **Absence is never corrected.** A table the user emptied stays empty where empty is legitimate;
   only a *present and malformed* entry is touched (FR-008f).

Rule 6 is what separates "the user chose nothing" from "the file is broken", and it is the rule most
likely to be got wrong: `editor.languageByExtension` ships empty and is `clearable`, while
`editor.indentByLanguage` ships populated and is not.

---

## 3. Name-limit model (pure)

| Concept | Definition |
|---|---|
| **Character** | One **grapheme cluster** (`Intl.Segmenter`, `granularity: 'grapheme'`). Not a code point, not a UTF-16 unit (FR-033a) |
| **Within the limit** | `countGraphemes(name) <= limit` |
| **Truncation** | The first `limit` grapheme clusters, joined. Never splits a cluster (FR-033b); contains no ellipsis (FR-037a); **idempotent** (FR-037b) |
| **Was truncated** | `countGraphemes(original) > limit` — the flag that drives the render-time ellipsis (FR-037c). A name exactly at the limit is **not** marked (FR-037d) |

### Where it applies

| Surface | Rule |
|---|---|
| Tab rename field | Live cap; counter appears within 10 of the limit (FR-035a) |
| Panel rename field | Identical (FR-035g) |
| Tab name from the layout | Truncated for display on read (FR-037) |
| Panel display name | Truncated on `panelDisplayTitle()`'s **result** (R8) — covers override, shell title, flavour label and file path in one place |
| Picker entries | Match against the name **as displayed** (FR-028d) — the one place a shortened name is used in preference to the stored one |

### Persistence rule (FR-040)

Shortening on read does **not** rewrite storage. The shortened form is persisted only when the
layout is next written **for another reason**. Loading a layout is not such a reason (FR-040a), so a
project opened and closed unchanged keeps its full names.

---

## 4. Tab-strip view state (in-memory only — never persisted)

| Field | Type | Derivation |
|---|---|---|
| `scrollLeft` | number | The track's live scroll offset. **View state — FR-006 forbids persisting it** |
| `hiddenLeft` | number | Count of tabs **fully** left of the viewport |
| `hiddenRight` | number | Count of tabs **fully** right of the viewport |
| `totalTabs` | number | `layout.tabs.length` |
| `overflowing` | boolean | Track scroll width > client width. Gates the whole tab-actions group (FR-019) |

"Fully hidden" is deliberate: a partly-visible tab counts as neither hidden nor requiring a step, and
it is the tab the fade marks.

### Scroll animation state

| Field | Meaning |
|---|---|
| `target` | Destination `scrollLeft`. **Replaced**, never queued, by a superseding scroll (FR-030c) |
| `from` | The track's position when the *current* scroll began — re-read on supersede, so a new scroll eases from where the strip actually is (FR-030c) |
| `startedAt` | Clock origin; reset on supersede, so the new scroll gets its full duration |
| `raf` | The single loop handle. **One per strip** — this is what makes FR-030d (no queueing) and FR-030e (no residue) structural rather than defensive |

---

## 5. Picker model (pure + view)

| Concept | Definition |
|---|---|
| **Entry** | `{ id, text, label, meta?, isCurrent? }` — `text` is what matching runs against, `label`/`meta` are what is drawn |
| **Query** | Raw input, split on whitespace into **terms** |
| **Match** | Every term is a case-insensitive substring of `text`, **in any order** (FR-028c). Empty or whitespace-only query matches everything |
| **Order** | The seeded set's own order — strip order for tabs. **Not** a relevance score (FR-028f) |
| **Highlight** | Each matched term's span within `text`, for FR-028e |

For the tab picker, `text` is the tab's **displayed** name, `label` the same, `meta` the panel count,
and `isCurrent` marks the active tab (FR-028b).

The control is deliberately generic (FR-028a): #219 seeds the same entries from project files with
`text` = full path, which is why FR-028c matches across separators.

---

## 6. Keybinding

| Action | Scope | Default (Windows) |
|---|---|---|
| `tabs.openPicker` | `EVERYWHERE` | `Ctrl+Alt+T` |

`EVERYWHERE` because FR-032a requires it at any tab count from any surface. Constitution IV is
satisfied without a recorded exception — see the Constitution Check in `plan.md`.

---

## 7. Theme icon tokens

| Token | Shipped glyph | Used by |
|---|---|---|
| `chevronLeft` | `‹` | Step-left control |
| `chevronRight` | `›` | Step-right control |
| `chevronDown` | `▾` | Show-all control |

`chevronDown` shipped as `⌄` (U+2304) and was changed to `▾` (U+25BE). U+2304 carries its ink near
the **baseline**, so the glyph sat visibly low against the two pills beside it while its *box* was
perfectly centred — which is why the first attempt to fix it by centring the box measured 52.5
against 52.5 and changed nothing. The fix was the glyph, not the geometry.

**R9, corrected twice.** Icon *descriptors* are derived from the theme document's own keys, so
nothing is hand-written in `theme-metadata.ts`. But `theme-copy.ts` holds a **separate, mandatory,
hand-written catalogue**, and `theme-copy.test.ts` fails four ways without an entry. The rule that
actually holds is: **glyph in `theme.ts`, copy in `theme-copy.ts`, nothing in `theme-metadata.ts`.**
An earlier draft of this section said no hand-written entry was needed anywhere, which is the half
of the truth that breaks the build.

The existing `collapse` / `expand` tokens are not reused: they mean tree-node state, and sharing them
would make re-skinning one silently re-skin the other.
