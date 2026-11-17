# Feature Specification: No Inert Settings Guard

**Feature Branch**: `feature/S071-I108-inert-settings-guard`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: issue [#108](https://github.com/Bidthedog/throng/issues/108), "Fleet-wide 'no inert
settings' guard", picked from the v1.0.0 backlog as group G2 (maintainer, 2026-11-17).

## Background

A setting is **inert** when it is declared, defaulted, saved and shown as a live control in Preferences, but nothing
in the application reads it. The user changes it, the change is saved, and nothing happens. `explorer.openMode`
shipped like that for a year (#95), until feature 019 removed it.

The policy already exists. 019 FR-022 says a control that governs nothing must not ship. **Nothing enforces it
across the whole Settings tab.** 019 declined to build the guard (its clarification C16, resolving Open Question 9),
because the only cheap version, a text search for each setting's name, was measured and found unsound: **11 false
positives**. Settings are routinely read through an aliased section object, so the full key never appears where the
value is used:

```ts
const explorerSettings = settings.explorer;
// …later, nowhere near the text "explorer.dragCopyModifier":
if (e.getModifierState(explorerSettings.dragCopyModifier)) { … }
```

Since then, ten features (040, 043, 044, 047, 049, 054, 055, 057, 068 and 070) each added a
`settings-inertness-NNN.test.ts` that checks only that feature's own keys, using the same kind of text match
(the setting's last name segment). Each guards a handful of the 150 Settings descriptors. Together they still
leave most of the tab unguarded, and every one inherits the unsoundness 019 measured.

### What this feature is, and is not

- **It is** one check, covering every Settings descriptor, that fails the build when a descriptor has no reader
  outside the configuration layer, and that cannot be fooled by aliasing.
- **It is not** proof that a setting's effect is correct. A reader shows that the setting is wired to something. Each
  feature's own tests show that it does the right thing.
- **It is not** a text search. 019 measured that approach and rejected it, and this spec does not reopen that.

## Clarifications

### Session 2026-11-17

- Q: Is a spec needed, or is this a direct fix? → A: **A spec.** It chooses how reads are resolved, may refactor how
  settings are read, and has to triage whatever inert settings the first run finds. (Maintainer: "Start G2 … then
  build one with speckit".)
- Q: Which registries are in scope? → A: **The Settings tab only (every settings descriptor).** Key bindings are
  bound to commands that the command registry already checks. Theme tokens are checked by the theme quality
  guards. → FR-001, Assumptions. (Derived from the issue's scope: "every rendered setting descriptor".)
- Q: What happens to an inert setting the first run finds? → A: **It is triaged, never suppressed.** If a requirement
  still names the behaviour the setting should govern, the setting is a defect and gets wired. If that requirement was
  withdrawn, the setting is removed, with a supersession written here. A setting that is meant to be read only by the
  configuration layer goes on the allowlist with its reason. → FR-010–FR-012. (Derived from the issue's
  acceptance criteria: "listed and triaged, not suppressed".)
- Q: Do the ten per-feature inertness tests stay? → A: **Their reader checks are superseded** by this guard. Any
  assertion in them that is not about whether the setting has a reader is kept, or moved next to the code it checks.
  → FR-014. (Derived: two checks of the same property, one of them unsound, disagree sooner or later.)

## User Scenarios & Testing *(mandatory)*

The people this feature serves are **contributors**, and through them **users**. A contributor finds out from the
build, not from a bug report, that a control they added does nothing. A user never meets a Preferences control that
saves a value and changes nothing.

### User Story 1 - A new setting nobody reads fails the build (Priority: P1)

A contributor adds a setting and its Preferences control, but forgets to wire the value into the code it should
govern. The build fails, naming the setting and saying that nothing outside the configuration layer reads it.

**Why this priority**: This is the whole point of the issue. #95's failure was invisible until a user noticed.

**Independent Test**: Add a descriptor and a default for a new key that nothing reads, then run the check. It fails
and names that key. Remove the descriptor and it passes.

**Acceptance Scenarios**:

1. **Given** a new Settings descriptor whose key has no reader outside the configuration layer, **When** the check
   runs, **Then** it fails, and its message names that key and says it has no reader.
2. **Given** several unread descriptors, **When** the check runs, **Then** one failure lists every one of them, not
   just the first.
3. **Given** a key mentioned only in the configuration layer (its declaration, default, descriptor, shipped
   defaults, bounds guard, search, override detection or the Preferences form), **When** the check runs, **Then**
   none of those mentions counts as a reader.

---

### User Story 2 - Removing the last reader of a setting fails the build (Priority: P1)

A contributor refactors code and deletes the only place that read a setting, leaving its control in Preferences.
The build fails in the same way.

**Why this priority**: A refactor that unplugs a setting is the likelier way to make one inert, and no per-feature
test covers settings outside its own feature.

**Independent Test**: Comment out the only reader of an existing setting and run the check. It fails and names that
setting.

**Acceptance Scenarios**:

1. **Given** an existing setting with exactly one reader, **When** that reader is removed, **Then** the check fails
   and names the setting.
2. **Given** an existing setting with two readers, **When** one is removed, **Then** the check still passes.

---

### User Story 3 - No false alarms from the ways settings are really read (Priority: P1)

The check gives no false positives on code that does read a setting, however that code reaches the value: through
an aliased section object, by destructuring, through a whole section passed to a helper, or by an index whose value
is one of several sibling keys.

**Why this priority**: 019 measured that a guard which cries wolf gets deleted or switched off within a week, which
is worse than having no guard. Soundness is the acceptance test, not a refinement.

**Independent Test**: Run the check against the current code base. Every one of the settings that 019's text search
called inert while the code read them through an alias, `explorer.dragCopyModifier` among them, passes. So does
every setting that is demonstrably read.

**Acceptance Scenarios**:

1. **Given** `const s = settings.explorer; s.dragCopyModifier`, **When** the check runs, **Then**
   `explorer.dragCopyModifier` counts as read.
2. **Given** `const { showCounts } = settings.editor.statusBar`, **When** the check runs, **Then**
   `editor.statusBar.showCounts` counts as read.
3. **Given** a section passed whole to a helper that reads one of its fields, **When** the check runs, **Then** that
   field's key counts as read.
4. **Given** a read by a computed index such as `notifications[severity].toast`, where the index's type allows
   several sibling keys, **When** the check runs, **Then** every key that index can reach counts as read.
5. **Given** two keys of the same shape in different sections (`panes.projects.maxWidth` and
   `panes.fileExplorer.maxWidth`), **When** only one is read by its own path, **Then** the other is **not** counted
   as read through it.

---

### User Story 4 - Today's inert settings are found and resolved (Priority: P2)

The first run over all 150 descriptors reports any settings that really are inert. Each is resolved before this
feature ships: wired, removed, or allowlisted with a written reason.

**Why this priority**: The issue expects the guard to find real inert settings. A guard that ships red, or ships
with its findings switched off, protects nothing.

**Independent Test**: The spec records the first run's list and the outcome for each entry, and the check passes
with no unexplained entries.

**Acceptance Scenarios**:

1. **Given** the first run's findings, **When** this feature is complete, **Then** each one appears in this spec with
   its outcome (wired, removed or allowlisted) and the reason.
2. **Given** a setting that was wired, **When** a user changes it in Preferences, **Then** the behaviour it names
   changes.
3. **Given** a setting that was removed, **When** a user opens Preferences, **Then** its control is gone, and a
   value already saved for it is dropped as an unmodelled key without any error.

---

### User Story 5 - Contributors can see where a setting is read (Priority: P3)

When the check fails, or when a contributor wants to know what a setting drives, they can get a list of every
setting with the files that read it.

**Why this priority**: A guard that only says "fine" or "no" teaches nothing about where to look. The per-feature
tests already print this list for their own keys, and the fleet-wide check must not lose it.

**Independent Test**: Run the check's report and find `explorer.dragCopyModifier` listed with at least one reading
file outside the configuration layer.

**Acceptance Scenarios**:

1. **Given** the check runs, **When** a contributor asks for its report, **Then** every Settings key is listed with
   the files outside the configuration layer that read it.

### Edge Cases

- **A setting read only by key name in a generic routine** (for example, a loop over every descriptor): this is not
  a reader, because it proves only that the setting exists. If such a setting really is meant to act only that way,
  it goes on the allowlist with its reason.
- **A setting read by a key-path string** (such as `'explorer.sortOrder'` passed to a lookup): this is not a reader,
  because a string is text and FR-009 bars deciding readership from text. Code that acts on a setting reads it
  through the typed settings object. The first run found no setting read only this way.
- **A map-shaped setting** (`editor.indentByLanguage`, `editor.languageByExtension`) is read when the map itself is
  read. Entries are user data, not keys.
- **A descriptor that covers a whole object** (a table such as terminal flavours) is read when that object, or any
  of its fields, is read outside the configuration layer.
- **A setting read in a different process from the one that renders it** (main, daemon or renderer): every
  production package counts. Test files never count.
- **A reader that exists only in a test or a test helper**: not a reader.
- **An allowlist entry for a setting that has since gained a reader, or whose descriptor is gone**: the check fails
  on the stale entry, so the allowlist cannot quietly grow.
- **An allowlist entry with an empty or placeholder reason**: the check fails.

## Requirements *(mandatory)*

### Functional Requirements

**Coverage**

- **FR-001**: The check MUST cover every descriptor in the Settings registry, the one the Preferences Settings tab
  renders, with no per-feature list of keys to keep up to date. A descriptor added later is covered automatically.
- **FR-002**: The check MUST run as part of the gating build that CI runs on every pull request, and a finding MUST
  fail that build.

**What counts as a reader**

- **FR-003**: A setting is **read** when production code outside the configuration layer reads its value, as
  resolved by the language's type checker: a property access, an element access or a destructuring that denotes
  that setting.
- **FR-004**: Reads MUST resolve through aliases (a section object bound to a local name), destructuring, and
  sections or sub-objects passed to helpers as typed parameters.
- **FR-005**: A read by a computed index MUST count for every key that the index's type allows it to reach, and for
  no other.
- **FR-006**: A read MUST be attributed to the key path it denotes. A read of one key MUST NOT count for another key
  of the same shape in a different section (`panes.projects.maxWidth` against `panes.fileExplorer.maxWidth`).
  Where the code genuinely cannot be attributed to one path (a helper typed on a shared shape and called with
  more than one section), the read counts for every path that the calls to it supply.
- **FR-007**: The **configuration layer** MUST NOT count as a reader. It covers the code that handles settings
  generically, by key or by path, rather than acting on any one value: the declaration, parsing, defaults,
  descriptor registry, shipped defaults and validation, and the by-path machinery (bounds guard, settings search,
  override detection, config patching and the Preferences form). Code that loads, stores or watches the settings
  file **and** acts on a particular value is a reader of that value, for example choosing the active theme file
  by `appearance.theme`. The check MUST name the layer's modules in one place, so that adding a module to the
  layer is a reviewed change.
- **FR-008**: Test files and test helpers MUST NOT count as readers.
- **FR-009**: The check MUST NOT decide readership by searching source text for a setting's name or any part of it.
  (019 C16: measured unsound, 11 false positives.)

**Findings and the allowlist**

- **FR-010**: A failure MUST name every unread setting in one message and say that nothing outside the
  configuration layer reads it.
- **FR-011**: A setting meant to be read only by the configuration layer MAY be listed on an allowlist. Each entry
  MUST carry a written reason. The check MUST fail on an entry with no reason, an entry whose setting now has a
  reader, and an entry whose setting no longer has a descriptor.
- **FR-012**: Every inert setting found on the first run MUST be resolved before this feature ships, and recorded in
  this spec under *First-run findings* with its outcome:
  - **wired** — a requirement still names the behaviour the setting should govern, so the setting is a defect and
    gets connected to that behaviour, with a test that shows the effect;
  - **removed** — the requirement that gave it a purpose was withdrawn, so the descriptor, default and control go,
    and a supersession names the requirement this retires. A saved value becomes an unmodelled key and is dropped
    without error on the next write (019 FR-023);
  - **allowlisted** — under FR-011.
  The check MUST NOT be weakened, and no finding suppressed, to make the first run pass.
- **FR-013**: The check MUST be able to produce a report listing every Settings key with the files outside the
  configuration layer that read it.

**Supersession**

- **FR-014**: The reader checks in the ten per-feature inertness tests (`settings-inertness-040`, `-043`, `-044`,
  `-047`, `-049`, `-054`, `-055`, `-057`, `-068` and `-070`) are **superseded** by this guard and removed. Any other
  assertion in those files, such as a descriptor existing or a default value, MUST be kept, either in place or moved
  beside the code it checks. This supersedes 040 FR-052's enforcement mechanism, and the corresponding inertness
  requirements of 043, 044, 047, 049, 054, 055, 057, 068 and 070. The policy each states, that a feature adds no
  inert setting, is unchanged and is now enforced here.
- **FR-015**: 019 FR-022's policy, that a control which governs nothing must not ship, MUST now be enforced
  fleet-wide by this check. This closes the deferral recorded in 019 C16 and Open Question 9.

**Behaviour**

- **FR-016**: Apart from settings that FR-012 wires or removes, this feature MUST NOT change any user-visible
  behaviour, setting key, default or control.

### Key Entities

- **Settings descriptor**: one entry in the Settings registry. It has a key path, and Preferences renders a control
  for it. This is the unit the check covers.
- **Reader**: a place in production code outside the configuration layer where the type checker resolves a read of a
  setting's value.
- **Configuration layer**: the named set of modules whose mentions of a setting prove only that it exists.
- **Allowlist entry**: a setting key with a written reason why only the configuration layer reads it.
- **Finding**: an unread setting that is not on the allowlist. It fails the build.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every one of the Settings descriptors (150 at the time of writing) is checked on every pull request,
  with no list of keys to maintain by hand.
- **SC-002**: Against the current code base, the check reports **zero false positives**. Every setting it reports
  as unread really has no reader, as confirmed by reading the code. That includes the settings 019's text search
  misreported, `explorer.dragCopyModifier` among them.
- **SC-003**: Adding a descriptor with no reader, or deleting the only reader of an existing setting, fails the
  build. This is shown by a test that does each against a fixture.
- **SC-004**: When the feature ships, the check passes with every first-run finding resolved and recorded, and
  every allowlist entry carries a reason.
- **SC-005**: The check adds no more than 60 seconds to a CI gate run.
- **SC-006**: The ten per-feature reader checks are gone, and no assertion they held that was not about
  readership is lost.

## First-run findings

**First full run, 2026-11-17, on the branch's base `442ad306` with the guard added: 150 Settings descriptors
scanned, 0 unread.** No setting is wired or removed by this feature, and `INERT_ALLOWLIST` ships empty.

The zero is not leniency. The same run with two real readers hidden (`explorer/file-tree.tsx` and
`workspace/destroy.ts` treated as configuration layer) reports exactly the ten settings those files read
(research R5). The ten per-feature guards, and 019's removal of `explorer.openMode`, had already caught what
this guard would have found.

## Assumptions

- The Settings registry is the authority on what Preferences renders. A key with no descriptor is not inert but
  invisible, which the configuration-editor completeness test already owns.
- Key bindings and theme tokens are out of scope. A key binding's descriptor names a command, and the command
  registry and its tests show the command runs. A theme token is checked by the theme quality and contrast guards.
  If either turns out to have an inertness gap, it gets a follow-up issue, not scope here.
- Resolving reads through the type checker is enough for soundness. Generating a typed accessor per key, and
  rewriting every reader to use it, is the alternative the issue allows. The plan chooses between them, preferring
  whichever covers FR-003 to FR-006 without rewriting every reader.
- The check runs inside an existing gating stage, so it needs no new CI job.
- A reader shows that the setting is wired, not that its effect is correct. Each feature's own tests own
  correctness.
- PR #633 (spec 069) has merged, so the settings registry's grouping is stable while this work runs.
