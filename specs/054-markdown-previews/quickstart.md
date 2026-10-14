# Quickstart: validating 054

Prerequisites: the branch built (`npm run build`), and `npm start` for the hands-on checks. Automated
layers per `research.md` R10; the gate runs on the hosted runner (`CLAUDE.md`).

## Automated

```bash
npx vitest run --project unit -- fold-state task-toggle preview-settings keybindings
npx vitest run --project component -- preview outlining diagram maximise find-in-files settings-tab
npx vitest run --project integration -- task-toggle
npx vitest run --project contract -- preview-ipc
```

## Hands-on scenarios

1. **Restored reuse** — Last Active; preview a `.md`; quit; relaunch; preview another `.md` from File
   Explorer → the restored panel shows it (US1).
2. **Task list** — preview a file with `- [ ] a`; click the box → file shows `- [x] a`; with an editor
   holding unsaved edits, click again → the editor shows the change, stays unsaved, Ctrl+Z undoes it
   (US2).
3. **Search result** — set Markdown: Default open action = Preview; Find in Files for a word in a `.md`;
   double-click the result → preview, match highlighted (US3).
4. **Mermaid** — preview a `.md` with a ` ```mermaid ` flowchart in a dark theme → themed diagram;
   break the syntax → dimmed diagram with a notice; Fit / Full Size / zoom / middle-drag / Full Pane +
   Esc (US4).
5. **Standalone** — open `diagram.mmd`, open its preview → live diagram (US5).
6. **Outlining** — right-click inside an H2 → Outlining ▸ Collapse All Inside This H2 (US6).
7. **Settings** — Preferences → Editor → Previews → Markdown / Mermaid subsections (US7).
8. **Maximise** — three split panels; Alt+Shift+Enter in a terminal → maximised; Shift+Enter still
   inserts a line break in Claude Code; "+" disabled; restore → layout unchanged (US8).
