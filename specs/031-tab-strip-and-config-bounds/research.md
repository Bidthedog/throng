# Research: Tab strip overflow, name limits, and bounded configuration

**Feature**: 031 | **Date**: 2026-08-11 | **Constitution**: v4.4.0

Phase 0 output. Every unknown in the plan's Technical Context is resolved here, with the alternative
that was rejected and why. Nothing below is a preference — each is a claim about *this* repository
that the cited file can be checked against.

---

## R1. Which process owns settings writes (FR-013b)

**Decision**: **UI-main**, through `FileConfigStore` (`packages/ui/src/main/config-store.ts`). The
write-back goes in its `read()` path.

**Rationale**: The spec requires exactly one writer, and the repository already has one — this
research confirmed it rather than chose it.

| Process | How it touches `settings.json` |
|---|---|
| **UI-main** | `FileConfigStore.read()` / `.write()` — the only code that calls `writeFile` on it |
| **Renderer** | Never directly. Writes go over the `throng:config:write` IPC (`config-write-ipc.ts`) into UI-main |
| **Daemon** | `readFileSync` **once at startup**, falling back to shipped defaults on any problem (`packages/daemon/src/composition-root.ts:122-124`). Never writes |

So FR-013b needs no new arbitration or lock: the daemon corrects in memory (FR-013a) and stays
silent, and UI-main is already the funnel every write passes through.

**Alternatives rejected**:

- *A lock file or advisory mutex* — solving a race that the architecture already prevents. The
  daemon has no write path to serialise against.
- *Correcting in the daemon too and having it write* — would create the second writer the
  requirement exists to forbid.

---

## R2. Where the generic bounds guard lives, and how write-back is triggered

**Decision**: A **pure function in `@throng/core`** — `applyDeclaredBounds(raw, registry, defaults)`
returning `{ value, corrected }` — invoked from the settings parse path. `FileConfigStore.read()`
writes back when `corrected` is true.

**Rationale**: `read()` already takes a `validate: (raw: unknown) => T` callback, which is exactly
the seam. The one thing it lacks is a way for validation to say *"I changed something"* — today it
returns only the value, so a corrected read is indistinguishable from a clean one, which is why
FR-014 ("do not rewrite a file that was already valid") cannot be satisfied without this signal.

Keeping the guard pure and in core is what makes FR-009a possible (any future consumer of a declared
bound uses the same mechanism) and keeps it unit-testable with no filesystem.

**Alternatives rejected**:

- *Clamping inside each `xxxSettings()` parser in `app-settings.ts`* — this is precisely the
  hand-written per-setting clamping FR-016 removes. It is how `linkHoverDelayMs` came to declare
  0–2000 and clamp 0–5000.
- *Always writing back after every read* — violates FR-014 and churns the file on every start.
- *A JSON-schema validator* — the ranges are already declared in `SETTINGS_METADATA`; a schema would
  be a second declaration of the same numbers, which is the drift FR-009 forbids.

---

## R3. What the guard must walk (FR-008a)

**Decision**: The guard walks `SETTINGS_METADATA` descriptors, not the settings object, and handles
three descriptor shapes: **scalar leaves** with `min`/`max`, **enum leaves** with `allowedValues`,
and **`map` / `records` controls whose `columns[]` carry their own `min`/`max`**.

**Rationale**: Driving from the descriptors is what makes FR-010 true — a new bounded setting is
guarded because it declared a bound, not because anyone remembered it. Walking the settings object
instead would guard only what happens to be present in the file.

Measured against the current registry:

- 49 descriptors, **15 with `min`/`max`** — all two-sided; there is no one-sided bound today, and no
  numeric leaf without bounds.
- **`editor.indentByLanguage`** is a `map` whose columns declare `indentWidth` 1–16 and `tabWidth`
  1–16. This is the live instance of FR-008a — the whole table is one leaf, so a leaf-only guard
  steps straight over it.
- `terminals.flavours` (`records`) and `editor.languageByExtension` / `terminals.defaultShellArguments`
  (`map`) declare no numeric columns, so they are unaffected beyond the malformed-entry rule.

**Alternative rejected**: *Guard leaves now, tables later.* It would make SC-004's "100% of declared
ranges" false on the day it shipped, with the one real violation being the one left out.

---

## R4. Counting characters (FR-033a–c)

**Decision**: **`Intl.Segmenter`** with `granularity: 'grapheme'`, wrapped in one core helper used by
both the rename cap and the truncation.

**Rationale**: Available in both runtimes with no new dependency — verified `typeof Intl.Segmenter
=== 'function'` on Node 24 (the repo's toolchain) and it is standard in Electron 43's Chromium, which
is the renderer. It is the only option that satisfies FR-033b (never split an emoji, a flag, or a
letter from its combining accent) without hand-rolling Unicode tables.

**Alternatives rejected**:

- *`String.length`* — UTF-16 units. Splits surrogate pairs, producing an invalid string, and halves
  the effective limit for emoji.
- *`[...str]` / code points* — better, but still splits multi-code-point clusters: a ZWJ emoji family
  or a skin-tone modifier is cut in half.
- *`@marijn/find-cluster-break`* — present in the tree, but only **transitively** via CodeMirror.
  Taking a direct dependency on a transitive one is how a lockfile change breaks an unrelated
  feature; `Intl.Segmenter` is native and costs nothing.

**Note**: a `Segmenter` is comparatively expensive to construct, so it is built once at module scope,
not per call — the rename cap runs per keystroke.

---

## R5. Removing the scrollbar without moving the tabs (FR-001, FR-002, FR-005)

**Decision**: The strip becomes an outer **non-scrolling** flex row holding (a) a scrolling *track*
with `overflow-x: hidden` scrolled programmatically via `scrollLeft`, (b) the tab-actions group, and
(c) the New Tab button. The fades are `::before`/`::after` overlays on the track, absolutely
positioned, so they occupy no layout space.

**Rationale**: The current defect is fully explained by three lines of
`packages/ui/src/renderer/theme.css:599-607`: `.tab-strip` is `display: flex` with a fixed
`height: var(--pane-header-height)`, `align-items: flex-end`, and `overflow-x: auto`. A horizontal
scrollbar in a fixed-height flex row has nowhere to take its ~15px from except the content box — so
the tabs lose height and shift, which is exactly the reported symptom. Removing `overflow-x: auto`
removes the cause outright; nothing else in the strip needs to move.

`overflow-x: hidden` (rather than `clip`) is chosen because `scrollLeft` still works on it, which is
what the step controls and every scroll-into-view path drive.

**Alternatives rejected**:

- *`scrollbar-width: none` / `::-webkit-scrollbar { display: none }`* — hides the scrollbar but keeps
  a scrollable overflow container whose behaviour (wheel, trackpad, focus-scroll) the feature then
  has to fight. It also leaves the tabs' height dependent on a UA detail.
- *A fixed `padding-bottom` to reserve scrollbar space* — trades a clipped tab for a permanently
  shorter one, in the non-overflowing case too.

---

## R6. Honouring reduce-motion (FR-031a–d)

**Decision**: `window.matchMedia('(prefers-reduced-motion: reduce)')`, read at scroll time and
subscribed to for live changes, forcing the instant path.

**Rationale**: The repo already honours this preference in three places
(`packages/ui/src/renderer/theme.css` twice, `common/loading.css` once) and already E2E-tests it via
Playwright's `emulateMedia({ reducedMotion: 'reduce' })` (`unsaved-dot-pulse.e2e.ts:62`) — so both
the convention and the test technique exist and are reused rather than invented.

Read in **JS rather than CSS** because the scroll is a JS animation over `scrollLeft`, not a CSS
transition; a media query in the stylesheet cannot suppress it. The subscription is what satisfies
FR-031c (live, and cancels a scroll in flight).

---

## R7. The scroll animation and its supersede rule (FR-030c–f)

**Decision**: One `requestAnimationFrame` loop per strip, owning a single mutable target. A new
scroll overwrites the target and the start position (`= current scrollLeft`) and restarts the clock;
it never starts a second loop.

**Rationale**: FR-030d forbids queueing and FR-030e forbids residue. A single loop with a replaceable
target gives both by construction — there is no second animation to leave behind, and no callback
that can fire late, because the loop reads the target rather than closing over it.

Easing is `easeInOutCubic`, which satisfies FR-030a (accelerate from rest, decelerate to a stop) and
FR-030b (the same curve at every duration).

**Alternatives rejected**:

- *`element.scrollTo({ behavior: 'smooth' })`* — the duration is the UA's, not the user's, so the
  0–3000 ms setting could not be honoured; and it cannot be cancelled deterministically, which
  FR-030e requires.
- *A CSS `scroll-behavior: smooth`* — same problem, plus it would apply to scrolls that must be
  instant.

---

## R8. Where the name limit applies for panels (FR-037)

**Decision**: `panelDisplayTitle()` in `packages/core/src/workspace/panel-title.ts` — the single
resolved-display-name rule that issue #218 landed on master on 2026-08-11.

**Rationale**: #218 exists precisely because "which name does a panel wear" used to be a nested
ternary in the panel header's JSX. It is now one pure function that resolves the user's override, the
shell's live window title, the terminal flavour label and the editor's file path down to one string.
Applying the limit to its return value covers every source FR-037 names, in one place, and is
unit-testable without a DOM.

Tab names have no equivalent chokepoint — `Tab.title` is read straight from the layout — so the tab
side applies the limit at the layout-read boundary and in the rename commit.

**Alternative rejected**: *Truncating in the tab chip and panel header components.* Two call sites
that would drift, and neither covers a name arriving from a drag into a new tab.

---

## R9. Adding icons and a keybinding

**Decision**: Follow the existing registries exactly.

- **Icons**: three tokens (`chevronLeft`, `chevronRight`, `chevronDown`) added to `THRONG_THEME.icons`
  in `packages/core/src/config/theme.ts` with glyph defaults.

  **Corrected TWICE, and the second correction matters more than the first.**

  *First pass* said the tokens need hand-written descriptors in `theme-metadata.ts`. They do not —
  that registry *derives* icon descriptors from the theme document's own keys
  (`key.startsWith('icons.')`, `theme-metadata.ts:47`, `:142`, `:269`, `:326`).

  *Second pass, found at implementation time*: that is true of `theme-metadata.ts` and **is not the
  whole gate**. `THEME_TOKEN_COPY` in **`theme-copy.ts`** is a separate, mandatory, hand-written
  catalogue covering every editable token, and `theme-copy.test.ts` fails four ways without it —
  `mechanicalCopy()` is explicitly rejected as a source of shipped copy, so a new token fails with
  *"description merely restates the identifier"*.

  **The real rule for a new icon token**: glyph in `theme.ts` **+** label and description in
  `theme-copy.ts`, and nothing in `theme-metadata.ts`. An agent following the first correction
  literally would have shipped a red build — which is what a research note is supposed to prevent,
  and a reminder that "I checked one registry" is not "I checked the gate".

  Note the theme already ships `collapse: '‹'` and `expand: '›'` — visually similar to the chevrons
  needed here. They are **not** reused: they mean tree-node state, and re-skinning one would silently
  re-skin the other (the same reasoning the theme applies to `destroy` versus its neighbours).
- **Keybinding**: `tabs.openPicker` added to `COMMAND_SCOPES` in
  `packages/core/src/config/keybindings.ts`, defaulted to `Ctrl+Alt+T` in `WINDOWS_BINDINGS`, plus an
  entry in the `KEYBINDINGS_METADATA` array (`keybindings-metadata.ts:21`) so the Key Bindings editor
  exposes it (FR-032b). Unlike icons, these *are* hand-written — the registry is a literal array of
  descriptors built by a helper taking `(action, group, label, description)`, as
  `'editor.toggleWordWrap'` shows at `:180`. `keybindings-metadata.test.ts` fails on a bound action
  with no descriptor.

**Scope**: `EVERYWHERE`. The picker is a workspace-level navigation aid and FR-032a requires it to
work at any tab count from anywhere. `Ctrl+Alt+T` is in neither the reserved nor the shadowable tier
(constitution IV), so it displaces no line-editor binding and the enumerated exception list is
unchanged — stated in the spec as FR-032c and re-checked in the Constitution Check below.

---

## R10. Test layers, and which one each requirement lands in

**Decision**: Match the repo's four existing layers; add no new stack.

| Layer | Command | What from this feature |
|---|---|---|
| **unit** | `npm run test:unit` | The bounds guard (every descriptor shape), grapheme counting and truncation, the match predicate, easing/target maths, count derivation |
| **integration** | `npm run test:integration` | Settings read → correct → write-back, including the no-rewrite-when-clean case and the write-failure path |
| **contract** | `npm run test:contract` | Nothing — this feature adds no OS-abstraction seam |
| **E2E** | `npm run test:e2e` | Every user-visible behaviour: no scrollbar, tab geometry, fades, counts, stepping, the picker, the chord, the close affordance and its arming delay, the counter, the Tabs settings |

**Registration**: every new E2E spec file must be added to
`packages/ui/tests/e2e/shard-plan.json`, and any spec that opens preferences or drives a context menu
must also go in `parallel-plan.json`'s serial tier — `packages/ui/tests/unit/shard-plan.test.ts`
fails the build otherwise. This is a real constraint, not a nicety: a spec in no group runs nowhere,
silently.

**Alternative rejected**: *Component tests for the strip.* The repo has no component-test stack
(no jsdom React renderer configured), so tasks written against one would be undeliverable. Strip
geometry is asserted in E2E against the real renderer, which is also the only place the reported
defect is observable.
