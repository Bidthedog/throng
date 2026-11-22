# Documentation currency — constitution detail

Binding: constitution Development Workflow & Quality Gates (`.specify/memory/constitution.md`, *Development Workflow & Quality Gates › Documentation*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## Documentation is kept current as part of the lifecycle

- **Documentation MUST be kept current as part of the lifecycle (NON-NEGOTIABLE).**
  Any change that alters user-facing behaviour, setup or commands, architecture, or the
  set of delivered/planned capabilities MUST update the affected project documentation
  **in the same change**, at minimum:
  - **`README.md`** — describes the application's **current, finite shipped state** only:
    what it is and does now, its architecture, prerequisites, commands, and configuration.
    It MUST NOT be written as a per-feature changelog or narrate feature numbers/increments;
    a superseded description MUST be replaced, not appended, so the README always reads as a
    truthful snapshot of the app as it currently exists.
  - **`CONTRIBUTING.md`** — the contribution process, required/recommended toolchain, testing
    bar, and developer setup, kept consistent with how the project is actually built and tested.
  - **`docs/`** — the standing guides (user and contributor). Each describes its subject's
    current state; a guide the change contradicts MUST be corrected in the same change.
  - **The issue tracker** — the single forward-looking list: delivered capabilities close their
    issue, and newly planned capabilities are raised as issues. Anything that is future scope
    lives **there**, **not** in the README or any other document in this repository. The project
    MUST NOT maintain a second forward-looking list in a tracked file: two lists drift, and a
    drifted list is worse than none.
  This reconciliation is part of **`/speckit-converge`** and the definition of done: a change
  MUST NOT be considered complete, and a PR MUST NOT be merged, while any of these documents
  disagrees with the shipped behaviour of the change.
