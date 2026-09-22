<!--
Before opening this PR, read CONTRIBUTING.md. PRs will be rejected that do not respect this guide.
-->

## Linked issue

<!-- A maintainer-AGREED issue is REQUIRED before a PR may be raised.
     Use `Closes #` for a PR that finishes the work. Use `Related to #` when it deliberately does
     not — a reproduction-only PR is the normal case, because a `Closes` would come true on merge
     with no fix behind it. -->
Closes #

- [ ] This issue exists and a maintainer **explicitly agreed it in a comment** before this PR was opened.
- [ ] The issue is **labelled** — exactly one type (`bug` / `enhancement` / `tweak` / `documentation`) and at least one `area:*` — and its title reads `[Type] Summary`. See [Labelling](../CONTRIBUTING.md#labelling).
- [ ] **This PR carries its own labels and milestone**, mirroring the issue(s) it closes — `gh pr create` inherits neither, and a PR with no milestone never appears on the board a maintainer merges from.

## Intent (what & why, in human terms)

<!-- Plain language: what does a user need and why? What problem does this solve or capability does it add?
     A reviewer who has never seen the code should be able to restate this. -->

## Outcomes (what changed, in human terms)

<!-- Plain language: what does the change now do from the user's point of view? What behaviour changed?
     What was verified and how do we know it works? -->

## Testing (observed passing — paste/attach evidence)

<!-- A box is ticked on OBSERVED output. Where a stage was run somewhere other than this
     workstation, link the run instead of ticking blind — a linked green CI run is evidence, an
     assumption is not. -->

- [ ] **This PR is a REPRODUCTION and its new test is meant to be RED** — the failing output below is the deliverable, and the stages that cover it are expected to fail until the fix lands. Tick this and the stage boxes are N/A; everything else in this section still applies.
- [ ] `npm run test:unit` — green
- [ ] `npm run test:integration` — green
- [ ] `npm run test:contract` — green
- [ ] `npm run test:e2e` — green, **or** run on CI rather than here — link the run: `________`
- [ ] Any user-facing UI change ships **passing E2E coverage** (constitution Principle V).
- [ ] New OS-abstraction seams have **contract tests**.
- [ ] `@admin` / elevation-dependent behaviour verified under an elevated run (`npm run test:e2e:admin`), **or** N/A — only CI can run these, so link its run: `________`

<details>
<summary>Test output</summary>

```
paste relevant passing output here
```

</details>

## Documentation

<!-- Constitution Development Workflow: documentation MUST be brought current in the same change. -->

- [ ] **`README.md`** reflects the **current finite state** of the app (no feature-changelog narration); any superseded description was replaced, not appended. *(N/A if this change alters no user-facing behaviour, setup, architecture, or capabilities.)*
- [ ] **`docs/`** guides updated where this change affects them — e.g. [`docs/quick-start.md`](../docs/quick-start.md) for user-facing behaviour, [`docs/testing.md`](../docs/testing.md) for the test suite. *(Planned work is tracked in issues and milestones, not in a roadmap document — there is nothing to tick off.)* *(N/A for a test-only change that documents nothing a reader of these guides would look for.)*
- [ ] **`CONTRIBUTING.md`** updated if the process, toolchain, testing bar, or setup changed.

## Constitution compliance

- [ ] Change complies with the [project constitution](../.specify/memory/constitution.md); any deviation is justified in the plan's Complexity Tracking.
- [ ] SOLID/DRY/YAGNI (VIII), constructor DI via one composition root per boundary (IX), and injected configuration (X) are respected.

## Toolchain & review

- [ ] **Authoring (tick one):**
  - [ ] Produced with **Claude Code + Spec Kit** (test-first, spec-driven discipline), driven by **Claude Opus 4.8 or a more capable model** (minimum). Model used: `________`
  - [ ] Produced with **Claude Code, without Spec Kit** — the change specifies no new behaviour, so no spec was written. The same test-first discipline applies. Driven by **Claude Opus 4.8 or a more capable model** (minimum). Model used: `________`
  - [ ] **Hand-written / non-AI** — and tested **at least as thoroughly** (unit + integration + E2E) as the AI workflow would produce for this change.
- [ ] Every artifact passed human review before commit.

## AI Code -> Spec Kit artifacts

<!-- Tick ONE of the two routes. A branch's `S<NNN>` segment names a spec directory that exists or
     is about to; work with no spec to write carries no `S` segment at all, and neither route
     implies a `specs/NNN-*` directory that was never created. -->

- [ ] **This PR specifies no new behaviour** — a defect fix, a test, a chore, a tooling or config change. There is no spec directory and the checklist below is N/A. What made it correct instead: `________`
- [ ] **This PR implements a spec.** Spec directory: `specs/<NNN-feature-slug>/`
  - [ ] `spec.md` is **fully specified** — no unresolved `[NEEDS CLARIFICATION]` markers.
  - [ ] `/speckit-clarify` was run and its answers encoded back into the spec.
  - [ ] `/speckit-plan` produced `plan.md`, `research.md`, `data-model.md`, `contracts/`.
  - [ ] `/speckit-tasks` produced a dependency-ordered `tasks.md`.
  - [ ] `/speckit-analyze` was run; **no critical/high-severity** cross-artifact findings remain.
  - [ ] Implemented via **`/speckit-implement`** (test-first TDD), not a one-shot run.
  - [ ] `/speckit-converge` was run and the codebase agrees with spec/plan/tasks.
  - [ ] Manual testing of all new features carried out.

## Licensing

- [ ] I have read and agree to the **[Contributor Licence Agreement](../CLA.md)**.
- [ ] My contribution is my original work (or its source and AGPL-3.0-compatible license are identified), and preserves any upstream copyright/license notices.
