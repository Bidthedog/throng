# Quickstart / Validation Guide: Main Window Affordances

Prerequisites: `npm install` at repo root. Build: `npm run build`.

## Automated verification

- Core unit: `npm run test:unit` — starting-folder resolution, settings parse/merge of `newProject`,
  metadata completeness (incl. `folder` kind + internal `lastProjectFolder`), removal-verb mapping.
- UI unit (jsdom): `npm run test:unit` — `panel-type-form.test.ts` Clear-vs-dismiss independence.
- Integration: `npm run test:integration` — `editor-external-change` names the file; settings
  round-trip of the new leaves via `config.write`.
- E2E (mandatory, Principle V): `npm run test:e2e` — new specs below. Each exercises the running app.

## E2E scenarios (Playwright-Electron, `packages/ui/tests/e2e/`)

1. **error-dismiss.e2e.ts** — trigger each of the four error surfaces; assert a trailing-edge dismiss
   control; activating it removes the error **immediately** (assert removal without any focus change
   or re-render trigger); re-triggering the same error re-shows it.
2. **panel-type-clear-vs-dismiss.e2e.ts** — with a terminal exit notice visible and typed fields:
   Clear -> fields cleared, notice still visible; dismiss -> notice gone, fields intact; after
   dismiss the type form is still usable (select a type, Confirm works — never a blank panel).
3. **editor-external-change** (extend existing) — two editors on different files; modify one on disk;
   the warning names the correct tab, panel, and full path.
4. **unsaved-dot-pulse.e2e.ts** — make an unsaved edit; assert the dot has the pulse animation in all
   three locations and min opacity > 0; save -> dot gone; with reduced-motion emulated, the dot is
   static at full opacity (no animation).
5. **removal-verbs.e2e.ts** — walk the glossary matrix: project = "Remove" everywhere (control,
   tooltip, menu, confirmation) and its confirmation states no files are deleted; project-owned panel
   destroyed in main = gone + session terminated; same panel closed in a sub-workspace = "Close" +
   session keeps running; sub-workspace-owned panel = "Destroy" + session terminated; tab/sub-workspace
   verbs = "Destroy".
6. **new-project-folder.e2e.ts** — default `lastViewed` opens at the last-created folder; `profile`
   opens at the home dir; `override` opens at the override; an unresolvable configured folder falls
   back to the home dir.

## Manual smoke (`npm start`)

See the numbered manual checklist delivered in the coordinator report; covers all five defects and
the new setting, including the reduced-motion dot and the "Clear does not clear the error" check.

## Build-order note

Tasks are ordered so all logic + the other four defects + the setting land first; the **dismiss-icon
glyph rendering + its glyph-assertion E2E are last** and STOP for the 009 rebase (the `dismiss`
token). The settings-form rendering of the `folder` control + the override flag are a **015 handoff**
(`preferences/**`, not owned here) — see research.md B2.
