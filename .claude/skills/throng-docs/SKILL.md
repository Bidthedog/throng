---
name: throng-docs
description: Keep throng's documentation set current and in its agreed shape — README.md as a short, enticing entry point, and one home per topic under docs/ (installation, quick-start, key-bindings, preferences, environment, architecture, testing, releasing, and the docs index), all linked by breadcrumbs and inline links. USE THIS EVERY TIME documentation is written, moved or reviewed, and ALWAYS before a pull request is created or its description is rewritten, before a release is tagged (throng-release calls it), and whenever a change adds, renames or removes a key binding, a setting, an environment variable, a package, a process, a command or a user-visible feature — "update the docs", "the README is out of date", "document this setting", "where should this go in the docs", "audit the docs", "docs currency", "prepare the PR". Do NOT use it for spec artifacts under specs/ (Spec Kit owns those), CHANGELOG.md release notes (throng-release owns those), or CONTRIBUTING.md's process rules (edit that file directly).
---

# Maintaining throng's documentation

The docs are a small set of files, each with **one job**. A fact lives in exactly one of them; every
other file mentions it in a clause and links there. The rules below are the maintainer's
(2026-09-27); `CLAUDE.md` *Documentation* points here.

## The set, and what each file may hold

| File | Holds | Must NOT hold |
|---|---|---|
| `README.md` | The pitch: an exciting first paragraph on what throng is and its use-cases, the problems it solves, a one-line-per-feature list (feature name + one sentence), getting started in a few lines pointing at installation and quick-start, and a short Contributing section pointing at `CONTRIBUTING.md` | Key bindings, settings, environment variables, architecture, how anything works, command tables beyond the few lines to start it |
| `docs/README.md` | The docs index: every file under `docs/`, one line each, grouped by reader | Anything else |
| `docs/installation.md` | Everything to install throng and get it running: downloads, verification, install, first launch, upgrade, downgrade, uninstall, prerequisites for a source build | Feature or settings detail |
| `docs/quick-start.md` | "Getting started for dummies": a short whistle-stop tour, high to medium detail, of how to start and get around; one section per major feature, updated as features are added | Exhaustive binding or settings lists (link to key-bindings.md / preferences.md) |
| `docs/key-bindings.md` | Every default key binding, by group, with its action id, chord(s), scope and one-line description; the tier convention; multi-key chords; non-US layouts; rebinding | Settings detail |
| `docs/preferences.md` | Every preference by group, with its key, default, allowed values and what it does; themes, icon packs, config file locations | Key bindings |
| `docs/environment.md` | Every environment variable, by audience (running the app, development, testing). A variable that overrides an app setting is *listed* and linked to its preferences.md entry, never described again | Setting descriptions |
| `docs/architecture.md` | All architecture, per domain, with mermaid component and topology diagrams | User instructions |
| `docs/testing.md` | High level: the layers, the commands, the gate, the two E2E lanes; points at the `throng-testing` skill and its references | The detail the skill's references hold |
| `docs/releasing.md` | High level: what a release is; points at the `throng-release` skill and its references | The procedure |

**New file?** Only when a topic has no home above, and it is added to `docs/README.md` and to this
table in the same change.

## House style

- **Breadcrumb first line**, above the H1: `[throng](../README.md) › [Docs](README.md) › <Page>`
  (`docs/README.md`: `[throng](../README.md) › Docs`). `README.md` has none; it links down instead.
- **One home per fact.** Elsewhere: one clause and a relative link to the anchor
  (`[Ctrl+E,W](key-bindings.md#editor)`). Never copy a table or list of bindings or settings.
- **Relative links only**, to anchors that exist. Chords as the app shows them (`Ctrl+Shift+Alt+N`,
  `Ctrl+E,W`, `Ctrl+Alt++`).
- **The app as it is**, never its history ("previously", "was moved") — `CHANGELOG.md` holds that.
- **Read the code, not the old docs,** when they disagree: bindings in
  `packages/core/src/config/keybindings.ts` and `keybindings-metadata.ts`, settings in
  `packages/core/src/config/settings-metadata.ts`, environment variables wherever `process.env` is read.
- `README.md` stays enticing and short: if a paragraph explains *how*, it belongs in a doc.

## The audit — run it before every PR create/edit and every release tag

1. **What changed.** `git diff --stat $(git merge-base HEAD origin/master)..HEAD`, and for a release,
   since the previous tag. List every user-visible surface the diff adds, renames or removes:
   bindings, settings, environment variables, commands, features, packages, processes.
2. **Place each one** in its home file above, and fix every other file that still names the old
   spelling (`git grep -n "<old>" -- ':!specs' ':!*.lock' ':!CHANGELOG.md'` must come back empty).
3. **The mechanical guard:** `packages/ui/tests/unit/docs-currency.test.ts` — breadcrumbs, links and
   anchors resolve, the index lists every doc, and every binding, setting and `THRONG_*` variable is
   documented. Run it:
   `npx vitest run --project unit packages/ui/tests/unit/docs-currency.test.ts`. It is also in the
   gate, so a red one blocks the merge.
4. **The judgement pass** the test cannot do: README still reads as a pitch and stays within its
   job; quick-start still covers every major feature at tour depth; nothing in one file restates
   another's detail.
5. **Say what you checked** in the PR description's *Documentation* checklist, per file.

A pull request with no user-visible change needs step 1 only, and says "docs unaffected".
