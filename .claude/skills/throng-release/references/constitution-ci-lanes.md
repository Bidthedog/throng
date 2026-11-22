# Static analysis, pull-request CI and the full pipeline — constitution detail

Binding: constitution Development Workflow & Quality Gates (`.specify/memory/constitution.md`, *Development Workflow & Quality Gates › Static analysis & linting*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## Static analysis & linting, and the two lanes

- **Static analysis & linting MUST pass as a quality gate (NON-NEGOTIABLE).**
  The codebase MUST be kept clean under an automated linter — **ESLint** with the
  **typescript-eslint** rule set — in addition to strict TypeScript type-checking
  (`tsc`). Lint MUST report **zero errors**: a lint error MUST be treated as a build
  failure, not a suggestion. A change MUST NOT be considered complete, and a PR MUST
  NOT be merged, while lint or type-check reports errors. Lint rules MAY be tuned or
  scoped in the **shared lint configuration** where a rule is genuinely inapplicable
  (with the reason evident from the config), but MUST NOT be disabled ad hoc to mask a
  real defect; a line-level suppression MUST carry a justification. These gates MUST be
  enforced automatically, so that a red gate blocks merge without relying on local
  discipline. **Pull-request CI** MUST run the linter, the type-check, and Principle V's
  unit, component and contract layers in full, plus a declared critical-path subset of the
  integration layer bounded at 15 files; it runs on Linux, runs no E2E, and reports one
  verdict. **The full pipeline** MUST run every layer of Principle V — every E2E test on
  every supported platform included — and build and verify every artifact: nightly on
  master, on an agent's dispatch, and inside every release before anything publishes. A
  release MUST NOT publish unless the full pipeline in its own run is green. A lane that
  gates merge is worth only what it costs every contributor to wait for, so the expensive
  remainder is paid by the nightly and by the release, not by every push. A pull request
  whose every changed file is one no gate reads — no lint, type-check, test or build input, by a
  declared list that runs everything for a path it does not name — MAY skip those runs, and its
  verdict passes without them: a gate that cannot fail answers nothing worth waiting for.
