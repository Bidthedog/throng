# Manual test plan: 071 no inert settings guard

Spec: `specs/071-inert-settings-guard/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|

No groups. This feature is a build guard with no visual surface: it adds unit tests, retires the per-feature
reader checks and rewords comments, and changes no behaviour a user can see (spec FR-016). Its proof is the
automated guard (`packages/core/tests/unit/no-inert-settings.test.ts`) and its fixtures
(`settings-readers-scan.test.ts`), which run in the unit gate.
