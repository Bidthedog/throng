---
name: throng-spec-governance
description: Use for Spec Kit artifacts and project governance — writing or amending a spec, plan, tasks, data-model, contracts, quickstart or checklist under specs/NNN-*/, the Constitution Check gate, constitution amendments and their version bump, functional-requirement numbering and traceability, and the docs-currency and incremental-delivery rules. Triggers include "write a spec", clarify/analyze findings, "which spec does this work belong to", a rule that needs to become constitutional, an FR that contradicts another, and reconciling a spec with what actually shipped.
---

# throng — specs, constitution and governance

throng runs Spec Kit (`.specify/`) with a heavyweight, genuinely enforced constitution
(`.specify/memory/constitution.md`, currently v4.4.0, 11 principles). Governance here is not
ceremony: the Constitution Check gate in `plan-template.md` reads the constitution dynamically, and
several principles are wired to tests that fail the build.

**The slash commands do the work** — `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`,
`/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`, `/speckit-converge`,
`/speckit-constitution`, `/speckit-checklist`. Use them rather than hand-rolling the artifacts. This
agent carries the judgement they assume.

## Artifact set per feature

`specs/NNN-<slug>/` → `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`,
`quickstart.md`, `tasks.md`, `checklists/`. Templates in `.specify/templates/`.
`.specify/feature.json` is per-working-copy state and deliberately **untracked** — do not commit it.

## Which spec owns the work

The spec the *work* belongs to, never "the spec that defines the requirements the code touches". A
bug fix can touch FRs from every spec in the repo and belong to none of them. Work no existing spec
covers takes the **next** number, even before that directory exists. This same rule names the branch
(`branch-naming` skill) and therefore the worktree folder, so settle it first.

## The eleven principles, in one line each

I Project-first context isolation · II Platform-abstracted core · III Detached, tagged, persistent
terminals · IV Native terminal support & auto-detection · V Test-first quality discipline
(NON-NEGOTIABLE) · VI Simple, modern, discoverable UX · VII Change review & approval · VIII SOLID,
DRY, YAGNI · IX DI & composition root · X Externalised configuration · XI Dockable workspace: panes,
tabs & panels.

Plus, under Development Workflow & Quality Gates: lint + type-check with zero errors, CI on every PR,
configuration-editor completeness, themeable icon controls, documentation currency, incremental
(staged) delivery.

## Amending the constitution

The bar is high and the precedent is well established — read the SYNC IMPACT REPORT block at the top
of the file before proposing anything; it is a written record of how past bumps were argued.

- **MAJOR** = a previously-stated guarantee is withdrawn or reversed, or a principle is redefined so
  that previously-compliant work becomes non-compliant.
- **MINOR** = materially expanded, additive guidance within an existing principle or the workflow
  gates. A new constraint that existing code fails is still MINOR — that is the ordinary case for an
  additive rule.
- **PATCH** = clarification with no new obligation.

Every amendment must: state the bump and argue it against the project's own test; list modified /
added / removed sections; enumerate the templates and artifacts reviewed with ✅ / ⚠ and what was
found; and record deferred TODOs honestly. **Audit the code before writing the rule** — twice, a
draft rule would have declared the shipped codebase non-compliant on rules its author believed it
already met. A rule no design can satisfy governs nothing; a rule the codebase quietly violates is
worse than none. Where a gap is real, state it as an **end-state requirement under Incremental
Delivery**, enumerate the known violations in the principle itself, and file tracked issues.

## Writing requirements

- Number FRs and keep them stable; later clarifications append (`FR-023B`, `FR-049a–d`) rather than
  renumbering.
- Record clarification sessions in the spec with their date and the question answered.
- A UI story carries a test task at the lowest layer that can prove it (Principle V) — a component
  task for rendered output and in-component behaviour, an E2E task only where a real window is what
  is under test. Never generate an E2E task by default; a feature adding configuration carries the
  editor-descriptor and completeness-test tasks; a feature adding a panel action carries its menu
  item; a migration carries an idempotent-re-run assertion.
- Deferrals live in the owning plan's Complexity Tracking **and** as an open labelled issue. There is
  no ROADMAP.md — it was removed at v4.0.0, and a second forward-looking list in a tracked file is
  now forbidden. Forward-looking scope lives in GitHub issues and milestones only.
- Docs currency is part of done: a change altering user-facing behaviour, setup, architecture or the
  shipped capability set updates `README.md`, `docs/` and `CONTRIBUTING.md` in the **same** change.

## Issues

Use the `github-issues` skill to file or classify, and `github-issue-state` to claim or release work
on one. Both are already installed; do not improvise an issue body.

## Not yours

Implementation in any package → the owning area agent. Running the suites → `throng-e2e-harness` plus
the `throng-testing` / `running-tests` skills.
