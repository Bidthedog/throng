# The guide's voice and page shape

A page is read by someone with throng open beside it, trying to get something done. Write for that
person, as the maintainer would if they were sat next to them.

## Voice

The maintainer's own, adapted to instructions. Every page, reference section and in-app description is
also written by the **stop-slop** skill's rules (load it before writing): its phrases, structures and
quick checks apply here, and this file does not repeat them. `docs-currency.test.ts` refuses "says so",
"you can never", "no one noticed" and "silently fail(s)" (080 FR-058).


- **Direct "you", imperative steps.** "Open the cog menu and choose **Help**." Never "the user can…" or
  "throng allows…".
- **Mostly short and punchy**, with the odd longer sentence joined by *and*, *but* or *so* when it
  explains why. Rhetorical questions are fine in an introduction ("Lost a terminal? It's probably in a
  sub-workspace.").
- **A dry aside in brackets now and then**: one a page at most, and never inside a numbered step.
  No swearing, no emoji, no exclamation marks in steps.
- **Firm, then fair.** Recommend the way you'd do it, then concede the alternative in a clause ("Drag is
  quicker, but the menu works when your hands are on the keyboard.").
- **Perfect British English**: colour, organise, behaviour, licence (noun), grey, centre, "towards".
  Product and API names keep their own spelling (`Color`, `Visual Studio Code`). No dashes in prose
  (a colon, brackets or a new sentence instead); an en dash only in a range (`200 – 1,200 px`). No
  semicolons in steps.
- **Name the exact control or chord** in bold, as the app shows it: **Split Right**, **Ctrl+Shift+F**.
  A step that differs on macOS gives the Mac chord inline: **Ctrl+Shift+F** (macOS: **Cmd+Shift+F**).
- **The app as it is.** No "previously", "now", "new". The one exception: a task that changed in a
  release says so in one line, "Changed in 1.0.0: …".

## Page shape

```markdown
---
title: Terminals
order: 6
---

# Terminals

Two to four sentences: what this area of work is for, and what the page covers. Its first 160 characters are
the page's search description and link preview, so the opening sentence must stand on its own.

## Open a terminal in your project

**A panel's + › Panel Type › Terminal**

One to three sentences describing the feature: what it is, what it does and what the reader gets from it.

1. Click **+** in a panel's header.
2. Choose **Terminal** from **Panel Type**.
3. Pick a flavour, then click **Confirm**.

![A new terminal beside the editor](images/terminals/open-a-terminal.png)

> [!TIP]
> One tip, only when it saves real effort.
```

- **One task per `##`**, headed by the task in the user's words: a verb phrase ("Split the
  workspace"), never a feature name ("Splits").
- **A bold breadcrumb first** (080 FR-059): the whole paragraph in bold, the route through the UI as the user
  meets it, separated by ` › `, with no label. A chord that works anywhere: `**Anywhere (Ctrl+Alt+P)**`. A
  file on disk: `**Your config folder (settings.json)**`. No `**Where:**` or `*Why you'd use this:*` line.
- **Then the description**, in prose: what the feature is and does. Describe it; do not sell it.
- **Then numbered steps**, one action each. Optional steps say "(optional)" at the start.
- **Facts are linked, not copied.** A setting's values or a binding list live in the references; link
  the section (`[Word wrap](../docs/preferences.md#editor.wordWrap)`). Never paste a reference table.
- **The builder draws a horizontal rule** before every section but the first. Write none in the Markdown.
- **A reference section** (setting, key binding, theme setting) is its heading, a bold breadcrumb
  (`**Cog › Settings › Editor › Links**`), its key, the in-app description as the lead line, the default,
  then the long description.
- `index.md` and `faq.md` have no tasks, so no breadcrumb or steps. Everything else does, and
  `docs-currency.test.ts` checks it.

## Callouts

GitHub's alert syntax, which GitHub renders in the repository and the site renders as a coloured box:

| Marker | Use for |
|---|---|
| `> [!NOTE]` | Something that changes how a step behaves (a platform difference, a default) |
| `> [!TIP]` | A shortcut that saves real effort |
| `> [!WARNING]` | Only when work can be lost or something cannot be undone |

At most one callout per task. A plain `>` quote stays a quote.

## Screenshots

Generated, never hand-captured: `npm run guide:screenshots` (after `npm run build`, with no throng from
the worktree running) writes `site/guide/images/<page>/<task>.png` from a seeded demo project in the **throng**
theme. Each image sits after the step it illustrates, with alt text saying what it shows. Add a shot by
adding a case to `packages/ui/tests/guide-screenshots/guide-screenshots.spec.ts`.

- **Landscape, full column width.** Every shot is a whole window (1440×900). A shot of one panel or pane uses
  `focusShot`, which puts that panel in Focus Mode so it fills the window; never crop to a tall, narrow element.
  The generator refuses a portrait capture and `docs-currency.test.ts` fails on one.
- **Enlargeable for free.** The builder wraps every image in the home page's zoom link, so a click opens it in
  the enlarge modal (✕, the scrim or Esc closes it). Write a plain `![alt](images/<page>/<task>.png)`.
- **No people or machines in a picture**: the demo project lives at a neutral path and the shell prompt is reset,
  so no user name, host name or home folder appears.
