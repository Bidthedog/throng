# Contributing to throng

throng is **spec-driven and test-first by constitution**: every change follows the same
disciplined lifecycle the maintainers use — intent captured before code, outcomes proven
before merge. Please read this before opening an issue or PR. New to the app? Start with the
[README](README.md).

> **In short:** get a maintainer to **agree an issue** before you build; capture intent in a
> **clear, fully-specified spec**; deliver it **unit + integration + E2E tested**; keep the
> **docs current**. The **Claude Code + Spec Kit** toolchain (test-first, spec-driven discipline)
> is the recommended way to hit that bar — but **hand-written, non-AI contributions are equally
> welcome, held to the same testing bar.**

## Code of conduct

Be respectful, assume good faith, and keep discussion on the work. Harassment and personal
attacks aren't tolerated in any project space. Maintainers may edit, lock, or remove violating
contributions and bar repeat offenders. Report concerns privately to the maintainers.

## Non-negotiables

A PR **cannot merge** unless all of these hold:

- [ ] A **GitHub issue exists and a maintainer has explicitly agreed it in a comment** on that issue, before the PR was opened. Agreement is a written "agreed" from a maintainer — there is no label for it.
- [ ] The issue is **labelled** — exactly one type (`bug` / `enhancement` / `tweak` / `documentation`) and at least one `area:*`. See [Labelling](#labelling).
- [ ] **Authoring** — either produced with the recommended AI toolchain, driven by **Claude Opus 4.8 or a more capable model**, *or* hand-written without AI. Either way every gate below applies.
- [ ] **Tested at the layer that can prove it** — unit, component, integration and E2E observed green (not merely built/type-checked); every change ships coverage at the **lowest layer that can prove it**, and E2E is reserved for what no lower layer can observe (constitution V). Hand-written work is tested **at least as thoroughly as the AI workflow produces**.
- [ ] **For AI / spec-driven changes** — a **fully specified spec** under `specs/<NNN-slug>/` with no `[NEEDS CLARIFICATION]` left, `/speckit-analyze` clean of critical/high findings, and `/speckit-converge` run so code and spec agree.
- [ ] The PR states **intent and outcomes in plain, human terms**.
- [ ] The change complies with the **[constitution](.specify/memory/constitution.md)**.
- [ ] **Docs are current** — `README.md` (finite current state), the `docs/` guides your change affects, and this `CONTRIBUTING.md` if the process changed.
- [ ] Changes are **squashed into a small number of commits (< 5)**.

## How contributions are built

The toolchain below is the **recommended, best-supported** path — how the maintainers work.
**AI is optional.** What's mandatory is the *outcome* it guarantees — an agreed issue, a clear
spec, convergence, equally-thorough tests, and current docs — not the tool. A hand-written
contribution that meets that bar is as welcome as an AI-driven one; one that doesn't is sent
back regardless of how it was authored.

| Tool | Role | Link |
|---|---|---|
| **Claude Code** | The coding agent the AI path runs through. | <https://claude.com/claude-code> |
| **Spec Kit** | The design artifacts and test-first execution: constitution, spec, clarify, plan, tasks, analyze, implement, converge. | <https://github.com/github/spec-kit> |

**Model floor (AI path):** if AI-driven, it **must** be **Claude Opus 4.8 or better** — the
spec-driven, test-first discipline degrades badly on weaker or older models. State in your PR
which model you used, or that the work was hand-written. **Every artifact passes human review
before commit**, and you own the correctness, licensing, and quality of what you submit however
it was produced.

## The lifecycle

```
issue (agreed) → /speckit-specify → /speckit-clarify → /speckit-plan → /speckit-tasks
              → /speckit-analyze → /speckit-implement → /speckit-converge
              → tests green (unit + integration + e2e) → docs current → pull request
```

1. **Issue, agreed** — search first, open with a template, [label it](#labelling), describe *intent* (what a user needs and why), and wait for a maintainer to **agree it in a comment**. A PR without an agreed issue is closed. *(Trivial typo/link/doc fixes may skip the spec steps but still need an agreed issue.)*
2. **Spec** — `/speckit-specify` then `/speckit-clarify` until every `[NEEDS CLARIFICATION]` is gone and requirements are testable and unambiguous.
3. **Plan & analyse** — `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze`; resolve every critical/high finding before building.
4. **Implement (TDD)** — `/speckit-implement` drives test-first execution (Red → Green → Refactor). Hand-writing instead is fine, but apply the same discipline and coverage by hand.
5. **Converge & document** — `/speckit-converge` until code and artifacts agree, and bring the `README`, the affected `docs/` guides and `CONTRIBUTING` current **in the same change**.
6. **Pull request** — branch from `master`, complete the whole PR template, link the agreed issue, and attach passing test output.

**Constitution check** — every plan must pass the Constitution Check gate (11 principles).
Watch especially project-first isolation (I), platform-abstracted core behind contract-tested
seams (II), daemon-owned terminals with no orphaned processes (III), test-first + UI-needs-E2E
+ `@admin` gating (V), SOLID/DRY/YAGNI (VIII), one composition root per boundary (IX), and
injected config (X). Violations must be revised, or justified in the plan's Complexity Tracking.

**Intent & outcomes** — both spec and PR must let a reviewer who has never seen the code
restate, in plain language, *what a user needs and why* (intent) and *what changed and how we
know it works* (outcomes). If they can't, it isn't clear enough yet.

## Labelling

Labels are how the backlog is filtered and picked up, so an unlabelled issue is invisible rather
than merely untidy. **Every issue carries exactly one type and at least one area.** The issue
templates apply the type for you; the area is yours to add.

| | Labels | Rule |
|---|---|---|
| **Type** (exactly one) | `bug`, `enhancement`, `tweak`, `documentation` | The type decides the template and the title prefix. |
| **Area** (one or more) | `area:editor`, `area:explorer`, `area:terminal`, `area:preferences`, `area:themes`, `area:ui-shell`, `area:projects`, `area:vcs`, `area:agents`, `area:extensibility`, `area:infra`, `area:platform` | Where the work lands. Add every area the change touches. |
| **Milestone** | `v1.0.0`, `v1.0.1`, `vNext` etc | Maintainers schedule this. `vNext` is a **placeholder for unscheduled work**, not the next release. |

Choosing the type — stop at the first that matches:

- **Bug** — shipped behaviour contradicts its own intent: it crashes, returns the wrong result, regresses, or does X where the spec/docs/UI say Y. A one-character fix is still a Bug. "This design is poor" is *not* a Bug.
- **Enhancement** — adds a capability that does not exist today. After it ships a user can do something they could not do before. Large ambitions are Enhancements too — throng has no "feature" type; `area:*` does the grouping, and related issues are linked to each other in the body.
- **Tweak** — adjusts something that already works without adding any capability: copy, spacing, colour, ordering, a default. If it were never done, nothing would be *missing* — only slightly worse.
- **Documentation** — docs-only work. Takes the `documentation` label in place of a type.

The line between Enhancement and Tweak is **new ability, not effort**: "let users pick their font
size" is an Enhancement; "the default font size should be 14, not 13" is a Tweak. If a request
contains both a bug and a wish, **split it** — otherwise one of the two is silently dropped when
the other is done.

**Titles** are `[Type] Summary` — the prefix matches the type label, and the summary is short
enough to scan in a list. Detail belongs in the body, never the title.

## Testing

Layered and test-first — the runner commands are in the [README](README.md#commands). Beyond
"all green, on observed output, never assumed":

- **Test-first** (Red → Green → Refactor): tests written and seen failing before the code.
- **Same bar regardless of authoring** — hand-written changes ship coverage at least as thorough as the AI workflow would produce.
- **Every change ships passing coverage at the lowest layer that can prove it.** A pure decision is a
  unit test; what a component renders, focuses or announces is a **component** test; persistence, IPC
  and configuration are integration. **E2E is reserved** for what no lower layer can observe — real
  window lifecycle and multiple windows, focus and z-order, native menus and dialogs, OS
  drag-and-drop, terminal keyboard and rendering fidelity, and process-tree hygiene. Every E2E test
  carries one significance tag (`@core`, which gates CI, or `@extended`, which runs at release) and
  at least one category tag, and the suite has a build-enforced budget.
- **New OS-abstraction seams** (`IShellDetection`, `IPtyHost`, `IDirectoryLock`, …) need contract tests.
- **Process-lifecycle** behaviour (spawn, detach, persist, idle-close, reattach, no-orphans) needs automated tests, including process-level E2E where the constitution requires it (III).
- **`@admin` tests are elevation-gated** — skipped unless elevated, and excluded from the normal suite unless `THRONG_E2E_INCLUDE_ADMIN` is set. Run them locally with `npm run test:e2e:admin`; a green non-elevated bar never implies admin coverage. **CI now runs the `@admin` subset** in a dedicated job (`E2E (@admin, elevated)`), because GitHub's Windows runners are elevated and are the only runner that can honour it.
- **A green CI bar does not cover the non-elevated path.** CI is *elevated*, so every spec calling `skipIfElevated()` self-skips there and is verified **only** by a developer running the suite from a non-elevated shell — put that run in the PR evidence, and state which specs it covers rather than implying CI covered them. A spec with no elevation guard does run on CI; don't claim a developer run is needed for it either. Overstating coverage in *either* direction is the failure this rule exists to prevent.
- **A flaky test FAILS the run.** `failOnFlakyTests` is set, so a test that only passes on retry turns the run red. A green run means every test passed on its **first** attempt. Retries are kept for their *diagnostic* value (they capture the first failure's trace), never to absorb a failure into a pass.
- **Write E2E that cannot flake.** Open with `settle(win)` — a *positive* assertion that the window rendered. A negative opening assertion (`toHaveCount(0)`) is satisfied by a DOM that has not rendered anything: it looks like a wait and settles nothing. Take geometry with `geom(locator)` (which polls until the element stops moving), never through `page.evaluate` + `querySelector` + `getBoundingClientRect`. Prefer a real condition over `waitForTimeout(n)`: a sleep asserts that *n* ms is always enough; a condition asserts the thing actually happened. See [docs/testing.md](docs/testing.md).
- **Quarantine, don't skip.** A test that cannot be made deterministic is tagged `@quarantine`, so what is *not* being tested stays countable: `THRONG_E2E_INCLUDE_QUARANTINE=1 npx playwright test --grep @quarantine --list`. Deleting it, or `test.skip`-ping it, hides the gap.
- **Write the guard like the REQUIREMENT, not like the change.** There is no jsdom layer, so a cross-cutting rule ("no hard-coded colour paints anywhere", "there are exactly two notice models") is enforced by a *source guard*: a unit test that WALKS THE TREE and asserts a property of the source. Shape it around what the requirement says, never around the files you happened to edit — a guard that checks the three files you remember passes while the rule is still broken in the fourth. Feature 018 is the case in point: a hand count found four dead CSS variables and five notice surfaces; the guards found **thirteen** and **nine**. A count made by hand is a count that is wrong.

Paste the relevant passing output in your PR — "tests pass" without evidence isn't enough.

## Coding standards

TypeScript 5.x / Node 20 (ESM); match the surrounding style and comment density. The
constitution's engineering principles are binding: **SOLID / DRY / YAGNI** (VIII);
**constructor injection only** — no service locators or ambient singletons, one IoC container
per process boundary (IX); **externalised typed config**, no magic values (X); and **no OS
calls in core** — everything OS-specific sits behind a contract-tested seam (II). Keep the
renderer sandboxed: it reaches privileged capability only through the preload bridge.

## Adding a preview provider

A preview provider is two files and two registration lines — nothing else in the codebase names a
provider, and a test holds it to that.

- **The descriptor** — `packages/core/src/preview/providers/<id>.ts`. Pure data, no OS and no DOM:
  the provider's id and display name, the file extensions it claims, whether it is `text` (its
  previews can be parented to an editor) or `binary` (always standalone), and any settings of its
  own.
- **The view** — `packages/ui/src/renderer/preview/providers/<id>/`. The renderer half: how the
  provider turns its content into what the preview panel shows, including its own styles. Its body
  loads lazily, on first use, so registering a provider pulls in none of its libraries **or its
  stylesheet** — a provider's document CSS lives in its own folder (e.g.
  `providers/markdown/markdown.css`) and is imported by its body module, not by the shared panel
  chrome (`preview/preview.css`), so it rides in the provider's own lazily loaded chunk. A body may
  honour optional props the panel passes it — `syncLine` (the source line to scroll to, for
  editor/preview scroll sync), `onLinkTarget` (report a hovered or keyboard-focused link's target,
  for the status-bar readout), `onTopLineChange` (report the top block's own source line as the
  reader scrolls the preview, for the editor half of two-way scroll sync) and `placePolicy` (where
  a followed link or a history step should land it) — and a body that ignores any of them still
  conforms: all are optional, and a provider with no source-line concept, no links, or no opinion on
  where to land simply never calls them, so its preview just does not drive the editor.
  A body that honours two-way sync may also read `syncEcho` (the line is where the editor went, so record it and do not scroll), return `false` from `onTopLineChange` (the panel could not act yet; report again on the next `syncLine`) and call `onTopLineRead` (hand the panel a reader for its top block's line, used when an editor is adopted) — all equally optional.
- **Registration** — one line in each of `packages/core/src/preview/providers/index.ts` (add the
  descriptor to `SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS`) and
  `packages/ui/src/renderer/preview/providers/index.ts` (add the view to `PREVIEW_PROVIDER_VIEWS`,
  keyed by the descriptor's id).

That's the whole surface. The preview panel and its menus, the editor's status bar and menus,
Files & Folders' **Open In → Preview**, the preferences editor and layout persistence all pick up a
new provider without being edited.

Two tests enforce it, not a review comment:

- `packages/ui/tests/component/preview-provider-seam.test.ts` injects a throwaway text provider and
  a throwaway binary provider (`packages/ui/tests/fixtures/preview/test-providers.ts` — test-only,
  neither ships) and asserts, through the real components and builders, that Files & Folders'
  **Open In → Preview**, the editor status bar, the default open action, the preview panel and its
  header menu, the settings tab and layout restore all handle them by kind — including drawing
  their controls disabled, not hidden, while a provider is turned off.
- `packages/ui/tests/unit/preview-surfaces-name-no-provider.test.ts` parses every source and
  stylesheet under `packages/ui/src` and `packages/core/src` outside the provider folders — not a
  list of known surfaces, so a new file is covered without editing the guard — and fails the build
  on an import from `preview/providers/` other than the two registration indexes, or on any
  Markdown-specific token outside comments: a `'markdown'` or `'.md'` literal or **regular
  expression** (matched by its pattern body, delimiters and flags stripped, so `/\.md$/` is caught
  the same as the string `'.md'`), an identifier such as `markdownView`, a CSS class. The few
  legitimate mentions (Markdown the editor language, the `.md` file icon) are allowlisted in the
  test with a reason each, and an allowance that stops matching fails too — so a surface
  special-cased to Markdown instead of reading the registry is caught before it merges.

## Adding a platform port

Principle II: `packages/core` states the rules, `packages/platform-*` answers the OS questions, and
a **contract suite** in `packages/core/src/testing/` decides whether an implementation is one. The
two ports clickable file links added are the current worked example, and a new platform gets links
working by implementing them and nothing else.

- **`IPathForms`** (`packages/core/src/abstractions/path-forms.ts`) — the four path *spellings* only
  an OS can map: `homeDirectory()`, `fromDriveForm()` (`/d/x` and `/mnt/d/x`), `fromFileUrl()` (a
  `file:` URI, percent-decoded, host to UNC) and `fromHomeForm()` (`~`). Every method is **total**
  and answers `null` rather than throwing when the input is not its form.
- **`IExecutableExtensions`** (`packages/core/src/abstractions/executable-extensions.ts`) — whether
  the OS would *run* a file, answered from its extension alone. `isExecutable(path)` is what the
  feature calls; `executableExtensions()` reports the whole set, which is what lets the test assert
  that **none** of them runs under a click without hand-copying a list that would go stale.

The Windows implementations are `packages/platform-windows/src/windows-path-forms.ts` and
`windows-executable-extensions.ts`, bound in the UI composition root under `UI_TYPES.PathForms` and
`UI_TYPES.ExecutableExtensions`.

**The contract suites are `runPathFormsContract(makeSubject)` and
`runExecutableExtensionsContract(makeSubject)`**, in `packages/core/src/testing/`. They are written
in the repo's **pure-throw** style — the file imports nothing, not even a test runner, and signals a
failure by throwing `IPathForms contract violation: …`. That is what keeps `@throng/core` free of a
test dependency and lets any layer run the suite; a platform package calls it from one `it(...)`
(`packages/platform-windows/tests/contract/windows-path-forms.contract.test.ts`).

Two rules a new implementation must satisfy, and they are what the suites actually check:

- **Assert shape and relationship, never a literal path.** The suite says `fromDriveForm('/d/git/x')`
  names drive `d` and ends in `git` + separator + `x`; it does not say `D:\git\x`. A macOS or Linux
  implementation therefore passes it without the suite being rewritten.
- **Totality.** No method throws for any string — an empty one, one carrying a NUL, a very long one,
  one with mixed separators. Anything the port does not recognise is `null` or `false`.

Nothing under `packages/core/src/links/` may name an operating system, an extension or a drive
mapping, and `packages/core/tests/unit/links-no-os-names.test.ts` fails the build on one, alongside
the existing `no-os-imports.test.ts`.

## Commits, branches, review

- Branch from `master`: `feature/<NNN-slug>` or `fix/<NNN-slug>`, `<NNN>` matching your `specs/` directory and, where practical, the issue.
- Small, focused commits that message the *why*; prefix with the feature number where it helps (e.g. `005: reap conhost at spawn`).
- Don't force-push shared history mid-review. Never bypass hooks or signing (`--no-verify`, `--no-gpg-sign`) unless a maintainer asks — fix the underlying issue instead.
- Maintainers review against the engineering gates (V, VIII, IX, X), with extra scrutiny on the OS-abstraction boundary, daemon/terminal lifecycle, and persisted layout state (II, III, VII). Engage feedback with rigour — verify, don't reflexively agree or dismiss. A PR merges only when the agreed issue is linked, the checklist is complete, tests are green with evidence, docs are current, and a maintainer approves.

## Developer setup

Clone, then `npm install && npm run build && npm test` to confirm a green baseline before you
start (prerequisites and commands are in the [README](README.md)). For the AI path, install
Claude Code with the Spec Kit extension and use the repo-local `/speckit-*` commands.

## Licensing

throng is © 2026 **Christopher Sebok**, licensed **[AGPL-3.0](LICENSE)** (strong copyleft: use,
modify, and redistribute freely, but distributing or network-serving a modified version means
publishing its complete source under AGPL-3.0, with no relicensing to proprietary). **By
contributing you agree to the [Contributor Licence Agreement](CLA.md)** — you keep your
copyright but grant the holder a broad, irrevocable licence, including the right to offer your
work under AGPL-3.0 and separate commercial terms; confirm this in the PR. Don't include
AGPL-incompatible third-party code, and preserve upstream notices. Ownership is recorded in
[`COPYRIGHT.md`](COPYRIGHT.md).

---

Questions? Open a
[discussion or issue](https://github.com/Bidthedog/throng/issues) and a
maintainer will help before you invest in a full spec.
