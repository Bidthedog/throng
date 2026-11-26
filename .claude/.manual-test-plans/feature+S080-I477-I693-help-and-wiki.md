# Manual test plan: online help and the user guide (spec 080, stage 1)

Spec: `specs/080-help-and-wiki/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | The guide site: look, version, navigation and search | signed off | 5f0979e41830 | 2026-11-26 | |
| MT-02 | Help from the cog menu and F1, in every window | needs retest | 5f0979e41830 | 2026-11-26 | 79e4f036 touched packages/ui/src/main/help-window.ts |
| MT-03 | The (?) beside every setting | signed off | 5f0979e41830 | 2026-11-26 | |
| MT-04 | The references, split into pages | signed off | 5f0979e41830 | 2026-11-26 | |
| MT-05 | The (?) on key bindings and theme settings | signed off | 5f0979e41830 | 2026-11-26 | |
| MT-06 | Every guide page, complete | signed off | 5f0979e41830 | 2026-11-26 | |
| MT-07 | The Help window | needs retest | 49246f133c93 | 2026-11-26 | 79e4f036 touched packages/ui/src/main/help-window.ts |

## MT-01: The guide site: look, version, navigation and search

Covers: FR-001, FR-002, FR-002a, FR-002b, FR-002c, FR-003, FR-003a, FR-005, FR-007, FR-029, FR-035, FR-038, FR-039, FR-041, FR-042, FR-044, FR-066, SC-005, SC-006
Paths: `site/guide/**`, `docs/preferences.md`, `docs/key-bindings.md`, `docs/theme-settings.md`, `site/**`, `scripts/guide-build.mjs`, `scripts/guide-template.mjs`, `scripts/site.mjs`

### Steps
1. Setup: in the worktree, `npm i -g pagefind@1.3.0` once, then `npm run site:preview`. Open http://127.0.0.1:8080/. The home page looks as before, its nav has a **Guide** link, and a small `vdev` label sits in the header and the footer.
2. Click **Guide**. The start page opens in the same header, footer, fonts and colours as the home page, with a page list on the left and "This guide describes throng dev." at the top. The current page is highlighted in the list.
3. Flick between the home page and a guide page. The navigation links sit in exactly the same place, aligned right; on the guide page the search field sits to their left.
4. Read the start page. Each main feature is one line linking to its page, and a prominent link goes to **Quick start**. Click it: the Quick start shows numbered steps under task headings.
5. Expand **Preferences reference** in the page list, open **General**, and find **Use native Wayland (Linux only)**. Its key `window.nativeWayland` is on the line under the heading, then its one-line description, then **Default** and **Values**. The page has no breadcrumb line at the top.
6. Type `window.nativeWayland` into the search field. The text you type is easy to read. A results panel opens below the header, as wide as the page, and lists the General section of the preferences reference; click it and the page opens at that setting.
7. Search for `split`. The panel lists **Tabs, panels and layout** and **Quick start**, each with the matching section. Scroll the panel: the results move. Scroll the page outside it: the page moves.
8. With text in the search field, look at its clear control: a small icon button inside the field, in the site's colours. Click it: the field empties and the results close.
9. Open a long page (Terminals) and scroll to its very end. The page list on the left does not move at all. Narrow the window height until the page list is longer than the window: it scrolls on its own, without moving the page.
10. The first entry in the page list, and the start page's browser tab, read **Intro**.
11. Click **Sitemap** in the footer. A page lists the home page, every guide page, and each reference with its sections beneath it; each link opens its page. The sitemap page has no page list on the left: its list fills the width.
8. Narrow the browser to phone width. The page list stacks above the page, nothing scrolls sideways, and the search field still fits in the header.
9. Switch the browser between light and dark preference. The guide stays in the site's own dark look, as the home page does.

### Negative cases
- No page in the guide links to `docs/quick-start.md`, and no link on any guide page leads to a "page not found".
- A link to a repository file that is not part of the guide (for example the install guides) opens on GitHub, not inside the site.

## MT-02: Help from the cog menu and F1, in every window

Covers: FR-009, FR-010, FR-011, FR-045, SC-001, US2
Paths: `packages/ui/src/renderer/help/**`, `packages/ui/src/renderer/title-bar/cog-menu-items.ts`, `packages/ui/src/renderer/title-bar/cog-menu.tsx`, `packages/ui/src/renderer/keybindings/window-dispatcher.tsx`, `packages/ui/src/renderer/preferences/preferences-app.tsx`, `packages/ui/src/renderer/resources/monitor-app.tsx`, `packages/ui/src/renderer/about/about-app.tsx`, `packages/ui/src/renderer/print-preview/print-preview-app.tsx`, `packages/ui/src/main/external-url.ts`, `packages/ui/src/main/help-window.ts`, `packages/core/src/help/**`, `packages/core/src/config/keybindings.ts`

### Steps
1. Setup: `npm run build`, then start throng from the worktree with `npm start`. No site preview is needed: Help shows the guide built with this copy.
2. Open the cog menu at the top right. A **Help** row with a help icon sits just above **About throng**. Click it: the guide's start page opens in throng's Help window, from the guide built with this copy (no site preview or network needed).
3. Click into the File Explorer and press **F1**. The Help window shows the start page again (the same window, brought forward).
4. Click into an editor and press **F1**. The Help window shows the start page.
5. Click into a terminal running a shell and press **F1**. No Help window opens; the key reaches the shell.
6. Tear a tab off into a sub-workspace window, click into it outside a terminal, and press **F1**. The start page opens.
7. Press **F1** in each of Preferences, the Resource Monitor, About throng and Print Preview (**Ctrl+P** in an editor). Each shows the start page in the Help window.
8. Open Preferences › Key Bindings and search for "Help". The **Help** command shows **F1**, in the Application group.

### Negative cases
- In Preferences › Key Bindings, double-click a command to record a chord and press **F1**. The capture box records F1; Help does not open.
- Set HTML files to open in a throng preview, then use Help. The guide still opens in the Help window, never in a preview panel or the browser.

## MT-03: The (?) beside every setting

Covers: FR-014, FR-007, FR-015, FR-027, FR-055, SC-002, US3
Paths: `packages/ui/src/renderer/common/help-link.tsx`, `packages/ui/src/renderer/theme.css`, `packages/ui/src/renderer/preferences/settings-tab.tsx`, `packages/ui/src/renderer/preferences/preferences.css`, `docs/preferences.md`, `packages/core/src/help/help-urls.ts`

### Steps
1. Setup: throng running as in MT-02 step 1. Open Preferences › Settings.
2. Look down the list. Every setting row has a small **?** beside its title, drawn in the current theme's icon colour.
3. Rest the pointer on the **?** beside **Use native Wayland (Linux only)**. A hover title reads "Help: Use native Wayland (Linux only)".
4. Click it. The Help window shows the preferences reference scrolled to that setting's own section.
5. Press **Tab** through a row until the **?** has focus, then press **Enter**. The Help window shows that setting's section.
6. Open a grouped row (several settings on one row, such as the notification toggles). Each setting in it has its own **?**, and each opens its own section.
7. Switch to another bundled theme. The **?** icons take that theme's icon colour.
8. Compare a **?** with the row's reset button and the icon buttons in Preferences' header. The **?** is visibly smaller than they are, and its question mark is still easy to read.
9. In Preferences › Themes › General, raise the theme's icon size, then look again. The **?** stays the same small size.

### Negative cases
- No setting row is missing its **?**, and no **?** lands at the top of the page instead of its section.

## MT-04: The references, split into pages

Covers: FR-026, FR-007, FR-015
Paths: `docs/preferences.md`, `docs/key-bindings.md`, `docs/theme-settings.md`, `scripts/guide-build.mjs`, `scripts/guide-template.mjs`, `packages/core/src/help/help-urls.ts`, `site/assets/site.css`, `site/assets/site.js`

### Steps
1. Setup: `npm run site:preview` as in MT-01. Open any guide page.
2. In the page list, expand **Preferences reference**. It lists one page per section (General, Confirmations, Tabs, File Explorer, Editor and the rest); collapse it again and the list folds away.
3. Click **Editor**. The page holds only the Editor settings, and the page list keeps **Preferences reference** expanded with **Editor** highlighted.
4. Open **Preferences reference** itself. It lists every section page, each linking to it.
5. Expand **Key bindings reference** and open **View**. The page holds only the View bindings.
6. In throng (as in MT-02 step 1), click the **?** beside an Editor setting. The Help window shows the Editor section page, scrolled to that setting.

### Negative cases
- No section page repeats another's settings, and no setting is missing from every page.

## MT-05: The (?) on key bindings and theme settings

Covers: FR-028, FR-017, FR-046, FR-055, FR-056, FR-061
Paths: `packages/ui/src/renderer/preferences/keybindings-tab.tsx`, `packages/ui/src/renderer/preferences/themes-tab.tsx`, `packages/ui/src/renderer/preferences/icon-section.tsx`, `packages/ui/src/renderer/panel-type/panel-type-form.tsx`, `packages/ui/src/renderer/panel-type/terminal-inputs.tsx`, `packages/ui/src/renderer/sidebar/projects-panel.tsx`, `packages/ui/src/renderer/find-in-files/find-in-files-panel.tsx`, `packages/core/src/config/theme-copy.ts`, `docs/theme-settings.md`, `packages/ui/src/renderer/common/help-link.tsx`, `packages/core/src/config/keybindings-metadata.ts`, `packages/core/src/config/theme-metadata.ts`, `docs/key-bindings.md`, `packages/ui/src/renderer/resources/**`

### Steps
1. Setup: throng running as in MT-02 step 1. Open Preferences › Key Bindings.
2. Every command shows a one-line description and a **?** beside its name. Click the **?** beside **Help**: the Help window shows the key bindings reference at that command.
3. Open the **Themes** tab. Every theme setting shows a one-line description and a **?** beside its name. Click one: the Help window shows that theme setting's own section of the reference.
4. Tab to a **?** on either tab and press **Enter**. It opens the same place as clicking it.
5. Close Preferences. In an empty panel, choose **Terminal** from **Panel Type**: a **?** appears beside "Panel Type". Click it: the Help window shows the Terminals page at *Open a terminal*.
6. On the same form, click the **?** beside "Terminal settings": the Help window shows *Change how a terminal is set up*.
7. Look at the Projects pane's header: it has no **?**. Press **Ctrl+Shift+F** and click the **?** among the Find in Files options: *Search the whole project* opens, not *Narrow a search*.
8. Open the Resource Monitor (**Ctrl+Shift+Alt+Y**). Click the **?** at the end of the first row: no popover opens; the Help window shows *Find your way around the Resource Monitor*. Every **?** in the window is the same small icon as in Preferences.
9. Click the **?** beside **Order by**, **Hide idle**, **Hide ended** and **Capture every**: each opens *Choose what the list shows*. The **?** beside **Held folders** opens *See which folders throng is holding*; the ones on the **Total** row and the marks open *Read the figures*.

### Negative cases
- No command or theme setting has a description running onto a second line, and no **?** lands at the top of a page instead of its section.
- Every **?** outside Preferences (Find in Files, the panel type form, the Resource Monitor) is the same small size as the ones in Preferences.

## MT-06: Every guide page, complete

Covers: FR-004, FR-025, FR-030, FR-031, FR-033, FR-023, FR-036, FR-037, FR-057, FR-058, FR-059, FR-060, FR-022, FR-068
Paths: `site/guide/**`, `packages/ui/tests/guide-screenshots/**`, `site/assets/site.css`, `docs/preferences.md`, `docs/key-bindings.md`, `docs/theme-settings.md`, `scripts/guide-build.mjs`, `packages/core/src/config/settings-metadata.ts`, `packages/core/src/config/keybindings-metadata.ts`, `packages/core/src/config/theme-metadata.ts`, `packages/core/src/preview/providers/csv.ts`, `packages/core/src/preview/providers/markdown.ts`, `.claude/skills/throng-guide/**`

### Steps
1. Setup: `npm run site:preview` as in MT-01. Open each page in the page list in turn.
2. No page says it is being written. Each opens with a short introduction, then its tasks, every task in the same layout: its heading, a bold breadcrumb of the clicks that get you there, a short description followed by numbered steps, a screenshot where one helps, then any callouts. No section has a **Where:** or "Why you'd use this" line, and a horizontal rule separates each section from the next.
3. Notes, tips and warnings stand out as coloured callout boxes, not plain quotes.
4. Pages that teach part of the window show screenshots of throng with real projects, tabs and terminals open, each beside the task it shows.
5. Read a page aloud. It sounds like one person talking you through throng, in British English (colour, organise), not a manual.
6. Click any screenshot. It opens enlarged in a modal over a dimmed page; close it with its ✕, by clicking the dim area around it, and with **Esc**.
7. Look at the Terminals and Editing pages: every screenshot is wider than it is tall and fills the width of the text column.
8. Open a reference page (Preferences › Editor, say). Each setting has its heading, a bold breadcrumb (**Cog › Settings › Editor › …**), its description, key and default, with a horizontal rule before the next.
9. Open a page with several screenshots, such as Terminals, and scroll down slowly: the screenshots appear as you reach them and the text never jumps as one arrives.
10. Read a few pages and the descriptions in Preferences › Settings, Key Bindings and Themes. They read as plain writing, with none of the stock AI phrasing ("says so", "you can never", "no one noticed", "silently fails", "it's worth noting", "not X but Y").
11. Open **File Explorer** under each of the three references in turn. Above each heading a breadcrumb reads **Guide › Preferences reference › File Explorer** (then Key bindings reference, then Theme settings reference); its first two parts link back. A guide page such as Terminals reads **Guide › Terminals**; the start page has none.

### Negative cases
- No page repeats a reference table; settings and bindings are linked, not copied.
- No section anywhere starts with **Where:** or *Why you'd use this:*.
- No screenshot shows a stray dev-build marker, a personal path or an empty workspace where the task needs content.

## MT-07: The Help window

Covers: FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-062, FR-063, FR-011, FR-064, FR-065, FR-066, FR-069, FR-070
Paths: `packages/ui/src/main/help-protocol.ts`, `packages/core/src/help/help-urls.ts`, `scripts/help-build.mjs`, `packages/ui/src/main/external-url.ts`, `packages/ui/src/main/window-open-guard.ts`, `packages/core/src/config/settings-metadata.ts`, `packages/core/src/config/app-settings.ts`, `packages/ui/src/main/help-window.ts`, `packages/ui/src/main/help-window-model.ts`, `packages/ui/src/main/help-protocol.ts`, `packages/ui/src/main/renderer-request-filter.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/help/**`, `packages/core/src/help/**`, `packages/core/src/icons/**`, `scripts/help-build.mjs`, `scripts/guide-build.mjs`, `scripts/guide-template.mjs`, `site/guide/**`, `site/assets/site.js`, `package.json`, `packages/ui/src/main/external-link-prompt.ts`, `packages/ui/src/main/link-prompt-window.ts`, `packages/ui/src/renderer/link-prompt/**`, `packages/ui/src/renderer/main.tsx`, `site/assets/site.css`, `docs/preferences.md`, `site/guide/preferences.md`

### Steps
1. Setup: `npm run build`, then `npm start` from the worktree. No site preview needs to be running. Turn the network off (or unplug).
2. Press **F1**. A throng window titled for the guide opens on the start page. No browser opens.
3. Click another throng window so the Help window is behind it. In Preferences › Settings, click the **?** beside any setting: the same Help window (not a second one) shows that setting's section and comes to the front.
4. Click the main window. The Help window drops behind it: it is not kept on top.
5. In the Help window, click a page in the page list, then a link in the page. Both open in the window. Press **Alt+Left** twice: back on the setting's section. **Alt+Right** goes forward again; so do the Back and Forward buttons and the mouse's side buttons.
6. Type in the guide's search box: results appear, with the network still off.
7. Click a screenshot: it enlarges, and closes with its ✕, a click outside it, or Esc.
8. Click **GitHub** in the page's header: a modal asks first, showing the GitHub address with **Open** and **Cancel**. Click **Open**: your OS browser opens GitHub; the Help window stays on the guide.
9. Turn the network on and click **Open in browser**: the same prompt shows the page's website address (`http://localhost:8080/…` in a development build); **Open** opens that page in the browser.
10. Close the Help window, then click a **?** in the Resource Monitor: the Help window opens again at the right task, at its last size and position.
11. Make the Help window short enough that the page list scrolls. In Preferences › Key Bindings, click a command's **?**. The page list has scrolled so **Key bindings reference** is in view and marked as the open page. Open throng-ide.com's guide at the same page in a short browser window: its page list is scrolled the same way.
12. With the Help window open, close throng's main window. The Help window closes with it.
13. Reopen throng and the Help window. Rest the pointer on a link in the page list: a small popover fades in at the window's bottom left with the address and "in the guide". Move to **GitHub** in the header: the popover changes to its address and "external". Move to **Features** in the header: it shows "external" and a throng-ide.com address, since the website opens in your browser. Move off every link: it fades out.
14. Click **GitHub** again and choose **Cancel**: nothing opens.
15. Ctrl+click a web address in a terminal, then in an editor, then click a web link in a Markdown preview, then the repository link in About: each asks with the same modal before the browser opens.
16. In the modal, click **Change in Preferences**: Preferences opens on Settings with Confirmations unfolded and **Ask before opening external links** in view, even when Preferences was already open on another tab with everything folded. Turn it off, then Ctrl+click the terminal's address again: the browser opens with no prompt. Turn it back on.
17. Run `npm run site:preview` beside throng. In the Help window, rest the pointer on **Features** in the header: the popover reads "External" and `http://localhost:8080/#features`. Click it and choose **Open**: the browser opens the local preview, not throng-ide.com. Click **Open in browser**: the same page opens on the local preview.
18. In the Help window, follow **Sitemap** in the footer: the prompt names `http://localhost:8080/sitemap/`, and the sitemap opens in the browser, not in the Help window.
19. Click **GitHub** in the Help window's header. The prompt opens inside the Help window, over the guide page, in the same style as the Destroy Panel dialog; no separate window appears and nothing flickers. While it is open, the Help window takes no clicks or keys, but the main window and Preferences still work. Press **Esc**: the guide page is back and the Help window responds again.

### Negative cases
- Only one link popover ever shows, however fast the pointer moves between links.
- With the prompt on, no external link anywhere opens the browser without the modal first.
- A second F1 or (?) never opens a second Help window.
- In a development build, no Help window link or popover names throng-ide.com.
- The window showing the link prompt takes no click, key or scroll outside the prompt until it is answered; other throng windows keep working.
- The Help window never loads anything from the internet: with the network off, no page, image or search fails.

