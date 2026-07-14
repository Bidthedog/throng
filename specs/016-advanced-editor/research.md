# Research — 016 Advanced Editor (Part 1)

**Date**: 2026-07-12, **revised 2026-07-13** · **Feature**: `016-advanced-editor` · **Constitution**: v3.15.0

> **2026-07-13 revision.** Constitution **v3.15.0** added *"One document, one state"* to Principle XI, and
> the same-day `/speckit-clarify` pass added **FR-028f** (a single document authority with a monotonic
> version and in-flight rebase). **F8** and **D7** are re-derived against them below — the sync mechanism
> is now understood as a **violation** to replace, not sound substrate to preserve.
>
> *(The version citation on this line was first advanced to v3.15.0 **without** re-deriving the content
> beneath it. That is precisely how the drift got in: a version bump is an **attestation of alignment**,
> and making one without re-deriving is a false attestation. Recorded here rather than quietly fixed.)*

Phase 0 of `/speckit-plan`. Every decision below was taken against the **shipped code**, not against
the spec's description of it. Where the two disagree, the disagreement is recorded as a **finding**
and carried into `plan.md`'s Complexity Tracking — the spec is amended by `/speckit-clarify`, never
silently by the plan.

---

## Findings that contradict the spec (raised before any design)

These were found by reading the shipped source. Each one would have failed the build, or shipped
broken, if the spec had been implemented literally.

### F1 — `Tab` is not a bindable chord, but the spec makes it a default

`packages/core/src/config/chord-capture.ts` lists `Tab` in `EXCLUDED_KEYS`, so
`isBindableChord('Tab') === false` and the capture modal **rejects** it. Yet **FR-017b/FR-019** make
`Tab` the *default* binding of `indent-lines`, and **FR-022** requires all seven commands to be
rebindable in the Key Bindings editor.

The two cannot both hold: a user who cleared `Tab` could never re-enter it.

**Decision**: `Tab` and `Shift+Tab` are removed from `EXCLUDED_KEYS`, guarded by a focus rule
(**FR-017f** already requires this): the editor claims `Tab` **only** when an Editor Panel's content
has input focus. `Tab` retains its DOM focus-traversal meaning everywhere else, so accessibility is
not regressed — which is why it was excluded in the first place. Recorded as a required spec
amendment.

**Rejected**: giving `indent-lines` a different default. It sacrifices the feature's expected
behaviour to a rule that exists for a different reason.

### F2 — the spec's chord strings would never match

Canonical token order is `Ctrl+Shift+Alt+<key>` (`eventToToken`, `keybindings.ts:156-161`). The spec
writes the column-select defaults as **`Alt+Shift+Arrow`** throughout. A default written in that
order **never matches a real key event** — the four commands would be silently dead.

**Decision**: the shipped defaults are written **`Shift+Alt+ArrowUp|Down|Left|Right`**. A unit test
asserts every shipped default chord round-trips through `normalizeToken(eventToToken(...))`, so no
future feature can reintroduce a mis-ordered chord.

### F3 — CodeMirror's own keymap already owns the column-select chords

`use-editor.ts:270` mounts `keymap.of([...defaultKeymap, ...historyKeymap])`, and CM6's
`defaultKeymap` binds **`Shift-Alt-ArrowUp/Down` to `copyLine`**. The collision is with CodeMirror,
not with throng's registry — so the registry's collision test cannot see it.

**Decision**: this feature's editor commands are installed as a **`Prec.highest` CodeMirror keymap**
inside the editor (not as a window-level listener), so they win over `defaultKeymap` deterministically
and still lose to nothing else. A unit test asserts the seven chords are not claimed by
`defaultKeymap`.

### F4 — `resolveAction` resolves `Ctrl+X` to `file.cut` everywhere

Confirmed verbatim (`keybindings.ts:177-186`): it returns the **first** action in map order whose
chord matches, and `file.*` precedes `editor.*` in `DEFAULT_KEYBINDINGS`. So `cut-line` on `Ctrl+X`
would **never fire**. This is exactly what **FR-017b0** predicts, and it is the reason the `scope`
field cannot be decorative.

**Decision**: implement the scope set + scope-aware resolver as specified. See D6.

### F5 — a keyed map explodes the completeness test

`leavesOf` (`metadata.ts:93-116`) recurses into plain objects. A **non-empty** keyed map — which
**FR-022b** *requires* for the indentation overrides (Go → tabs, Python → 4 spaces) — therefore
yields **one leaf per entry** (`editor.indentByLanguage.go.style`, …). The completeness test would
demand a descriptor for each and reject the single map descriptor as an *unknown* key. **The build
fails on day one.**

The corollary is worse: an **empty** map yields **zero** leaves, so no descriptor is demanded at all.
That is precisely how `terminals.defaultParams` (`Record<string,string>`, default `{}`) ships **today
with no descriptor** and passes the completeness test — a JSON-only setting of exactly the kind the
constitution's completeness rule exists to forbid.

**Decision**: map-ness becomes **declared, not inferred** — the same lesson `clearable` already
encodes. `settingsLeaves()` stops at any key whose descriptor declares `control: 'map'`, treating the
map as **one leaf**. `terminals.defaultParams` gains the descriptor it should always have had (a
pre-existing hole this feature closes rather than steps around).

### F6 — three more map-blind helpers fail silently

- `emptyValueFor` (`metadata.ts:65-68`) returns `''` for anything that is not `array`/`multiselect` —
  a **clear** on a map would write the string `''` into a `Record`.
- `canClear` (`settings-tab.tsx:126-130`) tests `value !== ''`, so it lights the clear button on an
  **already-empty** map.
- `auditClearable`'s emptiness check (`metadata.ts:80-91`) has the same bug, so a map that *failed*
  to clear would pass the audit.

**Decision**: all three gain a map arm (`Object.keys(v).length > 0`). Without them the 015 clearable
machinery is silently wrong for the new settings.

### F7 — the spec names one version guard; there are two

**FR-028e** names `no-editor-migration.integration.test.ts` (asserts `LATEST_VERSION === 6`). There is
a **second**, unnamed: `packages/persistence/tests/integration/user-version-pin.integration.test.ts`
(feature 007), which pins the same version and will fail identically on a v7 migration.

**Decision**: **both** are retired/rewritten as an explicit, reviewed change. Every other
version-touching test compares against `LATEST_VERSION` *relatively* and is safe.

### F8 — the spec's FR-028 hazard is not constructible; the real hazard is elsewhere

**FR-028/FR-028a** justify document-scoped state with a concrete hazard: *"a new/empty file open in a
panel overridden to **Go** (tabs) and another to **Python** (4 spaces) would take **both**."*

That situation **cannot occur**. `open-registry.ts` enforces one buffer per file app-wide:
`openOrFocus()` **focuses the existing editor** for an already-open path (FR-011a), and Save-As
refuses a path open elsewhere (`editor-coordinator.ts:278-283`). A file is open in **at most one
Editor Panel**. (And a *new* file has no path at all, so two untitled panels are two distinct
documents.)

But the requirement FR-028 is reaching for is **real**, and it bites in a place the spec does not
name. A panel **mirrored** across windows (006 FR-034) keeps **one `panelId`** and mounts a **separate
`EditorView` per window** — each with its **own `history()`** — synchronised by **whole-document
replace**. So today:

- mirrored views have **separate undo stacks** — violating **FR-026c** outright; and
- whole-document replace would destroy undo coherence even if they didn't.

**Decision** *(revised 2026-07-13 — constitution v3.15.0)*: there are **TWO** violations here, not one.

1. **The undo stack** — mirrored views have separate `history()` instances, so undo in one cannot revert
   the other's edit. Fixed by the document-level history of **D7**.
2. **The sync mechanism itself** — and this is the one the first draft of F8 **missed**. It concluded
   that FR-028's invariant was *"already enforced … and this feature must simply not break it"*, treating
   006's `{text, dirty}` whole-document relay as **sound substrate**. It is not. Two `EditorView`s, each
   its own source of truth, reconciling by copying the whole document to each other, is **peer-to-peer
   reconciliation between co-equal copies** — which constitution **Principle XI (v3.15.0)** forbids by
   name, and which the spec now states outright: *"006 FR-034 is the **problem**, not the solution"*
   (FR-028). It must be **replaced** by the single authority of **FR-028f**, not preserved.

The **one-panel-per-file** finding still stands and is still useful: a file genuinely *is* open in at
most one Editor Panel, so language and indentation cannot diverge across *panels*. But they can diverge
across **views** of a mirrored panel, and the buffer itself is relayed between two owners — so "already
enforced" was true of the hazard the spec originally named and false of the one that actually exists.

FR-028e's per-document persistence remains necessary and unchanged — it exists so a panel opening the
file **later** (a different session) adopts the override, which *is* constructible and *is* the point.

Recorded as required spec amendments, **both now made**: FR-028a's justifying hazard restated against
the mirrored-view case *(done 2026-07-12)*; and the sync mechanism named as a violation with a single
authority specified to replace it — **FR-028f** *(done 2026-07-13)*.

---

## Decisions

### D1 — Highlighting engine: CodeMirror's own `syntaxHighlighting` + CSS-var-valued `HighlightStyle`

**Decision**: `HighlightStyle.define([...])` mapping `@lezer/highlight` tags to
`color: 'var(--throng-colour-syntaxKeyword)'` (etc.), wrapped in `syntaxHighlighting(...)` and added to
the editor's extension list.

**Rationale**: `@codemirror/language` is **already a declared dependency** (`packages/ui/package.json:14`)
and imported nowhere — so `syntaxHighlighting`, `HighlightStyle` and `StreamLanguage` cost **zero new
dependencies**. Theme tokens already become `--throng-colour-<token>` CSS variables automatically
(`toCssVariables`, `theme.ts:236-276`), and CM resolves CSS vars inside its generated classes — the
existing `.cm-scroller` fontFamily rule already proves it. Consequence: **a theme change repaints the
syntax colours live, with no view rebuild**, which is the property the rest of the editor already has.

**Alternatives rejected**: a JS-side palette resolved per theme (loses live repaint, duplicates the
token system); per-theme `HighlightStyle` objects (would rebuild the view on every theme change).

### D2 — Grammars: official `@codemirror/lang-*`, `@codemirror/legacy-modes` for the rest, lazily loaded

31 targets. Coverage:

| Source | Languages |
|---|---|
| `@codemirror/lang-*` (official) | JavaScript, TypeScript (+JSX/TSX), Python, Rust, C++, **C** (via cpp), Java, PHP, SQL, XML, JSON, HTML, CSS, Markdown, YAML, Go, Vue, LESS, SASS/SCSS |
| `@codemirror/legacy-modes` (`StreamLanguage`) | C#, Kotlin, Swift, Dart, Ruby, Lua, PowerShell, Shell, TOML, INI |
| Aliased to an existing grammar | **Jupyter `.ipynb` → JSON** (FR-009); **JSONC → JavaScript** grammar |

**JSONC → JavaScript** rather than JSON: CM's `json` grammar rejects comments, so a `.jsonc` file would
render its comments as *errors*. The JavaScript grammar is a highlighting superset that accepts them.
(throng's own settings/keybindings/theme files are JSON — FR-001a — so this path matters.)

**Loading**: grammars are registered as `LanguageDescription.of({ name, extensions, load: () => import(...) })`
and loaded **on demand**. 31 eagerly-imported grammars would inflate the renderer bundle and
jeopardise FR-008's 200 ms first-highlight budget. Vite `manualChunks` gets a rule so each grammar is
its own chunk. `Compartment` swaps the language extension in place when the document's effective
language changes (override, extension remap) — no view rebuild, satisfying FR-004b's "without
reopening".

### D3 — The language registry is pure core

A `LanguageDescriptor` record in `@throng/core` (`packages/core/src/editor/languages.ts`), pure and
unit-tested, holding identity + display name + declared suffixes + optional indentation profile. The
**highlighter loader is not in core** (core must stay DOM-free, Principle II) — the renderer keys a
loader map off the language id.

Detection is a pure function: longest declared **dot-prefixed suffix**, matched case-insensitively;
no dot, or only a leading dot → **no extension** → plain text (FR-002b). A registry test asserts **no
suffix is claimed by two descriptors** (FR-004a).

**Descriptor shape reserves `filenames?: readonly string[]`** — declared, unused, and asserted empty
in Part 1 — so exact-filename descriptors (`Dockerfile`, `.gitignore`) can be added later **without a
breaking change**, as FR-002b requires.

### D4 — Syntax tokens: extend the `Palette`, derive nothing

Themes are **not** authored as 33 literal colours: each is a compact `Palette` expanded by
`makeTheme()` (`default-themes/index.ts:126-189`). So the "~150 shipped colour values" are ~10 new
`Palette` fields × 15 themes — real authoring work, but not 150 hand-typed hex literals in 15 places.

**The distinctness gate makes per-theme palettes mandatory, not stylistic.** `themePairDistance` is the
**mean** ΔE00 across shared tokens. Today: closest legitimate pair **4.469**, threshold **4.3**, over
**33** tokens. If ~10 syntax tokens were **identical** across themes they each contribute ΔE00 = 0 and
n → 43, so the closest mean becomes:

```
4.469 × 33/43 ≈ 3.43   →  below 4.3  →  assertDistinct THROWS  →  build fails
```

So a copy-pasted palette **provably** fails the build (FR-007c, quantified). Each theme's syntax hues
are drawn from **its own** palette (its accent/danger/success/border family), which pushes pairs apart
rather than together.

`CLOSEST_LEGITIMATE_PAIR_DELTA` is asserted to 2 dp against the measured closest pair
(`theme-quality.test.ts:63-71`), so it **must be re-measured and updated** even if the gate still
passes. It is recalibrated **only** if the closest *legitimate* pair genuinely moved — never loosened.

**Token set (10)**: `syntaxKeyword`, `syntaxString`, `syntaxComment`, `syntaxNumber`, `syntaxType`,
`syntaxFunction`, `syntaxVariable`, `syntaxOperator`, `syntaxPunctuation`, `syntaxInvalid`.

Each needs hand-written copy in `THEME_TOKEN_COPY` that (a) avoids `BANNED_ABBREVIATIONS` — notably
**`bg`/`fg`** — and (b) does **not** equal `mechanicalCopy(key)` (`theme-copy.test.ts:43`). New colour
tokens are otherwise **auto-exposed** in the Themes editor and auto-flow into 010's record, because both
derive from `THRONG_THEME`.

`SHIPPED_DEFAULTS_VERSION` **2 → 3**: the additive on-disk upgrade is gated on the bump, so without it
an existing install's theme files never materialise the new tokens (`shipped-defaults.ts:21-25`).

### D5 — Contrast: add pairings, change no policy

The syntax-on-match-background pairings join 009's enumerated `CONTRAST_PAIRINGS`, inheriting its
**existing** in-scope/out-of-scope machinery unchanged: build-blocking on `IN_SCOPE_THEMES`
(`['Bash','SUBNET','Cyberpunk']`), reported via `knownContrastIssues()` elsewhere. The gated set is
**read from 009's list, never copied** (FR-007a), so #61 can widen it without touching the editor.

10 syntax tokens × {`searchMatch`, `searchMatchCurrent`} = 20 new pairings, at `WCAG_AA_BODY` (4.5:1) —
they are body text.

### D6 — Dispatch scope: a set on the descriptor, a scope-aware resolver

`DispatchScope = 'editor' | 'terminal' | 'explorer'`; every command declares a **non-empty set**.
"Global" is simply the full set — no special value, no default (an unscoped command **fails the
completeness test**, FR-017b0).

- `resolveAction(kb, ev, scope)` considers only commands whose scope set **contains** the active
  context. Without this the field is decorative (F4).
- The active context is derived from **two existing reads**: `getActivePane()` (`'files'` → `explorer`)
  and the active panel's `kind` (`editor` / `terminal`). Both are already computed — *twice*, in
  duplicated code, in `editor-chrome.tsx` and `search-keybindings.tsx`. That computation is **lifted
  into one scope provider** and threaded through.
- `findConflict` (`chord-capture.ts:124-135`) becomes scope-aware too: two commands conflict **iff
  their scope sets intersect** on a chord. This is the second scope-blind site, and the spec names only
  the resolver.
- `reservedByTerminal` (`search-actions.ts:55-59`) is a **hand-rolled, hard-coded terminal-scope table**.
  It is exactly what `scope` subsumes, and is replaced by it.

All **36** shipped commands (not "~40") get their real set. `file.*` → `{explorer}`; `terminal.scroll*`
→ `{terminal}`; `search.*` and `editor.save*` → `{editor, terminal}`; `zoom.*`, `panel.zoom*`,
`focus.*`, `view.*` → all three.

### D7 — A single **document authority** in UI main: canonical text, monotonic version, in-flight rebase

*(Rewritten 2026-07-13 against constitution **v3.15.0** and **FR-028f**. The earlier version of this
decision stopped at *"relay the `ChangeSet`"* — no authority, no version, no rebase — and it is what
plan.md, data-model.md and tasks.md all derived from. Relaying changes between two co-equal
`EditorView`s is **peer-to-peer reconciliation**, which Principle XI now forbids outright, and it is
strictly **worse** than the whole-document replace it replaces: a stale change lands at the position it
originally named, silently corrupting text, where whole-doc replace was crude but internally consistent.)*

The hard one (F8). CM6's `history()` is **per `EditorView`**, and mirrored views live in **different
renderer processes** — they cannot share an `EditorState`. A literally-shared object is impossible, so
the rule cannot be "share the object"; it must be **"have one authority"**.

**Decision**: **UI main owns the document.** It holds the **canonical text** and a **monotonic
version**, and it is the only source of truth. Every `EditorView` is a **derived replica**.

- **Local echo, then dispatch.** A local edit is applied in the view **immediately** (typing MUST NOT
  wait for a round trip — FR-028f), then sent to main as `{ changes (ChangeSet.toJSON), baseVersion,
  panelId, selectionBefore }`.
- **Serialise and rebase.** Main applies changes **in arrival order**, bumping `version` each time. If
  an arriving change's `baseVersion` is **stale**, main **rebases** it over the changes that landed in
  between — `ChangeSet.map()`, which is exactly the operation CM6 provides for this — so it applies at
  the position it *now* means, not the one it originally named.
- **One ordered canonical stream.** Main broadcasts `{ changes, version }` to every view (including,
  where a rebase changed it, back to the originating view). Views apply it with **`addToHistory:
  false`** — it is not that view's user action.
- **The undo stack lives with the authority**, not the view: main appends `{ changes, inverted,
  selectionBefore }` to the document's stack (bounded ≥ 500, FR-026d). Local CM `history()` is
  **removed**; `undo`/`redo` round-trip through main, which pops an entry, broadcasts the **inverted**
  ChangeSet, and returns the recorded cursor set to the **invoking** panel only (FR-026f).
- **Dirty state is derived, not relayed** (FR-028f; see `contracts/document-authority.md` § Dirty state): main computes it as `version !== savedVersion`.
  A relayed `dirty` flag would be a second peer-owned value — the thing Principle XI forbids.
- **Atomicity (FR-026) is then free**: one command = one transaction = one stack entry, however many
  cursors or rows it touched.

**Why this is not a collaborative-editing engine.** FR-026e rejects operational transforms for *undo* —
rebasing entries of a **divergent history** against other panels' edits, which needs consensus. This is
strictly smaller: **one** history, **one** authority, and the only thing rebased is a change that was
**in flight**, against changes that are **already ordered**. That is a single `ChangeSet.map()` call,
not a protocol. *(The earlier D7 rejected "operational transforms" in terms that now read as rejecting
this rebase. FR-028f rebuts that explicitly; this decision is aligned with it.)*

**Honest scope note**: with one user, only one window holds keyboard focus, so the rebase path will
almost never execute. It is built anyway, because the alternative is a race that silently corrupts the
user's file — and because it is what makes "one document" *true* rather than *usually true*.

**Rejected**:
- **Keeping per-view `history()`** and relaying transactions as remote — undo in view B could not revert
  view A's edit (fails FR-026c).
- **Reject-stale-and-resync** — safe against corruption, but the view has *already shown the user their
  keystroke*, so rejection means **visibly reverting input the user watched themselves type**.
- **An edit lock** (only the focused view may dispatch) — does **not** close the race (focus can change
  while a change is in flight), and it forbids programmatic edits from a non-focused view, breaking
  013's replace-all.
- **Accepting the race** — ships precisely the content-corruption hazard Principle XI was amended to
  forbid.

### D8 — Clipboard seam lives in `packages/ui/src/main/`, not `platform-windows`

`@throng/platform-windows` has **no `electron` dependency** — it is plain Node. Electron-backed seams
therefore live in UI main, with contract tests that inject a fake. Precedent: `ElectronDisplayInfo`
(`ui/src/main/electron-display-info.ts` + `ui/tests/contract/electron-display-info.contract.test.ts`)
and `ElectronShellIntegration`.

- `IClipboard { writeText(t): void; readText(): string }` in `@throng/core/abstractions`.
- `runClipboardContract(name, make)` in `@throng/core/testing` (the `IFontEnumeration` pattern exactly).
- `ElectronClipboard` in `ui/src/main/`, **constructor-injecting** Electron's `clipboard` module so the
  contract test can pass a fake.
- Token + binding in the UI-main composition root (Principle IX: one container per boundary).

**It absorbs three existing unseamed call sites** — `terminal-ipc.ts` calls `clipboard.writeText`
(:201), `clipboard.readText` (:207) and `clipboard.writeText` (:220-223) directly today. Leaving them
would make the seam a fiction.

### D9 — Clipboard-mode record: main-process singleton + broadcast

One in-memory record in **UI main**: `{ text, mode }` of throng's most recent clipboard write, shared by
every panel in every window (FR-015c). Validated on **every paste** by comparing the live OS clipboard's
text (through the D8 seam) with the recorded text; any mismatch ⇒ **verbatim**. Self-correcting, so no
clipboard polling and no clipboard-change observer (SC-011a). Not persisted; no daemon RPC.

### D10 — Per-document state: SQLite v7 migration + new daemon RPC

New table, mirroring `workspace_layout`'s composite-PK precedent exactly:

```sql
CREATE TABLE document_state (
  owner_user   TEXT NOT NULL,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path     TEXT NOT NULL,
  language_id  TEXT,                      -- NULL = no override; '' is never stored
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (owner_user, project_id, rel_path)
);
CREATE INDEX idx_docstate_owner_project ON document_state(owner_user, project_id);
```

- **Cascade on project delete is free** — the FK plus `PRAGMA foreign_keys = ON`
  (`database.ts:22`), exactly as `workspace_layout` already relies on.
- A **new `CREATE TABLE`** needs **no** schema-guard registration (v2 registered none); only a column
  added to it *later* would. The migration is idempotent by the runner's version loop.
- `LATEST_VERSION` is **derived** from the `MIGRATIONS` array (`migration-runner.ts:52`) — adding v7
  bumps it automatically.
- Shaped for per-document state **in general** (FR-028e): `encoding` and `line_ending` are the declared
  next occupants, so they join without a redesign.
- Retires **both** version pins (F7).

**New RPC — FOUR methods**: `document.getState` / `document.setState` / **`document.movePath`** /
`document.pruneMissing`. Adding a daemon method needs a contract file + a daemon service registration + a
renderer client — **no change** to `throng:rpc`, the preload, or `DaemonClient` (it is generic).

**`document.movePath` is easy to forget, and losing it loses user data.** FR-028e requires a rename or
move *within throng* to **carry the row with the file**; without it, renaming a file **silently discards
its language override** — an explicit user decision, destroyed by a rename. It is **one atomic
`UPDATE`**, not a client-side get→set-new→delete-old sequence: that sequence is three round-trips with
two windows in which a crash leaves the override duplicated or lost. **Two** call sites must use it (both,
or the override is lost): the File Explorer's rename/move, and the editor's **Save-As**. See
`contracts/document-state-rpc.md`. *(This decision listed only three methods until 2026-07-13; the
contract, plan.md and T119 all had four.)*

**Rejected** (as FR-028e requires it be): riding `workspace_layout.layout_json`. It needs no migration and
no RPC, and that cheapness is its only argument — the override is *document* state, not *layout*, and a
schemaless blob gives it no key, no foreign key, no pruning, and no protection from a layout rebuild.

### D11 — Recovery snapshot becomes structured

Today `editor-recovery.ts` writes **one file per document: filename = `encodeURIComponent(panelId)`,
contents = the raw text**. There is no metadata sidecar at all.

FR-027a requires the undo history (plus redo and cursor sets) to be persisted alongside it, bounded by
**serialised size**. So the artefact becomes **JSON**: `{ version, text, history? }`. Reading tolerates
the **legacy plain-text form** (a file that does not parse as JSON is treated as `{text: <raw>}`), so an
in-flight recovery snapshot written by the previous build is not lost on upgrade.

FR-027c's toggle (`editor.persistUndoHistory`, default **true**) governs **persistence only**; turning it
off **purges** what is already on disk.

### D12 — Test layers

The repo has exactly four (`docs/testing.md`), and tasks are written to them — not to a layer that does
not exist (there is **no component/DOM test stack**; there is no jsdom project):

| Layer | Runner | Notes |
|---|---|---|
| unit | `vitest --project unit` | parallel; pure core logic |
| integration | `vitest --project integration` | **serial** (`singleFork`) — spawns real OS processes |
| contract | `vitest --project contract` | **serial**; where `runClipboardContract` runs |
| E2E | Playwright-Electron | real on-screen windows; **no headless mode** |

Constitution V requires **every user-facing UI change to ship E2E coverage**. The status strip, the
picker, the content menu, column selection and the keyed-table control are all UI, so each carries an
E2E spec.

**Environment note**: E2E defaults to **6 workers**, benchmarked on a 10-core/20-thread machine (25 peak
Electron processes). On the 8-core development box this exhausts the Windows desktop heap and workers die
with `STATUS_DLL_INIT_FAILED` (`0xC0000142`). Runs here use `THRONG_E2E_WORKERS=2`. This is an
environment limit, not a defect, and CI (which sets its own runner) is unaffected.

---

## Dependency additions

| Package | Why |
|---|---|
| `@codemirror/lang-{javascript,python,rust,cpp,java,php,sql,xml,json,html,css,markdown,yaml,go,vue,less,sass}` | D2 official grammars |
| `@codemirror/legacy-modes` | D2 — C#, Kotlin, Swift, Dart, Ruby, Lua, PowerShell, Shell, TOML, INI |

`@codemirror/language`, `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` are **already**
present. No new runtime deps outside the renderer; core stays dependency-free.
