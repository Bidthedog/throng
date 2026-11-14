# Quickstart: validating spec 068

Prerequisites: a worktree built with `npm run build`; `npm start` for the hand checks. Automated checks use `td run --runner <unit|component|integration|contract> --scope file --target <file>`.

## Vault links (US1, US2)

1. Fixture: a project with `folder/sub/Target.md` (heading `# Some Heading`), `folder/sub/Note.md` containing `[[folder/sub/Target#Some Heading|Alias]]`, `![[img.png]]`, `![[folder/pic.png|Alt text]]`, `![[/folder/pic.png]]`, `![[note.md]]`, `[[img.png]]`; `folder/sub/img.png`, `folder/pic.png`.
2. Preview `Note.md`: hovering `Alias` reads `folder/sub/Target#Some Heading` in the tooltip and the status bar; Ctrl+click opens Target at the heading; Copy Link copies the resolved path.
3. All three images draw; `![[note.md]]` stays literal; `[[img.png]]` is a link.
4. Automated: `wiki-links.test.ts`, `preview-links.test.ts`, `markdown-pipeline-embeds.test.ts` (unit); `wiki-resolution.test.ts`, `preview-wikilinks-sanitise.test.ts`, `preview-images.test.ts` (component); `preview-wiki-links.integration.test.ts`, `preview-embeds.integration.test.ts` (integration).

## Toasts and the panel (US3, US4)

1. Fresh settings: raise an error (e.g. rename a file to an existing name) and an info notice. Both toasts leave after 3 s; only the error is in the Notifications panel below the File Explorer.
2. Hover a toast: it stays; move away: it leaves 3 s later. Tab into a toast: same.
3. Close a toast with X: its panel entry stays. Dismiss the entry with X. Copy an entry.
4. Change the order from the panel header; Dismiss all asks first; turn **Confirm before dismissing all notifications** off: no prompt.
5. Minimise the Notifications panel; raise an error: the header shows `1` in the error colour. Restore: the count clears. Minimise the Sub-workspaces panel in the left pane; restart: both stay minimised.
6. Restart throng: the entries are still there.
7. Set **Notifications panel limit** to 20 and raise 21 errors with different subjects: 20 entries remain and a warning toast stays until dismissed; its link opens Preferences at Notifications. Dismiss it, fill again: no warning.
8. Automated: `notification-entries.test.ts`, `display-mode.test.ts` (upgrade), `settings-metadata.test.ts` (unit); `notice-toast-timer.test.ts`, `notifications-panel.test.ts`, `vertical-panel-stack-minimise.test.ts` (component); `notification-store.integration.test.ts` (integration); `notifications-panel.e2e.ts` (cross-window add, restart).

## Claude Code session resume (US5)

1. Tick **Remember the last running command** on a terminal panel; run `claude --model opus`, exchange a message.
2. Kill the daemon (Resource Monitor → End) or restart the machine; reopen the project: the panel starts `claude --resume <id> --model opus` in the same conversation.
3. Two ticked panels in one folder resume their own sessions. An unticked panel opens its own startup command.
4. Automated: `claude-resume.test.ts`, `command-line-args.test.ts` (unit); `terminal-command-poll.test.ts` with a fake session record (unit, daemon); `claude-session-resolver.integration.test.ts` (integration, a temp config dir and a real child process); `terminal-idle-end-clears.test.ts` (component, memoryCommand promoted).

## Anonymised log (#623)

1. Open a project, run a terminal, move a file, raise notices; then search the logs folder for your username, home folder, hostname, the project's folder and name, and a command you ran: none appear.
2. Hover a project's path in the project list: the second line is its internal ID; the same ID appears in `main.log`.
3. Automated: `diagnostics-anonymise.test.ts` (unit); `node-file-log.integration.test.ts` (integration, file contents and crash report); `notice-log.test.ts` (unit, `pending=` and project ID); `projects-panel-form.test.ts` (component, hover).

## Iteration 2026-11-13 (FR-056 to FR-065, the MT-01 defect)

1. **Heading jump (044 FR-090b)**: Ctrl+click `[[mermaid#2. System Context]]` in a document whose Mermaid diagrams and remote images sit above that heading: the preview ends on the heading after every diagram and image has drawn. Scroll during the load: the preview stays where you scrolled. Automated: `preview-heading-hold` (component).
2. **Image sizes and hover (FR-056, FR-057)**: `![[diagram.png|200]]` draws 200 px wide, `|200x100` 200 by 100, `|Alt text|200` 200 wide with that alt text. Hovering `![Alt text](diagram.png)` shows the alt text, then the path. Automated: `preview-embeds.test.ts`, `markdown-pipeline-embeds.test.ts` (unit); `preview-sanitise.test.ts`, `preview-images.test.ts` (component).
3. **Count and badge (FR-058 to FR-060)**: raise three notices; minimise and restore the Notifications panel, hide and show the right pane: the count stays 3, beside the Notifications title and, with the pane hidden, below **File Explorer** on the rail. Dismiss them: the badge goes. The minimise controls are the side panes' chevron, down when open, up when minimised. Automated: `notification-entries.test.ts` (unit); the notifications panel and app component tests.
4. **Origin and click (FR-061, FR-063)**: a terminal that fails to start reads **Project › Tab › Panel** in its toast, entry and copy text; clicking either (not its buttons), or Enter on it, goes to the panel. An app-wide notice names no place and is not a link. Automated: the notification component tests; `notice-log.test.ts` (no names in the log record).
5. **Defaults and wording (FR-062, FR-065)**: a fresh configuration keeps every type in the panel; the OS notification settings say "OS". Automated: `display-mode.test.ts` (unit), `notification-settings.contract.test.ts` (contract), `os-neutral-wording.test.ts` (unit).
6. **Id hover (FR-064)**: hovering a project's path shows the path, then `(id: <id>)`. Automated: `projects-panel-form.test.ts` (component).
