---
name: Feature
about: Propose a large body of work — a capability that decomposes into several issues over several PRs. A maintainer must agree this issue before any PR is raised.
title: "[Feature] "
labels: ["feature", "needs-agreement"]
assignees: []
---

<!--
A Feature is a CONTAINER. It is named after a capability ("Terminal panels",
"Preferences editor"), not a change, and it decomposes into Enhancements,
Tweaks and Bugs that ship across several PRs. It is rarely implemented
directly.

If the whole thing plausibly lands in one PR, raise an Enhancement instead.

A maintainer must AGREE this issue (scope + direction) before you begin the
Spec Kit lifecycle or open a PR. Describe the user need and intent — not a
pre-baked implementation.
-->

## Intent (what & why, in human terms)

<!-- What does a user need, and why? What problem does this solve? Plain language, user-facing goal. -->

## Proposed outcome

<!-- From the user's point of view, what should be possible after this ships? -->

## Scope and constraints

<!-- What is in scope? What is explicitly out of scope? Any known constitution touchpoints
     (project isolation, terminals/daemon, OS-abstraction seams, config, layout)? -->

## Children

<!-- The Enhancements, Tweaks and Bugs this Feature contains. Add them as GitHub sub-issues so
     this list tracks its own progress; these checkboxes tick themselves as the children close.
     It is fine to start with a rough decomposition and refine it as the work is understood. -->

- [ ] #

## Acceptance criteria (testable)

<!-- Bullet the observable behaviours that must be true for the FEATURE as a whole to be done.
     These become the basis for the spec's functional requirements and the E2E tests.
     Per-child criteria belong on the children. -->

- [ ]
- [ ]

## Out of scope

<!-- What this Feature deliberately does NOT cover, so the boundary is agreed up front. -->

## Maintainer agreement

<!-- Leave blank — a maintainer fills this in. -->
- [ ] Agreed by maintainer (scope confirmed; `agreed` label applied). Contributor may begin the Spec Kit lifecycle.
