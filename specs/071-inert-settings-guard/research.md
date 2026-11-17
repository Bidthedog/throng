# Research: No Inert Settings Guard (071)

All findings below were measured on `feature/S071-I108-inert-settings-guard` at `442ad306` (master after PR #633),
Linux, with a throwaway prototype kept outside the repository.

## R1 — Type-graph resolution, not typed accessors

**Decision**: Resolve reads with the TypeScript compiler API, following each value from the `AppSettings` root
through property and element access, aliases, destructuring and call arguments. No setting reader is rewritten.

**Rationale**: The prototype resolved every one of the 150 descriptors with no false positives (R6), and the issue's
acceptance case passes: `explorer.dragCopyModifier`, read only through `explorerSettings.dragCopyModifier`, resolves
to `packages/ui/src/renderer/explorer/file-tree.tsx`. Typed accessors would mean rewriting every settings read in
the renderer, main and daemon (hundreds of call sites) to make the check possible, which is a large refactor for no
behaviour change, and it would still need a reference check to tell whether each accessor is called.

**Alternatives considered**:

- *Typed accessors* (`settings.explorer.dragCopyModifier()`), as the issue allows: rejected for the cost above.
- *A text or regex scan*: barred by 019 C16 and FR-009.
- *`LanguageService.findReferences` per property symbol*: rejected. It resolves by symbol identity, so it misses a
  section passed into a parameter of a separately declared "mirror" type (`DestroyConfirmSettings`,
  `core/src/workspace/destroy.ts`) or a `Pick<>`. It also merges every key of a shared shape (`PaneState` serves
  both `panes.projects` and `panes.fileExplorer`), which breaks FR-006.

## R2 — One program over every package's source

**Decision**: Build **one** `ts.Program` whose root files are every `packages/*/src/**/*.{ts,tsx}`, using the
renderer's compiler options (JSX, DOM libraries, `Bundler` resolution) plus a `paths` map sending each `@throng/*`
import to that package's `src/index.ts`. This is the same aliasing `vitest.config.ts` uses.

**Rationale**: Measured both ways.

| Shape | Time | Result |
|---|---|---|
| One program per tsconfig (11 programs) | 18.2 s | 14 false positives: every read in a core function called from another package (the call resolves to core's `dist` `.d.ts`, whose body is in a different program) |
| One program over all source | **12.0 s**, 1,102 source files | **0 false positives** |

One program makes the flow from a renderer call site into a core function body visible. It is faster too,
because core is checked once rather than once per dependent package. The program does not need to type-check
cleanly: only symbol, signature and type resolution are used. It also reads no `dist` output, so the check
needs no prior build.

## R3 — What carries a settings path

**Decision**: An expression carries a set of **key paths**. A path is computed, never matched by name text:

1. **Root**: an expression whose type is the `AppSettings` interface carries `''`.
2. **Property access** `x.name` and **element access** `x[k]` extend the paths of `x` by `name`, or by every
   string-literal member of `k`'s type. A non-literal key reaches every child, so it extends to `*` (see R4).
   An extension survives only if the resulting path exists in the settings tree.
3. **Aliases**: an identifier bound by `const`/`let` to an initializer carries that initializer's paths. An
   identifier bound by a destructuring element carries the element's paths.
4. **Arguments to parameters**: at every call (`f(a)`, `new C(a)`) and every JSX element (`<C p={a}/>`) in a
   non-configuration-layer file, the argument's paths are bound to the callee's parameter (or to the matching
   destructured prop), and repeated to a fixpoint (it converged in 3 passes). This covers mirror types, `Pick<>`
   types and resolvers such as `resolveResourceMonitorSettings` (`core/src/resources/settings-resolution.ts`).
5. **Type fallback**: when none of the above applies, an expression whose *object* type is a type in the settings
   tree carries every path of that type (for example, a hook returning `ExplorerSettings`). **Primitive types never
   fall back.** Letting `number` match every numeric setting attributed `resourceMonitor.cpuWarningPercent` to
   `icon-button.tsx`, which is the over-approximation FR-006 forbids.

A **read** is a property access, element access or object-destructuring element, outside the configuration layer
and not the target of an assignment, whose result path exists. A descriptor key is read when a read path equals
it or lies beneath it.

**Rationale**: Every case in spec User Story 3 is one of these rules, and the prototype exercised each against
real code. Attributing reads by path, not by symbol, is what keeps `panes.projects.maxWidth` and
`panes.fileExplorer.maxWidth` apart while still following a mirror-typed parameter.

**Known limits** (recorded, accepted):

- A read that only *forwards* the value (copies it into an IPC payload) counts as a reader. FR-003 promises the
  wire exists, not that the effect is right.
- A value that crosses an untyped boundary (`JSON.parse`, IPC deserialisation, `any`) loses its path. If that
  were a setting's only route, the setting would be reported unread. That fails loud, and the cure is to type the
  receiving side with the settings type. The first run found none.
- A function typed on a shared shape (`PaneState`) and reached only through the type fallback counts for every
  path of that shape. This is FR-006's second sentence, by type rather than by call.

## R4 — Map-shaped sections

**Decision**: An index signature in the settings tree contributes a `*` segment. The descriptor
`editor.previews.providers.markdown.gutter` matches the read path `editor.previews.providers.*.gutter`.

**Rationale**: `editor.previews.providers` is `Record<string, ProviderSettings>` and is read as
`s.providers[provider.id].gutter`. Without the wildcard, all 11 provider descriptors were reported unread. With it,
none are. A descriptor whose own key is a map (`editor.indentByLanguage`) is read when the map is read: its entries
are user data, not keys (spec, Edge Cases).

## R5 — The configuration layer

**Decision**: These files and folders are never readers. The list lives in the guard's policy module, so that
adding to it is a reviewed change (FR-007):

| Module | Why it names every key |
|---|---|
| `core/src/config/app-settings.ts` | declaration, parse, defaults |
| `core/src/config/settings-metadata.ts`, `metadata.ts` | the descriptor registry |
| `core/src/config/shipped-defaults.ts` | shipped-defaults generator |
| `core/src/config/settings-read.ts`, `bounds-guard.ts`, `settings-validity.ts` | guarded parse and validation |
| `core/src/config/settings-search.ts`, `overridden.ts`, `config-patch.ts` | generic by-path machinery |
| `ui/src/renderer/preferences/` | the Preferences window, which renders every descriptor |

**The whole Preferences window is in the layer, not only its form.** Excluding a file can only make a setting
look *unread*, so a real reader inside `renderer/preferences/` would surface as a loud finding, never as a masked
one. The first run found no setting read only there. A setting that genuinely governs the Preferences window
itself would be the trigger to narrow the entry to the form modules.

**Persistence modules are not in the layer** (spec FR-007). They move whole documents, so they record no
reads of particular keys, except where they act on one value. Measured: `appearance.theme`'s only readers are
`ui/src/main/config-watcher.ts`, which loads the active theme file named by it, and
`ui/src/renderer/config/config-store.tsx`, which reloads that theme when its file changes. Both are the setting
taking effect. Putting them in the layer would report a live setting as inert.

`core/src/config/preview-settings.ts` and `starting-folder.ts` are **not** in the layer either. They interpret a setting
for the code that uses it (preview provider lookup, the new-project starting folder), which is reading.

**Rationale**: The prototype ran with this list. Removing a real reader from scope (hiding `file-tree.tsx` and
`destroy.ts`) flagged exactly the 10 settings those files read: the five `confirmations.*`, `editor.openOnClick`,
`explorer.autoRevealActiveFile`, `explorer.dragCopyModifier`, `explorer.dragMoveModifier` and
`explorer.popoverDelayMs`. So the layer list does not mask genuine readers elsewhere.

## R6 — First run: no inert settings today

**Decision**: The first full run over all 150 descriptors reports **zero** unread settings. FR-012's table records
that, and the allowlist ships empty.

**Rationale**: The ten per-feature guards, and 019's removal of `explorer.openMode`, already caught what this guard
would have found. The mutation run in R5 shows the zero is not leniency, and the fixture tests (plan, *Testing*)
pin each rule separately.

## R7 — Where it runs, and its cost

**Decision**: Run it as a **unit** test in `packages/core/tests/unit/`, building the program once in `beforeAll`
with a stated 120 s hook timeout. The assertions then take milliseconds.

**Rationale**: Unit is the gate stage that already holds the repository-wide source guards
(`failure-logging-guard.test.ts`, `docs-currency.test.ts`, `no-os-imports.test.ts`), so it needs no new CI job.
The 12 s build is the whole cost (SC-005: under 60 s). The unit project's 15 s *test* timeout is not at risk,
because the build happens in the hook. The test needs no module mocks, so it stays in the shared `unit` project,
not `unit-isolated`.

**Alternatives considered**: a lint rule (type-aware ESLint rules see one file at a time, but the property here,
"no reader *anywhere*", is whole-program); a separate `npm run` script in its own gate stage (a new CI step for
something the unit stage can hold).

## R8 — The TypeScript API it depends on

**Decision**: Import `typescript`, the package the repository already pins to `@typescript/typescript6` (6.0.3)
and that `typescript-eslint` and `failure-logging-scan.ts` already use.

**Rationale**: TypeScript 7 (`@typescript/native`) is the build compiler, but it does not offer the JavaScript
compiler API. #435 (dropping the 6/7 side-by-side alias) is blocked on `typescript-eslint` for the same reason,
so this guard adds no new constraint to that issue. It is one more user of the alias, which #435 must account for.
