# Quickstart: validating terminal titles from a template

Prerequisites: a build of this branch (`npm run build`), throng launched from it.

1. Open a Command Prompt, a PowerShell 7, a Windows PowerShell and a Git Bash terminal in one project.
2. Run `ping localhost -t` in each. Within two seconds each panel's name reads
   `ping localhost -t | <shell> (<directory>)` — header, tab strip and panel menu alike (US1, FR-001, FR-004).
3. Stop each with Ctrl+C. Each name returns to `<shell> (<directory>)`; no separate directory field shows (FR-010).
4. `cd` into a deep folder. The directory keeps its root and last folder, with the middle shortened (FR-012).
5. In Preferences → Terminal, set the template to `({title} ?? {app}) | {shell}`. Every open terminal renames at
   once; running `claude` shows `claude | <shell>` (US2).
6. Enter `({shell}`. Preferences refuses it with `Unclosed bracket at 0`; names do not change (FR-008).
7. Read the template setting's description: every placeholder and the three rules are there (FR-015).

Automated: `npx vitest run --project unit packages/core/tests/unit/title-template.test.ts` holds the language's
truth table (contracts/title-template.md).
