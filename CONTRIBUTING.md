# Contributing to throng

throng is **spec-driven and test-first by constitution**: every change follows the same
disciplined lifecycle the maintainers use — intent captured before code, outcomes proven
before merge. Please read this before opening an issue or PR. New to the app? Start with the
[README](README.md).

> **In short:** get a maintainer to **agree an issue** before you build; capture intent in a
> **clear, fully-specified spec**; deliver it **unit + integration + E2E tested**; keep the
> **docs current**. The **Claude Code + Superpowers + Spec Kit +
> [Superpowers Bridge](https://github.com/lihan3238/speckit-superpowers-bridge)** toolchain is
> the recommended way to hit that bar — but **hand-written, non-AI contributions are equally
> welcome, held to the same testing bar.**

## Code of conduct

Be respectful, assume good faith, and keep discussion on the work. Harassment and personal
attacks aren't tolerated in any project space. Maintainers may edit, lock, or remove violating
contributions and bar repeat offenders. Report concerns privately to the maintainers.

## Non-negotiables

A PR **cannot merge** unless all of these hold:

- [ ] A **GitHub issue exists and a maintainer has explicitly agreed it** (the `agreed` label) before the PR was opened.
- [ ] **Authoring** — either produced with the recommended AI toolchain, driven by **Claude Opus 4.8 or a more capable model**, *or* hand-written without AI. Either way every gate below applies.
- [ ] **Tested at every layer** — unit, integration and E2E observed green (not merely built/type-checked); every user-facing UI change ships passing E2E (constitution V). Hand-written work is tested **at least as thoroughly as the AI workflow produces**.
- [ ] **For AI / spec-driven changes** — a **fully specified spec** under `specs/<NNN-slug>/` with no `[NEEDS CLARIFICATION]` left, `/speckit-analyze` clean of critical/high findings, and `/speckit-converge` run so code and spec agree.
- [ ] The PR states **intent and outcomes in plain, human terms**.
- [ ] The change complies with the **[constitution](.specify/memory/constitution.md)**.
- [ ] **Docs are current** — `README.md` (finite current state), `ROADMAP.md` (delivered vs planned), and this `CONTRIBUTING.md` if the process changed.
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
| **Superpowers** | Execution discipline: TDD, systematic debugging, verification, code review, branch finishing. | <https://github.com/obra/superpowers> |
| **Spec Kit** | The design artifacts: constitution, spec, clarify, plan, tasks, analyze, converge. | <https://github.com/github/spec-kit> |
| **speckit-superpowers-bridge** | Runs Spec Kit's `tasks.md` through native Superpowers execution. | <https://github.com/lihan3238/speckit-superpowers-bridge> |

**Model floor (AI path):** if AI-driven, it **must** be **Claude Opus 4.8 or better** — the
spec-driven, test-first discipline degrades badly on weaker or older models. State in your PR
which model you used, or that the work was hand-written. **Every artifact passes human review
before commit**, and you own the correctness, licensing, and quality of what you submit however
it was produced.

## The lifecycle

```
issue (agreed) → /speckit-specify → /speckit-clarify → /speckit-plan → /speckit-tasks
              → /speckit-analyze → /speckit-superpowers-bridge → /speckit-converge
              → tests green (unit + integration + e2e) → docs current → pull request
```

1. **Issue, agreed** — search first, open with a template, describe *intent* (what a user needs and why), and wait for the `agreed` label. A PR without an agreed issue is closed. *(Trivial typo/link/doc fixes may skip the spec steps but still need an agreed issue.)*
2. **Spec** — `/speckit-specify` then `/speckit-clarify` until every `[NEEDS CLARIFICATION]` is gone and requirements are testable and unambiguous.
3. **Plan & analyse** — `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze`; resolve every critical/high finding before building.
4. **Implement (TDD)** — `/speckit-superpowers-bridge` drives Superpowers test-first (Red → Green → Refactor). Hand-writing instead is fine, but apply the same discipline and coverage by hand.
5. **Converge & document** — `/speckit-converge` until code and artifacts agree, and bring `README` / `ROADMAP` / `CONTRIBUTING` current **in the same change**.
6. **Pull request** — branch from `master`, complete the whole PR template, link the agreed issue, and attach passing test output.

**Constitution check** — every plan must pass the Constitution Check gate (11 principles).
Watch especially project-first isolation (I), platform-abstracted core behind contract-tested
seams (II), daemon-owned terminals with no orphaned processes (III), test-first + UI-needs-E2E
+ `@admin` gating (V), SOLID/DRY/YAGNI (VIII), one composition root per boundary (IX), and
injected config (X). Violations must be revised, or justified in the plan's Complexity Tracking.

**Intent & outcomes** — both spec and PR must let a reviewer who has never seen the code
restate, in plain language, *what a user needs and why* (intent) and *what changed and how we
know it works* (outcomes). If they can't, it isn't clear enough yet.

## Testing

Layered and test-first — the runner commands are in the [README](README.md#commands). Beyond
"all green, on observed output, never assumed":

- **Test-first** (Red → Green → Refactor): tests written and seen failing before the code.
- **Same bar regardless of authoring** — hand-written changes ship coverage at least as thorough as the AI workflow would produce.
- **Every user-facing UI change ships passing E2E** (new/changed controls, menus, dialogs, drag-and-drop, layout, panes, theming).
- **New OS-abstraction seams** (`IShellDetection`, `IPtyHost`, `IDirectoryLock`, …) need contract tests.
- **Process-lifecycle** behaviour (spawn, detach, persist, idle-close, reattach, no-orphans) needs automated tests, including process-level E2E where the constitution requires it (III).
- **`@admin` tests are elevation-gated** — skipped unless elevated, verified via `npm run test:e2e:admin`; a green non-elevated bar never implies admin coverage.

Paste the relevant passing output in your PR — "tests pass" without evidence isn't enough.

## Coding standards

TypeScript 5.x / Node 20 (ESM); match the surrounding style and comment density. The
constitution's engineering principles are binding: **SOLID / DRY / YAGNI** (VIII);
**constructor injection only** — no service locators or ambient singletons, one IoC container
per process boundary (IX); **externalised typed config**, no magic values (X); and **no OS
calls in core** — everything OS-specific sits behind a contract-tested seam (II). Keep the
renderer sandboxed: it reaches privileged capability only through the preload bridge.

## Commits, branches, review

- Branch from `master`: `feature/<NNN-slug>` or `fix/<NNN-slug>`, `<NNN>` matching your `specs/` directory and, where practical, the issue.
- Small, focused commits that message the *why*; prefix with the feature number where it helps (e.g. `005: reap conhost at spawn`).
- Don't force-push shared history mid-review. Never bypass hooks or signing (`--no-verify`, `--no-gpg-sign`) unless a maintainer asks — fix the underlying issue instead.
- Maintainers review against the engineering gates (V, VIII, IX, X), with extra scrutiny on the OS-abstraction boundary, daemon/terminal lifecycle, and persisted layout state (II, III, VII). Engage feedback with rigour — verify, don't reflexively agree or dismiss. A PR merges only when the agreed issue is linked, the checklist is complete, tests are green with evidence, docs are current, and a maintainer approves.

## Developer setup

Clone, then `npm install && npm run build && npm test` to confirm a green baseline before you
start (prerequisites and commands are in the [README](README.md)). For the AI path, install
Claude Code with the Superpowers and Spec Kit skills; the bridge is vendored at
`.specify/extensions/speckit-superpowers-bridge/` — use the repo-local `/speckit-*` commands
(don't overwrite it with a published ZIP).

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
