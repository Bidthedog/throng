# Data Model — 016 Advanced Editor (Part 1)

Entities introduced or changed by this feature. Types are the **authoritative shape**; the contracts in
`contracts/` restate the ones that cross a process boundary.

---

## 1. Language registry (pure core — `packages/core/src/editor/languages.ts`)

```ts
/** Indentation convention a language overrides the global default with. */
export interface IndentProfile {
  style: 'tabs' | 'spaces';
  /** Columns per indent when style is 'spaces'. */
  indentWidth: number;
  /** Columns a literal tab occupies on screen (rendering only — FR-018e). */
  tabWidth: number;
}

/** One entry in the extensible language registry (FR-004). */
export interface LanguageDescriptor {
  /** Stable id, persisted. Never renamed once shipped (FR-005b keeps stale ids). */
  id: string;
  /** Display name shown in the picker and the status strip. */
  name: string;
  /**
   * Dot-prefixed suffixes this language claims, e.g. ['.ts', '.d.ts'].
   * Many-to-one: a language may claim many; no suffix may be claimed by two (FR-004a).
   */
  extensions: readonly string[];
  /**
   * RESERVED (FR-002b). Exact-filename matching (`Dockerfile`, `.gitignore`) is a planned
   * later extension. Declared now so adding it is not a breaking change; MUST be empty in
   * Part 1, asserted by a registry test.
   */
  filenames?: readonly string[];
  /** Overrides the global default only where the community convention differs (FR-018a). */
  indent?: IndentProfile;
}
```

`PLAIN_TEXT_ID = 'plaintext'` is a **first-class value**, not an absence (FR-004c/FR-011): it is
selectable in the picker *and* in the extension map, and choosing it **terminates** precedence.

**Jupyter is a descriptor, not a bare extension (A1).** FR-001 counts it among the **31 targets**, and the
registry test asserts all 31 are *present as descriptors* — so it must be one:
`{ id: 'jupyter', name: 'Jupyter Notebook', extensions: ['.ipynb'] }`, **reusing the JSON grammar** (FR-009:
a notebook is highlighted as the raw JSON it is on disk). It therefore needs its own entry in the loader map
(T027) pointing at the JSON grammar, or T122's registry↔loader set-equality assertion fails. Hanging `.ipynb`
off the JSON descriptor instead would leave only **30** descriptors and fail the count.

**Invariants (registry tests)**
- No extension is claimed by two descriptors (FR-004a). One language may claim many.
- Every `id` is unique; `.h` → `cpp` by fiat (FR-004a).
- `filenames` is empty for every descriptor in Part 1 (FR-002b).
- All 31 targets of FR-001 are present.

---

## 2. Language resolution (pure core)

```ts
export type LanguageSource = 'override' | 'user-mapping' | 'registry' | 'plaintext';

/** Which rung of the precedence chain decided the language (FR-005a). */
export interface LanguageResolution {
  languageId: string;      // PLAIN_TEXT_ID when nothing matched
  source: LanguageSource;
}
```

**Precedence, highest first (FR-005a)** — document override → user extension mapping → built-in
registry → plain text.

Two rules that must not be conflated (FR-004c vs FR-005b):
- An **explicit Plain Text** at any rung is a *decision*: it **terminates** the chain, yielding
  `{ plaintext, source: <that rung> }`.
- An **unresolvable id** (a language a later build removed) contributes **nothing** and **falls
  through** to the next rung. The stored id is **preserved**, never rewritten (FR-005b), so a build
  that reintroduces the language resolves it again.

---

## 3. Inferred indentation (pure core)

```ts
/** The style deduced from the document's opening lines, or null when inconclusive. */
export type InferredIndent = { style: 'tabs' } | { style: 'spaces'; width: number } | null;
```

Algorithm (FR-018c) — bounded and **O(1) in document size**:
- Sample the first `min(ceil(0.10 × lineCount), 100)` lines, **never fewer than one**.
- Inspect only each sampled line's **first 20 characters**.
- Consider only lines beginning with whitespace.
- Any considered line whose leading whitespace starts with a **tab** ⇒ `tabs`.
- Otherwise ⇒ `spaces`, width = the **most frequent** leading-space count, ties → **smaller**.
- A line whose leading whitespace runs **past** the inspected 20 chars has an **indeterminate** width
  and is **excluded from the tally** — it must not be counted as width 20.
- No considered lines ⇒ `null` ⇒ the effective language's configured profile applies.

**Effective indentation** = inferred ?? language profile ?? global default. It is **document** state: it
decides which characters enter the buffer (FR-028a).

---

## 4. Settings (`EditorSettings`, extended — `packages/core/src/config/app-settings.ts`)

```ts
export interface EditorSettings {
  // … 9 existing fields unchanged …

  /** Global indentation default; every language inherits it unless it overrides (FR-018a). */
  indent: IndentProfile;                              // ships { style: 'spaces', indentWidth: 2, tabWidth: 4 }
  /** Per-language overrides, keyed by language id (FR-018). Ships NON-EMPTY — see below. */
  indentByLanguage: Record<string, IndentProfile>;
  /** User remaps of extension → language id (FR-004b). Ships EMPTY. */
  languageByExtension: Record<string, string>;        // e.g. { '.h': 'c' }
  /** Persist the undo history alongside the recovery snapshot (FR-027c). */
  persistUndoHistory: boolean;                        // ships true
}
```

### The shipped `indentByLanguage` map — enumerated

FR-018a says overrides ship **only where the language's established convention differs** from the global
default (2 spaces). The spec deferred the concrete list to planning; **this is that decision.** It must be
enumerated *before* implementation, because T068 asserts *"reset restores the shipped set"* — an assertion
written against a list nobody decided is an assertion against whatever the implementer happened to invent.

```ts
{
  go:         { style: 'tabs',   indentWidth: 4, tabWidth: 4 },  // gofmt: tabs, non-negotiable
  python:     { style: 'spaces', indentWidth: 4, tabWidth: 4 },  // PEP 8
  csharp:     { style: 'spaces', indentWidth: 4, tabWidth: 4 },  // dotnet/runtime, MS convention
  cpp:        { style: 'spaces', indentWidth: 4, tabWidth: 4 },
  c:          { style: 'spaces', indentWidth: 4, tabWidth: 4 },
  java:       { style: 'spaces', indentWidth: 4, tabWidth: 4 },
  kotlin:     { style: 'spaces', indentWidth: 4, tabWidth: 4 },
  swift:      { style: 'spaces', indentWidth: 4, tabWidth: 4 },
  php:        { style: 'spaces', indentWidth: 4, tabWidth: 4 },  // PSR-12
  rust:       { style: 'spaces', indentWidth: 4, tabWidth: 4 },  // rustfmt
  powershell: { style: 'spaces', indentWidth: 4, tabWidth: 4 },
  shell:      { style: 'spaces', indentWidth: 4, tabWidth: 4 },
  sql:        { style: 'spaces', indentWidth: 4, tabWidth: 4 },
}
```

**Everything else inherits the 2-space global default** — JavaScript, TypeScript, JSON/JSONC, YAML, HTML, CSS,
SASS/SCSS, LESS, Vue, XML, Markdown, TOML, INI, Ruby, Lua, Dart, and plain text. That is the majority, which is
why 2 spaces is the *global* default rather than 4.

**Makefile is deliberately absent.** Its convention (tabs, mandatory) is well known, but it is **unreachable in
Part 1** — Makefiles have no extension, and exact-filename descriptors are out of scope (FR-002b). Shipping an
override keyed to a language id that has **no registry descriptor** would be a default nothing can ever
resolve. It is recorded here in prose only, so the feature that adds exact-filename descriptors (#70) does not
have to re-derive it.

**Clearability (FR-022c) — the two maps get opposite answers, which is the point of declaring it:**

| Setting | `clearable` | Why |
|---|---|---|
| `languageByExtension` | **true** | Ships empty; empty is a valid state — detection falls back to the built-in registry (which is not a setting). |
| `indentByLanguage` | **false** | Ships non-empty and has no "no answer" state. Emptying it is a **reset dressed as a clear**, and 015 FR-013 requires the two stay tellable apart. |
| `indent` | false | A required profile; empty is not a value. |
| `persistUndoHistory` | false | A boolean. |

**Reset (FR-022b)** needs **no new core logic**: `resetSettingValue` addresses by dotted path and clones
the shipped value wholesale, so `path = 'editor.indentByLanguage'` already restores the **whole map**.
Defaults flow into 010's record automatically, because `buildShippedDefaults()` clones
`DEFAULT_APP_SETTINGS` — nothing is hand-copied.

**Parser (tolerant, never throws)**: both maps follow the `terminals.defaultParams` precedent — an
explicit `{}` is **honoured** (it is a record; the loop runs zero times), a non-record falls back to the
default, and individual entries with invalid values are **dropped per-entry**. `structuredCloneSettings`
does a **shallow** `{...s.editor}` today and must **deep-clone** the two maps, or the frozen shipped
record would leak shared references into a mutable parse result.

### Metadata (F5/F6 — the changes that stop the build failing)

- `ControlKind` gains `'map'` (14th kind).
- `FieldDescriptor` gains `columns?: readonly MapColumn[]` — the key column plus one or more typed value
  columns, each reusing an existing control (dropdown / number / text / toggle). This mirrors the existing
  `itemControl?: ControlKind` precedent for `array`.
- `settingsLeaves()` **stops at a map**: a key whose descriptor declares `control: 'map'` is **one leaf**,
  not one leaf per entry. Without this, a non-empty map fails the completeness test outright (F5).
- `emptyValueFor`, `canClear` and `auditClearable` gain a **map arm** (`{}` / `Object.keys(v).length > 0`),
  or a clear writes `''` into a `Record` and the audit fails to notice (F6).
- `terminals.defaultParams` gains the descriptor it has always lacked — the pre-existing JSON-only
  setting this work closes.

---

## 5. Keybindings — the dispatch scope (`packages/core/src/config/keybindings.ts`)

```ts
/** A context a command's chord is live in. "Global" is simply the full set (FR-017b0). */
export type DispatchScope = 'editor' | 'terminal' | 'explorer';

/** Every registered command declares a NON-EMPTY set. There is no default. */
export type CommandScopes = Readonly<Record<ActionId, ReadonlySet<DispatchScope>>>;
```

### Command naming — the single source of truth (L2)

The spec names commands in prose (`cut-line`); the code needs an `ActionId`. **This table is the mapping;
no other artifact may restate it.** Existing ids are `dot.camelCase` (`file.cut`, `editor.saveAll`,
`terminal.scrollLineUp`), so the new ones follow that convention rather than inventing a kebab-case scheme.

| Spec name | `ActionId` | Scope | Windows default |
|---|---|---|---|
| `cut-line` | `editor.cutLine` | `{editor}` | `Ctrl+X` |
| `indent-lines` | `editor.indentLines` | `{editor}` | `Tab` |
| `outdent-lines` | `editor.outdentLines` | `{editor}` | `Shift+Tab` |
| `column-select-up` | `editor.columnSelectUp` | `{editor}` | `Shift+Alt+ArrowUp` |
| `column-select-down` | `editor.columnSelectDown` | `{editor}` | `Shift+Alt+ArrowDown` |
| `column-select-left` | `editor.columnSelectLeft` | `{editor}` | `Shift+Alt+ArrowLeft` |
| `column-select-right` | `editor.columnSelectRight` | `{editor}` | `Shift+Alt+ArrowRight` |

**Seven** commands — no more (FR-017c: Cut/Copy/Paste/Select All/Undo/Redo keep their **native OS bindings**
and are deliberately **not** registered, so they interoperate with the rest of the system).

Each also needs a `control: 'chord'` **editor-metadata descriptor**, or the shipped completeness test
(`keybindings-metadata.test.ts`, which enumerates `Object.keys(DEFAULT_KEYBINDINGS.bindings)`) **fails the
build** the moment the ids are added.

**Shipped defaults are platform-keyed (FR-017e)** — only Windows values populated; the *shape* takes
macOS/Linux later without a schema change:

| Command | Windows default |
|---|---|
| `editor.cutLine` | `Ctrl+X` — coexists with `file.cut` (`{explorer}`); scopes are disjoint |
| `editor.indentLines` | `Tab` |
| `editor.outdentLines` | `Shift+Tab` |
| `editor.columnSelect*` | **`Shift+Alt+Arrow…`** — canonical order (F2), *not* `Alt+Shift+…` |

**Scope assignment for all 36 shipped commands** — required, since an unscoped command fails the
completeness test:

| Commands | Scope set |
|---|---|
| `file.*` (rename, cut, copy, paste, delete) | `{explorer}` |
| `terminal.scroll*` | `{terminal}` |
| `search.*`, `editor.save*` | `{editor, terminal}` |
| `zoom.*`, `panel.zoom*`, `focus.*`, `view.*` | `{editor, terminal, explorer}` |
| the seven new editor commands | `{editor}` |

**Collision rule (FR-017b1)**: two commands conflict **iff their scope sets intersect** on a shared
chord. Enumerated **from the registry**, never from a hand-listed set of features. `cut-line` and
`file.cut` therefore both keep `Ctrl+X` legitimately.

---

## 6. Clipboard (main-process, in-memory — FR-015c)

```ts
export type ClipboardMode = 'verbatim' | 'full-line' | 'rectangular';

/** throng's most recent clipboard write. Process-lifetime only; never persisted. */
export interface ClipboardRecord {
  text: string;   // exactly what was written to the OS clipboard
  mode: ClipboardMode;
}
```

**The mode belongs to the content, not the widget.** One record in UI main, shared by every panel in
every window. On **every paste** it is validated against the live OS clipboard's text (through the
`IClipboard` seam): if the clipboard no longer holds the text throng wrote, the record is **treated as
absent** and the paste is **verbatim**. Self-correcting — no polling, no clipboard observer.

The OS clipboard carries **plain text only**, both directions. No custom format is ever written.

**Mode is decided by the selection, not the command (FR-016b)**: rectangular selection ⇒ `rectangular`;
**every** cursor a bare caret ⇒ `full-line`; anything else (including a mixed set) ⇒ `verbatim`.

---

## 7. The document authority (main-process — FR-028f, constitution XI)

**The canonical document lives in UI main.** Every `EditorView` is a *derived replica*. This is what
constitution Principle XI's *"one authority, not two peers"* requires, and it is the entity the undo
history (§7.1) hangs off.

```ts
/** The single source of truth for one open document. Held ONLY in UI main. */
export interface DocumentAuthority {
  documentId: DocumentId;    // the document's identity — see the note on keying below
  text: string;              // canonical content
  version: number;           // monotonic; bumped once per applied change
  savedVersion: number;      // the version last written to disk
  history: DocumentHistory;  // §7.1 — the stack belongs to the AUTHORITY, not to a view
}

/** view → main. A change the user has ALREADY seen applied locally (FR-028f: no typing latency). */
export interface InFlightChange {
  documentId: DocumentId;
  panelId: string;           // the originating view, so its cursor can be returned (FR-026f)
  changes: unknown;          // serialised CodeMirror ChangeSet (toJSON)
  baseVersion: number;       // the version this change was computed against — MAY be stale
  selectionBefore: unknown;  // for the undo entry (FR-026a)
}

/** main → every view. The ONE ordered, canonical change stream. */
export interface CanonicalChange {
  documentId: DocumentId;
  changes: unknown;          // possibly REBASED (ChangeSet.map) from what the view sent
  version: number;           // the version AFTER applying it
  dirty: boolean;            // DERIVED by the authority — never sent by a view
  echoTo?: string;           // panelId whose optimistic local copy this supersedes, when rebased
}

/** main → the invoking view ONLY, after undo/redo (FR-026f). Other views keep their own cursors. */
export interface RestoreSelection {
  documentId: DocumentId;
  panelId: string;
  selection: unknown;
}
```

**Dirty state is derived, never relayed** (FR-028f; `contracts/document-authority.md` § *Dirty state*):
`dirty === (version !== savedVersion)`. A relayed `dirty` flag would be a **second peer-owned value** —
exactly what Principle XI forbids. Undo past a save therefore re-dirties the document for free (FR-026d),
with no special case.

**`echoTo` is the easy bug.** When a rebase changes what a view sent, that view's optimistic local copy is
**wrong** — so the canonical change MUST be echoed **back to the originator too**. Suppressing the echo to
the sender (the obvious "don't send it to itself" optimisation) leaves the one view that *made* the edit as
the only view that has it wrong.

### Applying a change (the rebase — FR-028f)

| `baseVersion` vs `version` | Main does |
|---|---|
| **equal** (the common case) | apply directly; `version++`; broadcast |
| **stale** (`baseVersion < version`) | **rebase**: `ChangeSet.map()` it over the changes that landed in between, apply the rebased form, `version++`, broadcast the **rebased** change — *including back to the originating view*, whose optimistic local copy is now wrong |
| **ahead** (`baseVersion > version`) | impossible — a view cannot outrun the authority; treat as a bug and fail loudly rather than guessing |

A stale change is **never rejected**: the view has already shown the user their keystroke, and rejecting
it would visibly revert input the user watched themselves type (FR-028f).

### Keying: `documentId`, not `panelId` (finding D18)

`DocumentId` is the **document's** identity, not a view's. In Part 1 a file is open in at most one Editor
Panel (research F8), so it is **aliased to `panelId`** and mirrored views share it — but it MUST be named
for the document, so that a future second panel on one file cannot silently split the authority in two,
which is the precise failure Principle XI exists to prevent.

## 7.1 Undo history (owned by the authority — FR-026/FR-027a)

```ts
export interface UndoEntry {
  changes: unknown;          // serialised CodeMirror ChangeSet (toJSON)
  inverted: unknown;         // its inverse, for undo
  selectionBefore: unknown;  // the cursor/selection set to restore (FR-026a)
}

export interface DocumentHistory {
  undo: UndoEntry[];   // bounded: ≥ 500 entries, oldest discarded (FR-026d)
  redo: UndoEntry[];
}
```

Scope is the **document**, never the panel (FR-026e). Lifetime = the buffer's:

| Event | History |
|---|---|
| Save | **survives** — undo past a save re-dirties the document (saving is not a barrier) |
| View opens / closes / moves window | survives while **any** view remains |
| Revert / external reload | **cleared** — it describes content that no longer exists |
| Last view closes (normal) | **cleared** — the buffer dies |
| **Crash** | **survives**, restored with the recovered document (FR-027a) |

An entry's recorded cursor set is applied to **the panel where Undo was invoked** (FR-026f) — other
panels keep their own cursors. Undo never yanks the viewport of a panel the user did not act in.

---

## 8. Recovery artefact (schema change — FR-027a/D11)

`%APPDATA%/throng/recovery/<encodeURIComponent(panelId)>` changes from **raw text** to **JSON**:

```ts
export interface RecoverySnapshot {
  version: 1;
  text: string;
  /** Omitted when editor.persistUndoHistory is false (FR-027c). */
  history?: DocumentHistory;
}
```

- **Size-bounded** (FR-027a): the persisted history is capped by **total serialised size**, oldest entries
  dropped first, so a session of large edits can never bloat the snapshot or slow the debounced writes
  recovery depends on. The ≥500-entry bound governs the **in-memory** history; the size cap governs the
  **persisted** one — so a recovered history may be **shorter** than the live one.
- **Legacy tolerance**: a file that does not parse as JSON is read as `{ text: <raw> }`, so a snapshot
  written by the previous build survives the upgrade.
- **Containment (FR-027b)**: it holds text the user *removed*. It lives only in the snapshot's protected
  per-user location, is deleted whenever the snapshot is (normal close; discard after successful
  recovery), and never reaches logs or telemetry. Turning `persistUndoHistory` **off purges** what is
  already on disk.

---

## 9. Per-document state (SQLite v7 — FR-028e)

```sql
CREATE TABLE document_state (
  owner_user   TEXT NOT NULL,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rel_path     TEXT NOT NULL,          -- project-relative; a file belongs to exactly one project
  language_id  TEXT,                   -- NULL = no override
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (owner_user, project_id, rel_path)
);
CREATE INDEX idx_docstate_owner_project ON document_state(owner_user, project_id);
```

- **Identity**: owner + project + project-relative path (Principle I — a file belongs to exactly one
  project). Composite PK mirrors `workspace_layout` exactly.
- **Shaped for per-document state in general**, not this one column (FR-028e): `encoding` and
  `line_ending` are the declared next occupants (the status strip already anticipates them, FR-010c) and
  must join **without a redesign**. Any column added *later* must be registered in `schema-guard.ts` with
  a `NOT NULL DEFAULT`; a fresh `CREATE TABLE` needs no registration.
- **Cascade on project delete is free** — the FK plus the per-connection `PRAGMA foreign_keys = ON`.
- **Pruning**: rows whose file no longer exists are removed, so the table cannot grow without bound.
- **Rename/move within throng carries the row** with the file.
- An override for a file that is **not currently open** still persists — that is the entire point: a panel
  opening it **later** adopts it rather than re-detecting.
- **It is document state, not configuration**: it does **not** appear in the Settings editor, and the
  Configuration-editor completeness rule does not apply to it (a grid of file paths is not a preference).

**Retires two guards** (F7): `no-editor-migration.integration.test.ts` (named by the spec) **and**
`user-version-pin.integration.test.ts` (not named, and would fail identically). Both are rewritten as an
explicit, reviewed change — never deleted quietly to make a migration pass.

---

## 10. Theme tokens

**Ten syntax tokens** — `syntaxKeyword`, `syntaxString`, `syntaxComment`, `syntaxNumber`, `syntaxType`,
`syntaxFunction`, `syntaxVariable`, `syntaxOperator`, `syntaxPunctuation`, `syntaxInvalid`.

**Status-strip tokens** — **`editorStatusStripBg`**, **`editorStatusStripFg`**, **`editorStatusStripHover`**.

> **The `editor` prefix is load-bearing, not decoration.** The theme already ships **`statusBarBg`** for the
> *application chrome*; a bare `statusStripBg` sits one letter away from it, and `theme-copy` forbids a
> description that merely restates its identifier — so the copy must actively distinguish *"the strip along the
> bottom of an editor panel"* from the app's status bar. Renaming after 15 bundled themes have shipped values
> is a 15-file churn, so the name is fixed **here**, before any palette is authored.

*(The strip's active/inactive treatment **reuses 012's** `activePanelBorder` / `activePanelBorderInactive`
rather than inventing a parallel pair — FR-010g. The map control's add/remove-row affordances **reuse the
existing `add` and `destroy` icon tokens** — this feature adds **no** icon tokens, so its theme keys remain
**two sets, and only two**, exactly as the spec's Assumptions state.)*

Each token needs:
- a value in **every** bundled theme, via each theme's `Palette` (so 014's *Restore All* cannot leave code
  unstyled);
- **hand-written** copy in `THEME_TOKEN_COPY` avoiding `BANNED_ABBREVIATIONS` (notably `bg`/`fg`) and not
  equal to `mechanicalCopy(key)`;
- automatic Themes-editor exposure and completeness coverage (both derive from `THRONG_THEME`).

`SHIPPED_DEFAULTS_VERSION` **2 → 3**, or existing installs never materialise the tokens.

**Distinctness (FR-007c)**: palettes are drawn from **each theme's own character**. A copy-pasted palette
provably fails the build — `4.469 × 33/43 ≈ 3.43 < 4.3`. `CLOSEST_LEGITIMATE_PAIR_DELTA` is re-measured
and updated (it is asserted to 2 dp), and recalibrated **only** if the closest *legitimate* pair genuinely
moved.
