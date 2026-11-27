# Feature Specification: Online help and the user guide

**Feature Branch**: `feature/S080-I477-I693-help-and-wiki`

**Created**: 2026-11-24

**Status**: Draft

**Input**: Issues [#477](https://github.com/Bidthedog/throng/issues/477) (help documentation opened from
the cog menu, with (?) links to the exact section) and
[#693](https://github.com/Bidthedog/throng/issues/693) (a user wiki for throng, written to teach, and
kept current by PR and release checks). Both were in v1.0.0 before the feature freeze of 2026-11-23,
and the maintainer kept them there. One website serves both.

## Clarifications

### Session 2026-11-24

- Q: Where does the user wiki live? → A: **On throng-ide.com, as docs-as-code.** It is Markdown in this
  repository, built into the existing GitHub Pages site by a static site generator, reviewed in PRs and
  checked in CI. The site stays on GitHub Pages; nothing the wiki needs requires a server.
- Q: How does the help open from inside throng? → A: **It is the website.** Cog menu → **Help** and every
  (?) link open throng-ide.com in the OS browser, at the page and section they name. Nothing is
  packaged with the app and throng renders no help itself. This supersedes the earlier answer in this
  session (help packaged and opened in throng's Markdown preview), and with it #477's "offline" and
  "ships in the installer" criteria: the help needs a network connection, and it describes the latest
  release rather than the build the user is running.
- Q: Where does each setting's full explanation live once Preferences descriptions are cut to one line?
  → A: **`docs/preferences.md`**, which already lists every setting by key. It keeps that job, and is
  published on the site so the (?) links can point at its anchors. The guide's task pages link to it
  rather than repeating it.
- Q: How much content ships under this spec? → A: **All of it, in staged pull requests.** Stage 1
  delivers the site build, the Help item, the (?) links and the checks. Later stages write the
  trainer-voice pages, one pull request per area, until every v1.0.0 feature is covered.
- Q: Should the index of every feature, and the page and section that teaches it, be a committed,
  machine-checked file? → A: **Yes, a committed guide map**, which CI checks against the app's commands,
  panel types and preview types, and which the release check reads. The guide is **user directions**:
  the map is keyed by the tasks a user performs, every section is one task with numbered steps, and
  features are reached through the tasks that use them. The page and section plan, drawn from an index
  of the whole app, is [page-plan.md](page-plan.md).
- Q: Does the guide replace `docs/quick-start.md`? → A: **Yes.** Its content moves into the guide's
  **Quick start** page, the file is removed and every link to it points at the guide. The guide's first
  page introduces throng and its main features at a high level and links to Quick start. The guide
  looks like the rest of throng-ide.com: the same stylesheet, fonts, colours, header and footer.
- Q: Does the site gain analytics (Plausible) with the guide? → A: **No.** The site keeps collecting
  nothing, and its privacy line stays as it is. Analytics may be looked at later, outside this spec.

### Session 2026-11-25

- Q: Which source does throng-ide.com publish the guide from: the latest release tag, or master? → A:
  **The latest release tag**, for the whole site. Every page shows the version it was built from, and
  the guide names it at the top. No archive of older guides is kept; git history holds them.
- Q: Should the default Help binding be F1, and should F1 still reach a program in a focused terminal?
  → A: **F1, live everywhere except a terminal.** In a focused terminal F1 goes to the program running
  there; the cog menu's Help item still works from a terminal.
- Q: Does the guide have search when it launches? → A: **Yes, in stage 1.** A static search index
  covers the guide and both reference pages, built at deploy time with no server, in the shared header.
- Q: What is the longest a setting's one-line description may be? → A: **100 characters.** It keeps what
  the setting does and its one essential qualifier; every lower-level detail moves into the help.

### Session 2026-11-25 (iteration 1, after stage 1's hand test)

- Q: Is the work still delivered in stages, one pull request each? → A: **No. Every stage completes on
  this branch, in this pull request**: the descriptions, the (?) audit, every page's content and the
  screenshots. FR-025 supersedes FR-024. The issues close when this pull request merges.
- Q: The preferences and key bindings references are too long to read as one page. → A: **Each `##`
  section of a reference is built into a page of its own**, and the guide's left navigation shows each
  reference as an expandable item listing those pages (FR-026). The Markdown file stays one file in the
  repository. *(The split by `##` section, and the section in each (?) URL, derived from the existing
  group headings; not confirmed by the user.)*
- Q: Where does a setting's (?) sit? → A: **Beside the setting's title**, not after its description
  (FR-027).
- Q: Do key bindings and theme settings get the same (?) and the same rules? → A: **Yes.** Every key
  binding and every theme token has a description of at most 100 characters, a (?) beside its title in
  Preferences, and its own section of a reference on the site, checked like settings (FR-028).
- Q: Where is the site's navigation? → A: **In the same place on every page**, the guide included:
  aligned right, as the home page has it. On guide and reference pages the search field sits in the
  header to the left of the navigation links, and its results open below the header, readable and
  scrollable (FR-029).
- Q: Whose voice is the guide written in? → A: **The maintainer's**, in perfect British English, written
  for users, every page with the same layout. Each task says how to get to it, as a breadcrumb (FR-030).
  *(The voice is the maintainer's writing profile adapted to instructions: direct "you", imperatives,
  short punchy sentences, the odd dry aside in brackets, no swearing; derived from that profile, not
  confirmed by the user.)*
- Q: Do the pages use callouts and screenshots? → A: **Yes.** Notes, tips and warnings are drawn as
  callouts, and the pages carry screenshots of a set-up throng instance (FR-030, FR-031).
- Q: Can a page ship marked "being written"? → A: **No.** Every page is complete when this pull request
  merges, and a check refuses an outline page (FR-033).
- Q: How is the help kept current as features are added, changed or removed? → A: **A skill owns it**,
  run with every user-visible change, by the same rules the checks enforce (FR-032). *(A separate
  maintenance skill that points at `throng-guide` for voice and page shape, rather than a second home for
  either; derived, not confirmed by the user.)*

### Session 2026-11-26 (iteration 10)

- Q: Where do the Help window's website links go in a development build? → A: **To the local preview**: a
  development build (not packaged) uses `http://localhost:8080/`, where `npm run site:preview` serves the site;
  a packaged build uses `https://throng-ide.com/`. The header's links, Open in browser and the link popover all
  follow it, and every throng-ide.com link is external (FR-065).
- Q: Is the sitemap page part of the guide? → A: **No, it belongs to the website**: it is not shipped with the
  app, a link to it from the Help window opens the website, and it shows no page list (FR-066).
- Q: Should `sitemap.xml` list section bookmarks (`#anchor`)? → A: **No** *(derived)*: search engines drop the
  fragment, so each would be a duplicate of its page; every reference section is already its own page and
  listed. `sitemap.xml` lists every deployed page (FR-042).
- Q: What makes a guide screenshot up to date at a release? → A: **Its screen has not changed since the
  previous release, or the image was regenerated after it did**: each screenshot names the source of the screen it
  shows, and the release refuses an image whose screen changed while the image did not (FR-067).
- Q: How does a reader tell where a guide page sits (File Explorer is a settings, key bindings and theme
  settings section)? → A: **A breadcrumb above each page's heading**: Guide › its reference › the page (FR-068).
- Q: What may the user do while the link prompt is open? → A: **Nothing else in throng**: it takes and holds
  focus, and no throng window takes input until it is answered or closed (FR-069).
- Q: Should the link prompt be a window of its own? → A: **No, an inline dialog** in the window the link was
  followed in, the common confirm dialog every other throng dialog uses (Destroy Panel's), blocking that window
  only. The separate window flickered as focus was handed back (FR-070, superseding FR-069's app-wide hold).

### Session 2026-11-26 (iteration 9, after iteration 8's report)

- Q: Where does the prompt's Change in Preferences go? → A: **To the setting itself**: Preferences opens on its
  tab, unfolds the setting's section and subsections, and scrolls to its row. This corrects iteration 8's derived
  "opens the Confirmations group" (FR-063, FR-064).
- Q: Is that one mechanism or one per caller? → A: **One standard reveal**, used wherever throng sends the user
  to a setting, a key binding or a theme setting. 068's deep link already did this for Settings by key; it
  extends to Key Bindings (by action id) and Themes (by theme setting key) (FR-064).

### Session 2026-11-26 (iteration 8, after iteration 7's hand test)

- Q: How is the help written? → A: **Without AI writing patterns.** Every in-app description (settings, key
  bindings, theme settings), every guide page and the three references are rewritten with the `stop-slop`
  skill. The phrases "says so", "you can never", "no one noticed" and "silently fails" never appear, and a check
  fails the build when one does (FR-057, FR-058).
- Q: What shape is a section? → A: **Header; a bold breadcrumb of the user's actions to get there; the long
  description; a screenshot where one applies; callouts where they help.** The "Where:" and "Why you'd use
  this" prefixes go. A horizontal rule separates each section from the next. Guide tasks keep their numbered
  steps inside the long description, after a short prose lead; reference sections are prose (FR-059;
  supersedes the "Where:" and "why you'd use this" lines of FR-022 and FR-030).
- Q: How do screenshots load? → A: **Lazily, as the home page's do**: `loading="lazy"` with the image's width
  and height, so the page does not jump as they arrive *(width and height derived from the home page)*
  (FR-060).
- Q: Where does the Find in Files (?) go? → A: **Search the whole project**, not *Narrow a search* (FR-061;
  settles FR-017's "the right guide section" for Find in Files).
- Q: What does hovering a link in the Help window show? → A: **A small popover in the window's bottom-left
  corner** with the link's address and whether it stays in the guide or leaves it. One at most; it fades in
  while a link is hovered and fades out when the pointer leaves it (FR-062).
- Q: What happens when an external link is activated? → A: **throng asks first, everywhere.** Just before the
  OS browser (or another app) would open, a modal shows the link with **Open** and **Cancel**, and a button that
  opens Preferences at the setting that turns the prompt off. The setting is on by default and covers every
  external link throng opens: the Help window, terminals, editors, previews, About and every other window
  *(the button lands on the setting itself, derived from how every (?) lands on its own section; the Help
  window's **Open in browser** is an external link like the rest, derived from "ALL external links")*
  (FR-063).

### Session 2026-11-26 (iteration 7, after iteration 6's hand test)

- Q: When a page opens, must the guide's navigation show it? → A: **Yes.** The navigation scrolls itself so the
  open page's entry is in view, in the Help window and on the website alike (FR-053).
- Q: Does the Help window outlive the main window? → A: **No.** throng's main window is the master of every
  window throng opens; closing it closes the Help window too. Help is still never kept on top and never modal
  (FR-054).
- Q: How big is a (?)? → A: **Smaller than a standard icon control, and still legible**: its glyph is drawn
  below the standard icon size, in a control of matching size, the same everywhere and whatever the icon-size
  setting. The earlier attempt shrank the button's text but left the glyph at the standard icon size, so
  nothing visibly changed (FR-055).
- Q: Does the Projects pane keep its (?)? → A: **No.** The maintainer did not want it; FR-017's audit outcome
  for "the project list" is reversed. Every other audited (?) stays: Find in Files' options, the panel type
  form's Panel Type and Terminal settings, the Resource Monitor's, and Preferences' rows (FR-056).

### Session 2026-11-26 (iteration 6)

- Q: Where does Help open? → A: **In a throng Help window**, not the OS browser. There is one; F1, the cog
  menu's Help and every (?) load their page into it and bring it to the front. It is an ordinary window: it
  is never kept on top (FR-048).
- Q: Does the Help window load the website? → A: **No.** It renders the guide built from the same source
  (`site/guide/` and the three references) by the same builder, when throng itself is built, and shipped
  with the app. Help always describes the build it ships with and works offline (FR-049).
- Q: Does the guide's search work in the Help window? → A: **Yes**: the build indexes the shipped guide
  with Pagefind, the same version the website uses, so search runs offline. *(Derived from FR-002c.)*
- Q: What happens to links that leave the guide (the site header's Features, Install, Build, GitHub,
  release links)? → A: **They open in the OS browser**; only the shipped guide's own pages open in the
  window (FR-050). *(Derived from 044's navigation guard.)*
- Q: Can the user go back, or open the page on the website? → A: **Yes**: Back and Forward (the window's
  buttons, Alt+Left / Alt+Right and the mouse's back and forward buttons), and an **Open in browser** button
  that opens the same page on throng-ide.com (FR-051). *(Derived.)*
- Q: A development build? → A: It renders its own build of the guide like a release does, so FR-045's local
  preview is no longer needed for Help; `THRONG_HELP_BASE_URL` is retired. *(Derived.)*
- Q: And if the guide was not built into this copy? → A: The window says so and how to build it, rather than
  showing a blank page (FR-052). *(Derived from the failure-presentation rules.)*

### Session 2026-11-26 (iteration 5)

- Q: Do the Resource Monitor's "?" helpers stay popovers? → A: **No.** They use the same (?) icon as every
  other help link and open the guide in the same way; their words move into the guide (FR-046).
- Q: Does each guide page still open with "This guide describes throng <version>"? → A: **No.** The header
  already shows the version on every page, so the line repeats it (FR-047).
- Q: Which guide sections do they open? → A: The monitor's general "?" opens *Find your way around the
  Resource Monitor*; Order by, Hide idle, Hide ended and Capture every open *Choose what the list shows*;
  Held folders opens *See which folders throng is holding*; the Total row and the "-" / "~" marks open
  *Read the figures*. *(Derived, not confirmed by the user.)*
- Q: Does Print Preview's header-and-footer "?" change too? → A: **Not in this change**: it lists the
  placeholders a header or footer can hold, which belongs beside the field. *(Derived; the user named only
  the Resource Monitor.)*

### Session 2026-11-26 (iteration 4)

- Q: Where do Help and the (?) links go in a development build? → A: **The development copy of the guide**,
  not the live site. The guide's root is chosen by build type: a packaged (release) build opens
  `https://throng-ide.com/guide/`; a development build (run from source, unpackaged) opens the local site
  preview, `http://127.0.0.1:8080/guide/` (`npm run site:preview`). It is a background setting, defined
  in the app's source by build type, never a preference; `THRONG_HELP_BASE_URL` still overrides it in
  either build (FR-045).

### Session 2026-11-25 (iteration 3)

- Q: Is the site set up for search engines? → A: **Yes.** Every page describes itself to search engines and
  link previews, `sitemap.xml` lists every page, and a sitemap page lists them for people (FR-041, FR-042).
- Q: Where does a page's description come from? → A: **Its opening paragraph**, cut to 160 characters at a
  word, so it never needs writing twice. *(Derived, not confirmed by the user.)*
- Q: Where is the sitemap page? → A: **`/sitemap/`, linked from every page's footer.** *(Derived.)*
- Q: Does `llms.txt` point at the guide's references? → A: **Yes**, now that they are pages on the site
  (FR-043). *(Derived from "etc.".)*
- Q: Where does the guide's source live? → A: **`site/guide/`**, beside the rest of the site, not at the
  repository root (FR-044).

### Session 2026-11-25 (iteration 2, after iteration 1's hand test)

- Q: How should the search field's clear button look? → A: **Like the site's other controls**: a small,
  themed icon button inside the field, not Pagefind's default text button (FR-035).
- Q: Can a guide screenshot be enlarged? → A: **Yes, as on the home page**: clicking it opens it in a
  modal that closes with its ✕, by clicking the scrim, or with Esc (FR-036).
- Q: What shape are the guide's screenshots? → A: **Landscape, filling the width of the page's column.**
  A shot of one panel or pane is taken with that panel filling the window, never as a tall narrow crop
  (FR-037).
- Q: What is the start page called? → A: **Intro** (FR-038).
- Q: How do the guide's navigation and page scroll? → A: **Independently.** The navigation stays where
  it is, whatever the page does, and scrolls on its own when it is longer than the window (FR-039).
- Q: Is how the version gets onto each page written down? → A: **Yes**, in `docs/releasing.md`
  (FR-040). *(Placed with the rest of the deployment; derived, not confirmed by the user.)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Learn a feature from a page written to teach (Priority: P1)

A new user wants to know what throng's projects, panels, terminals, editor, previews and so on are for,
and how to get the most from them. They open the user guide on throng-ide.com, or from the cog menu
inside throng, and find a page per area of work. Each section tells them how to do one task, step by
step, with tips, and why they would want to.

**Why this priority**: #693's whole intent. Today nothing walks a user through throng. `docs/` is
written for someone reading the repository.

**Independent Test**: Open throng-ide.com, follow the navigation to the user guide, and open the
Terminals page. It teaches terminals in plain, second-person directions with steps and screenshots.

**Acceptance Scenarios**:

1. **Given** throng-ide.com, **When** a visitor opens the site navigation, **Then** a **Guide** entry
   leads to the user guide's start page.
2. **Given** the guide's start page, **When** the visitor reads it, **Then** it introduces throng, names
   each main feature in a line that links to its page, and links to **Quick start**. The guide's
   navigation lists every page in [page-plan.md](page-plan.md).
3. **Given** any guide page, **When** the visitor reads it, **Then** every section is a task the user
   performs, headed by that task, and gives directions: numbered steps in the imperative, a "why you'd
   use this" line, and tips. It does not describe a feature without telling the user what to do with it.
4. **Given** the README, **When** a reader looks for user documentation, **Then** it links to the guide.
5. **Given** any guide page, **When** the visitor compares it with throng-ide.com's home page, **Then**
   it uses the same stylesheet, fonts, colours, header and footer.
6. **Given** any guide or reference page, **When** the visitor types a setting key or a task's words
   (such as "split") into the header's search field, **Then** matching sections are listed, and choosing
   one opens that section.
7. **Given** any page of the site, the home page included, **When** the visitor compares their headers,
   **Then** the navigation links sit in the same place, aligned right; on a guide or reference page the
   search field sits to their left (FR-029).
8. **Given** a guide or reference page, **When** the visitor types into the search field, **Then** the
   text is readable against the field, the results open in a panel below the header the width of the
   page's content, the panel scrolls on its own, and the page behind it scrolls normally (FR-029).
9. **Given** the guide's navigation, **When** the visitor expands **Preferences reference** or **Key
   bindings reference**, **Then** it lists one page per section of that reference, and each opens a page
   holding only that section (FR-026).
10. **Given** any guide page, **When** the visitor reads it, **Then** it is complete, in the same layout
    as every other page: each task opens with a breadcrumb saying how to get there, gives numbered steps,
    draws notes, tips and warnings as callouts, and the page shows throng in screenshots where a picture
    helps (FR-030, FR-031, FR-033).
11. **Given** a guide page with a screenshot, **When** the visitor clicks it, **Then** it opens enlarged in
    a modal, which closes with its ✕, a click on the scrim, or Esc (FR-036). Every screenshot is landscape
    and fills the page's column (FR-037).
12. **Given** a long guide page, **When** the visitor scrolls to its end, **Then** the navigation does not
    move; **When** the navigation is longer than the window, **Then** it scrolls on its own (FR-039).
13. **Given** the guide's search field with text in it, **When** the visitor looks at its clear control,
    **Then** it is a small icon button in the site's colours (FR-035). The start page is titled **Intro**
    (FR-038).
14. **Given** any page's footer, **When** the visitor clicks **Sitemap**, **Then** a page lists the home page and
    every guide and reference page, each a working link (FR-042).
15. **Given** a guide page shared in a chat or found by a search engine, **When** its preview is drawn,
    **Then** it shows the page's title, the opening of its text and the site's card image (FR-041).
16. **Given** the Resource Monitor, **When** the user clicks its "?" at the end of the first row, or the
    "?" beside Order by, Hide idle, Hide ended, Capture every, Held folders, the Total row or the marks,
    **Then** the guide opens in the browser at the matching Resource Monitor task, and no popover opens
    (FR-046).
17. **Given** throng with no Help window open, **When** the user presses F1, **Then** a throng Help window
    opens on the guide's start page, with no browser involved and with the network off (FR-048, FR-049).
18. **Given** the Help window behind other windows, **When** the user clicks a setting's (?), **Then** the same
    window shows that setting's section and comes to the front; it does not stay on top once the user clicks
    another window (FR-048).
19. **Given** the Help window, **When** the user follows a link inside the guide, **Then** it opens in the window;
    **When** they click GitHub or Install in the header, **Then** the OS browser opens it (FR-050).
20. **Given** the Help window after following two links, **When** the user presses Alt+Left twice, **Then** it is
    back where it started; **When** they click **Open in browser**, **Then** the browser opens the same page on
    throng-ide.com (FR-051).
21. **Given** a (?) whose page sits low in the guide's navigation, **When** the Help window opens it, **Then** the
    navigation has scrolled so that page's entry is in view and marked as the open page; the same holds on
    throng-ide.com (FR-053).
22. **Given** the Help window open beside throng, **When** the user closes throng's main window, **Then** the
    Help window closes with it (FR-054).
23. **Given** any guide or reference page, **When** the user reads a section, **Then** it opens with its header,
    then a bold breadcrumb of how to get there, then the description (with numbered steps in a guide task), a
    screenshot where one applies and callouts; there is no "Where:" or "Why you'd use this" line, and a
    horizontal rule separates it from the next section (FR-059).
24. **Given** any page, description or reference, **When** the user reads it, **Then** it carries no
    "says so", "you can never", "no one noticed" or "silently fails", and none of the AI writing patterns
    `stop-slop` removes (FR-057, FR-058).
25. **Given** a guide page with several screenshots, **When** it opens, **Then** the screenshots below the fold
    load only as the user scrolls towards them, and the text does not jump when they arrive (FR-060).
26. **Given** the Help window, **When** the user rests the pointer on a link, **Then** a small popover fades in at
    the bottom left naming the address and whether it is in the guide or external; **When** the pointer leaves
    the link, **Then** it fades out; there is never more than one (FR-062).
27. **Given** the default settings, **When** the user activates an external link anywhere in throng (the Help
    window, a terminal, an editor, a preview, About), **Then** a modal shows the link with **Open** and
    **Cancel** before anything opens; **Cancel** opens nothing; its Preferences button opens Preferences at the
    setting; **When** that setting is off, **Then** external links open with no prompt (FR-063).
28. **Given** Preferences closed, or open on another tab with every section folded, **When** the prompt's Change in
    Preferences is clicked, **Then** Preferences shows Settings with Confirmations unfolded and **Ask before opening
    external links** scrolled into view; a link to a key binding or theme setting does the same on its own tab
    (FR-064).
29. **Given** a development build, **When** the pointer rests on the Help window's **Features** link, or **Open in
    browser** is clicked, **Then** the popover says External with a `http://localhost:8080/` address and the browser
    opens the local preview; a packaged build uses `https://throng-ide.com/` (FR-065).
30. **Given** the Help window, **When** the footer's **Sitemap** link is followed, **Then** the website's sitemap
    opens in the browser, and that page shows no guide page list (FR-066).

---

### User Story 2 - Get to the help from inside throng (Priority: P1)

A user working in throng chooses **Help** from the cog menu, or presses its key binding. The user guide's
start page opens on throng-ide.com in their browser.

**Why this priority**: #477's core: the help is one click from the app.

**Independent Test**: Open throng, choose cog menu → **Help**. The browser opens the guide's start page.

**Acceptance Scenarios**:

1. **Given** throng is running, **When** the user chooses cog menu → **Help**, **Then** the OS browser
   opens the guide's start page on throng-ide.com.
2. **Given** focus in an editor, preview, File Explorer or the Projects pane, **When** the user presses
   F1, **Then** the same page opens.
3. **Given** a sub-workspace window, the Preferences window or the Resource Monitor has focus, **When**
   the user presses F1, **Then** the same page opens.
4. **Given** a terminal has focus and a program in it uses F1 (such as `mc` or `htop`), **When** the
   user presses F1, **Then** the program receives it and no browser opens.

---

### User Story 3 - Short descriptions, with (?) for the full story (Priority: P2)

A user scanning Preferences sees one short line per setting, saying what it does. Where they need more,
such as examples, how settings interact, or when to change one, a (?) beside the setting opens the help
in the browser at that setting's own section.

**Why this priority**: #477's second half. Some descriptions have grown into paragraphs (the longest is
675 characters), and Preferences is hard to scan.

**Independent Test**: In Preferences → Settings, find any setting. Its description is one line. Click its
(?). The browser opens that setting's section of the preferences reference on throng-ide.com.

**Acceptance Scenarios**:

1. **Given** Preferences → Settings, **When** the user scans any section, **Then** every setting's
   description is one line of at most 100 characters.
2. **Given** any setting, **When** the user clicks its (?), **Then** the browser opens the preferences
   reference scrolled to that setting's own section.
3. **Given** the other surfaces the audit names (FR-017), **When** the user clicks their (?), **Then**
   the browser opens the right guide section.
4. **Given** any theme or icon set, **When** the (?) control renders, **Then** it follows the theme and
   the icon set like every other icon control.
5. **Given** Preferences → Settings, **When** the user looks at a setting, **Then** its (?) sits beside
   the setting's title (FR-027).
6. **Given** Preferences → Key Bindings or Themes, **When** the user scans a command or a theme setting,
   **Then** its description is one line of at most 100 characters and a (?) beside its title opens its
   own section of the reference in the browser (FR-028).
7. **Given** any (?) in any window, **When** the user compares it with the icon buttons around it, **Then** it
   is visibly smaller and its question mark is still readable, and every (?) is the same size (FR-055).
8. **Given** the Projects pane, **When** the user looks at its header, **Then** there is no (?); the (?) in Find
   in Files, the panel type form, the Resource Monitor and Preferences are still there (FR-056).
9. **Given** Find in Files, **When** the user clicks the (?) among its options, **Then** the guide opens at
   *Search the whole project* (FR-061).

---

### User Story 4 - The guide cannot fall behind the product (Priority: P2)

A contributor adds a setting, a key binding, a command, a panel type or a preview type. CI fails their
pull request until the guide covers it, or until the pull request carries the explicit
no-user-facing-change marker. Before a release is tagged, every feature its CHANGELOG names must have
guide coverage.

**Why this priority**: #693's "stays current". Without it the guide rots the way `docs/` would without
`docs-currency.test.ts`.

**Independent Test**: Add a setting with no `docs/preferences.md` section and no marker, and run the
checks. They fail and name the setting.

**Acceptance Scenarios**:

1. **Given** a pull request adding a setting with no section in `docs/preferences.md`, **When** CI runs,
   **Then** it fails and names the setting.
2. **Given** a pull request adding a key binding, command, panel type or preview type with no guide
   change and no marker, **When** CI runs, **Then** it fails and names what is uncovered.
3. **Given** the same pull request carrying the no-user-facing-change marker, **When** CI runs, **Then**
   the guide check passes.
4. **Given** a (?) link whose target anchor does not exist on the built site, **When** CI runs, **Then**
   it fails and names the link.
5. **Given** a release whose CHANGELOG names a feature with no guide coverage, **When** the release is
   prepared, **Then** it is refused before the tag is pushed.
6. **Given** a change that adds, changes or removes a user-visible feature, **When** an agent works on
   it, **Then** the maintenance skill has it update, add or remove the guide task and its map entry in
   the same change (FR-032).
7. **Given** a guide page marked as an outline, **When** CI runs, **Then** it fails and names the page
   (FR-033).

---

### Edge Cases

- **No network connection**: Help and (?) still hand the URL to the browser, which shows its own
  offline page. throng raises no notice of its own.
- **The browser cannot be opened** (no default browser registered): throng raises one notice naming the
  URL, with a Copy action, and logs the failure (FR-011).
- **A (?) whose setting is hidden on this platform** (070's platform-specific settings) is not drawn,
  because the setting itself is not drawn.
- **A heading renamed in `docs/preferences.md`** keeps its setting anchor, which is keyed by the setting
  key, not the heading text. A (?) link never breaks on a reworded heading.
- **A user on an older build** reads the guide for the latest release, and its version is shown at the
  top of the page. A task that changed since names the version it changed in.
- **A build newer than the published release** (a development build) may link to a section the site
  does not have yet. The browser opens the page at its top; throng raises no notice.
  *(Superseded by FR-045 for development builds, which open the local site preview; a release build
  newer than the published site still behaves this way.)*
- **A site change merged between releases** (a typo, a new page) is not live until the next release.
  A manual dispatch still builds from the latest release tag.
- **A user with no project open** can still open the help. It does not depend on a project.
- **A screenshot that no longer matches the UI** is regenerated from the E2E harness (FR-023). It is not
  edited by hand.
- **A pull request that changes only internals** carries the no-user-facing-change marker and is not
  asked for guide changes.
- **A feature only developers see** (DevTools, a daemon from another checkout, orphan-process cleanup)
  has no task. The guide map lists it as excluded, with the reason.

## Requirements *(mandatory)*

### Functional Requirements

#### Where the guide lives (#693)

- **FR-001**: The user guide MUST be Markdown in this repository, under one directory that holds only
  guide pages and their images.
- **FR-002**: The guide, `docs/preferences.md` and `docs/key-bindings.md` MUST be built into the
  throng-ide.com site by a static site generator as part of the existing GitHub Pages workflow. The site
  MUST keep serving its current pages, including the apt and rpm repositories, unchanged apart from the
  home page's Guide link (FR-003) and version label (FR-002b).
- **FR-002a**: Guide and reference pages MUST use the site's existing look: `site/assets/site.css`, its
  fonts and colours, and the same header and footer as `site/index.html`. One stylesheet serves the
  whole site, so a change to the site's look changes the guide with it.
- **FR-002b**: The site MUST be built from the latest release tag, never from master between releases:
  every deployment, whether a release triggers it or someone dispatches it by hand, checks out that tag.
  Each page MUST show the release version it was built from, and every guide and reference page MUST
  name that version at its top. Only the current version is published; older guides are not archived on
  the site. "Latest release" is the newest published `v*` release, prereleases included, since every
  release before 1.0.0 is one. This supersedes 064's user story 4 (a static-file change deployed from
  master by hand): such a change now goes live with the next release. 072 FR-010's triggers, a release
  and a manual dispatch, are unchanged; only the ref they build changes.
- **FR-002c**: Every guide and reference page MUST carry a search field in its header that searches the
  guide, `docs/preferences.md` and `docs/key-bindings.md`, and lists matching sections, each linking to
  its anchor. The index is static, built with the site, and needs no server.
- **FR-003**: The site's navigation, the README and the cog menu MUST each reach the guide's start page.
  The start page introduces throng, names each main feature in one line linking to its page, and links
  to Quick start.
- **FR-003a**: The guide's **Quick start** page MUST replace `docs/quick-start.md`. That file is removed,
  and every link to it (README, `docs/README.md`, the other `docs/` pages, the throng-docs skill, the
  pull request template and `docs-currency.test.ts`) points at the guide instead. The quick-start
  contradictions in [page-plan.md](page-plan.md) are corrected in the guide page, not in the old file.
- **FR-004**: The guide MUST have the pages and sections [page-plan.md](page-plan.md) lists. Each section
  is a user task, headed by the task in the user's words, and gives directions.
- **FR-004a**: A committed **guide map** MUST list every task in the guide with its page and section
  anchor, and the commands, panel types, preview types and settings that task uses. Every command, panel
  type and preview type the app has MUST appear in at least one task, or be listed in the map as
  excluded with a reason (developer-only features such as DevTools). The checks in FR-015, FR-018 and
  FR-019 read the map.
- **FR-005**: Every guide and reference heading MUST have a stable anchor on the site, so the README, the
  site and the app's (?) links can deep-link to it.

#### One home per fact

- **FR-006**: `docs/preferences.md` MUST remain the one home for each setting's full explanation, and
  `docs/key-bindings.md` for each binding's. The guide's pages MUST link to them and MUST NOT repeat
  their tables. The guide teaches tasks; the reference pages list facts.
- **FR-007**: Every setting MUST have its own section in `docs/preferences.md`, with an anchor derived
  from the setting key that does not change when the heading's text does.
- **FR-008**: The `throng-docs` file table and `docs/README.md` MUST name the guide and its job, so its
  boundary with `docs/` is written down.

#### Opening the help (#477)

- **FR-009**: Help URLs MUST be built from one base URL defined once in the app, plus a page and anchor
  taken from the guide map or the setting key. No help URL is written out by hand anywhere else.
- **FR-010**: The cog menu MUST have a **Help** item, and a default key binding, **F1**, that works from
  every throng window. Both open the guide's start page in the OS browser. F1's scope is every
  surface except a terminal: while a terminal has focus, F1 reaches the program running in it.
  Justification for Principle IV's recorded-exception list (a function key outside the chord tiers):
  F1 is the standard Help key on every platform, chosen by the maintainer (clarification 2026-11-25);
  recorded at constitution 7.6.0.
- **FR-011**: Help and (?) links MUST open in the OS default browser, never in throng's HTML preview or
  any other throng surface, whatever the default open action for HTML is set to. They go through the
  existing `http(s)` route for opening web links. When the OS cannot open a browser, throng logs it and
  raises one notice naming the URL, with a Copy action (constitution XIII; that route drops the failure
  today, so this adds it).
- **FR-012**: *Retired 2026-11-24* with the packaged help (it covered links between pages rendered inside
  throng). The number is not reused.

#### Short descriptions and (?) links (#477)

- **FR-013**: Every setting's in-app description MUST be one line of at most **100 characters**, stating
  what the setting does and at most one essential qualifier (such as "Applies after a restart"). Every
  lower-level detail (examples, how it interacts with other settings, platform differences) moves into
  its `docs/preferences.md` section. A check MUST fail the build when a description exceeds 100
  characters, naming the setting. *(Amended 2026-11-27, maintainer's v1 review: the description says, in
  plain words, what ticking the setting or choosing its value does, so it is clear at once without the
  reference; no internal terms and no qualifier that needs the reference to make sense. Every setting's
  section in `docs/preferences.md` carries at least one paragraph of detail after that line: what the
  setting means to throng, the features it feeds and how it interacts with other settings. A check fails
  the build for a section with no such paragraph. This supersedes, for where the fact is written and
  nothing else, each requirement that put a detail in a setting's description: 068 FR-051 and FR-052 (the
  Claude Code resume), 057 FR-061 and FR-065 (how late Command finished can be), 045 FR-080a and FR-080c
  (`FORCE_HYPERLINK` and terminals already running), the link timeout's network and restart notes, the
  known-extensions dot and case rule, 040 FR-034 as amended by 044 FR-118f (hiding the status bar wins, and
  terminals have their own), and 054 FR-052 (the "Open previews in" sentence, now "Where <Type> previews
  open…"). Each fact now lives in the setting's `docs/preferences.md` section.)*
- **FR-014**: Every setting row MUST show a (?) control that opens that setting's section of the
  preferences reference on the site. The control is a themeable icon control with a hover title naming
  where it goes, and is reachable from the keyboard.
- **FR-015**: A check MUST fail the build when a setting has no section in `docs/preferences.md`, or when
  any (?) link or guide-map entry targets a page or anchor that the built site does not have.
- **FR-016**: The one-line description MUST stay defined once, in the settings metadata. The full section
  MUST be checked against it, so the two cannot describe different settings.
- **FR-017**: The other places that carry long descriptions, tooltips or notices are audited, and each
  surface the audit lists MUST get a (?) to the right guide section. The audit covers panel types,
  terminal settings in the Terminal form, the project list, Find in Files options and the Themes and Key
  Bindings tabs. The audit and its outcome are recorded in this feature's research. *(The project list's (?) is
  superseded by FR-056. Find in Files' target is settled by FR-061.)*

#### Staying current (#693)

- **FR-018**: A check in PR CI MUST fail when the app has a setting, key binding, command, panel type or
  preview type that the guide map and the reference pages do not cover. It MUST name each uncovered item.
  A pull request that changes user-visible behaviour without touching the guide MUST carry the
  no-user-facing-change marker, or the check fails. It extends `docs-currency.test.ts`.
- **FR-019**: The `throng-release` skill MUST refuse to tag a release whose CHANGELOG names a feature
  that no task in the guide map covers.
- **FR-020**: A repo-local skill MUST own the guide's voice, page structure and where a new feature's
  page goes, and CLAUDE.md MUST route to it. It runs whenever a user-visible feature is added or changed.
- **FR-021**: The pull request template MUST carry a Documentation checkbox for the guide, and the
  no-user-facing-change marker MUST be documented there.

#### Style and screenshots

- **FR-022**: A style guide MUST define the trainer voice: user directions in the second person, one
  task per section headed by the task, short numbered imperative steps naming the exact control or chord,
  a "why you'd use this" line, tips and callouts. Platform differences are given inline in the step they
  change, not on separate pages. A task that changed in a release names that version.
  *Its voice is refined by FR-030 (Session 2026-11-25, iteration 1): the maintainer's voice, with a
  breadcrumb on every task.* *(Its "why you'd use this" line is superseded by FR-059.)*
- **FR-022a**: Where the index of the app found the existing docs contradicting the code, the docs MUST
  be corrected in stage 1: [page-plan.md](page-plan.md) § *Docs that contradict the code* lists them.
- **FR-023**: Screenshots MUST be generated from the E2E harness, so a UI change refreshes them by
  re-running the generator rather than by hand. Each screenshot is taken in a named bundled theme.

#### Delivery

- **FR-024**: The work MUST be delivered in stages, one pull request each:
  1. **Stage 1, infrastructure**: the site build (FR-001, FR-002, FR-002b, FR-002c, FR-003, FR-005), the Help item and help
     URLs (FR-009 to FR-011), the anchors and (?) links (FR-007, FR-014, FR-015), the checks (FR-013,
     FR-015, FR-018, FR-019), the skill, style guide and template (FR-020 to FR-022), the docs
     corrections (FR-022a), the site's look (FR-002a), and the start page plus Quick start, which retires
     `docs/quick-start.md` (FR-003a).
  2. **Stage 2, descriptions**: every setting's description cut to one line, with its detail moved into
     `docs/preferences.md` (FR-013, FR-016), and the (?) audit (FR-017).
  3. **Stages 3 onward, content**: the remaining pages (FR-004), one pull request per one to three
     pages, each with its screenshots (FR-023).
  The issues close when the last stage merges.
  *Superseded by FR-025 (Session 2026-11-25, iteration 1) — every stage completes in this one pull
  request.*
- **FR-025**: Every stage of FR-024 MUST be delivered on this branch, in one pull request: stage 1, the
  descriptions and the (?) audit (FR-013, FR-016, FR-017), and every page's content with its screenshots
  (FR-004, FR-023, FR-031). #477 and #693 close when it merges.

#### Iteration 1 (Session 2026-11-25)

- **FR-026**: Each `##` section of `docs/preferences.md` and `docs/key-bindings.md` MUST be built into a
  page of its own under its reference, with the reference's own URL listing those pages. The guide's
  navigation MUST show each reference as an expandable item listing its section pages, expanded on the
  reference's pages. A setting's (?) URL MUST name the section page that holds it, derived from the
  setting's group, so FR-007's key anchor still lands; the same holds for a key binding's group.
- **FR-027**: A setting's (?) MUST sit beside the setting's title in Preferences, not after its
  description. FR-014 is otherwise unchanged.
- **FR-028**: FR-013 to FR-016 MUST apply to key bindings and to theme tokens too: each command's and
  each theme token's description is at most 100 characters (with the same ratchet for those longer
  today), each has its own section or anchor in a reference page on the site keyed by its id, a (?)
  beside its title on the Key Bindings and Themes tabs opens it, and a check fails when one is missing
  or lands nowhere.
- **FR-029**: Every page of throng-ide.com MUST draw the same header, with its navigation links in the
  same place, aligned right. On guide and reference pages the search field MUST sit in the header to the
  left of the navigation links. Typed text MUST be readable against the field in the site's colours. The
  results MUST open in a panel below the header, as wide as the page's content, scrolling on its own,
  while the page behind it scrolls normally.
- **FR-030**: Every guide page MUST be written for users, in the maintainer's voice, in British English,
  with one layout across the guide (refining FR-022): a short introduction, then one `##` task per section,
  each opening with a breadcrumb line saying how to get there (for example **Where:** cog menu › Settings
  › Editor), a "why you'd use this" line, numbered steps, and notes, tips and warnings drawn as callouts.
  `throng-guide`'s style guide defines the voice and the layout. *(The **Where:** prefix and the "why you'd use
  this" line are superseded by FR-059.)*
- **FR-031**: Pages MUST show throng in screenshots, taken from a set-up throng instance (projects, tabs,
  terminals and files already in place) by the generator FR-023 names: at least one on every page that
  teaches part of the UI, at the task it illustrates.
- **FR-032**: A repo-local skill MUST own keeping the guide current: whenever a change adds, changes or
  removes a user-visible feature, setting, key binding, command, panel type, preview type or theme token,
  it has the change update, add or remove the guide task, its guide-map entry, its reference section and
  its screenshots in the same pull request, by the rules the checks enforce. It points at `throng-guide`
  for voice and page shape rather than restating them, and `CLAUDE.md` routes to it.
- **FR-033**: No guide page MAY ship as an outline. A check MUST fail when any page in `guide/` is marked
  `status: outline`, naming the page.
- **FR-034** *(analyze, iteration 1)*: The theme settings reference `docs/theme-settings.md` is a third
  reference alongside the preferences and key bindings references wherever FR-002, FR-002c, FR-006,
  FR-007 and FR-026 name those two. FR-028's ratchet clause is moot: every description is cut in this
  pull request, so no ratchet remains. FR-030's task layout exempts `index` and `faq`, which teach no
  task; FR-018's PR check covers theme tokens through FR-032's rule and T071.

#### Iteration 2 (Session 2026-11-25)

- **FR-035**: The guide's search field MUST draw its clear control as a small icon button inside the field,
  in the site's colours, with an accessible name, not Pagefind's default text button.
- **FR-036**: Every screenshot on a guide page MUST open, on click, in the home page's enlarge modal, which
  closes with its ✕, a click on the scrim, or Esc. Without script, the click opens the image itself.
- **FR-037**: Every guide screenshot MUST be landscape (wider than it is tall) and MUST be drawn at the full
  width of the page's column. A shot of one panel or pane MUST be taken with it filling the window (Focus
  Mode, or a window sized to it), never as a narrow element crop. A check MUST fail on a portrait
  screenshot, naming it.
- **FR-038**: The guide's start page MUST be titled **Intro**, in the navigation and the page title.
  It supersedes the title "Start here".
- **FR-039**: On guide pages wide enough to show the navigation beside the page, the navigation MUST stay
  fixed below the header and scroll on its own, and the page MUST scroll independently of it, so scrolling
  to the end of a page never moves the navigation.
- **FR-040**: `docs/releasing.md` MUST say how the version reaches each page: the release tag the
  deployment builds from, through `site.mjs assemble --version`, into every `data-site-version` slot and
  the guide's version line.

#### Iteration 3 (Session 2026-11-25)

- **FR-041**: Every guide page MUST carry: a meta description taken from its opening paragraph (at most 160
  characters, cut at a word); its canonical URL; Open Graph and Twitter card tags (title, description, URL,
  the site's social card image); the home page's theme colour, touch icon and manifest; and a JSON-LD
  `BreadcrumbList` from the home page through the guide (and its reference, for a reference section) to it.
- **FR-042**: The build MUST write `sitemap.xml` listing the home page, the sitemap page and every guide and
  reference page, by canonical URL, and MUST build a sitemap page at `/sitemap/` listing the same pages by
  title, references with their section pages beneath them. The sitemap page is linked from every page's
  footer and left out of the search index. `robots.txt` names `sitemap.xml`.
- **FR-043**: `llms.txt` MUST link the guide's three references and the sitemap page on the site.
- **FR-044**: The guide's Markdown and screenshots MUST live in `site/guide/`. The site build renders them and
  MUST NOT serve the Markdown itself. Every earlier mention of `guide/` as a source folder means `site/guide/`.

#### Iteration 4 (Session 2026-11-26)

- **FR-045**: The guide's root (FR-009's one base URL) MUST be chosen by build type, in one place in the
  app's source: a packaged build uses `https://throng-ide.com/guide/`, a development (unpackaged) build
  uses the local site preview, `http://127.0.0.1:8080/guide/`. It MUST NOT appear in Preferences.
  `THRONG_HELP_BASE_URL`, when set to an http(s) URL, overrides it in either build. It supersedes the
  edge case that a development build opens the published site.

#### Iteration 5 (Session 2026-11-26)

- **FR-046**: The Resource Monitor's help controls MUST be (?) help links like every other (FR-014): the same
  icon and size, opening a guide task in the OS browser. The general "?" at the end of the first toolbar row
  (055 FR-121) opens *Find your way around the Resource Monitor*; the helpers beside Order by, Hide idle,
  Hide ended and Capture every open *Choose what the list shows*; Held folders opens *See which folders
  throng is holding*; the Total row and the "-" / "~" marks open *Read the figures*. The words the popovers
  held move into those tasks. It supersedes 055 FR-093 and FR-119's help panel and popover helpers; the
  "?" keeps its place (055 FR-121).
- **FR-047**: A guide page MUST NOT carry a version line of its own: the version label in the header (and the
  footer), lifted from the home page, is how every page names the release it describes. It supersedes the
  "guide's version line" of FR-002b's design and FR-040.

#### Iteration 6 (Session 2026-11-26)

- **FR-048**: Help MUST open in a throng **Help window**. There is at most one: F1, the cog menu's Help item
  and every (?) load their page into it, opening it if it is closed and bringing it to the front if it is
  not. It MUST NOT be kept on top of other windows. It remembers its size and position like throng's other
  windows. It supersedes "in the OS browser" in FR-010, FR-014 and FR-046; their targets are unchanged.
- **FR-049**: The Help window MUST render the guide that ships with the build: `site/guide/` and the three
  references, built by the site's own builder (`scripts/guide-build.mjs`) when throng is built, indexed for
  search by Pagefind, and packaged with the app. It MUST NOT load the website or need the network. A
  development build renders its own build of the guide the same way. FR-009's one base URL becomes the
  shipped guide's root for Help; it supersedes FR-045 for Help, and `THRONG_HELP_BASE_URL` is retired. The
  website (FR-001 to FR-005, FR-041 to FR-044) is unchanged.
- **FR-050**: The Help window MUST show only the shipped guide: it is served read-only from the bundled folder,
  with no preload and no Node access, under a content security policy that allows nothing remote. A link to
  anything outside the shipped guide opens in the OS browser through throng's existing external-link route;
  a page that tries to open a window gets the same treatment. Its own navigation is confined to the shipped
  guide (044's navigation guard holds for every other window).
- **FR-051**: The Help window MUST offer **Back** and **Forward** (buttons, Alt+Left / Alt+Right and the
  mouse's back and forward buttons) and an **Open in browser** button that opens the page it shows on
  throng-ide.com. They are themeable icon controls, like every other throng control.
- **FR-052**: When the shipped guide is missing (a copy built without it), the Help window MUST say so and how
  to build it, never show a blank page; the failure is logged once.
- **FR-053**: Whenever a guide page opens, in the Help window or on throng-ide.com, the navigation MUST be
  scrolled so the open page's entry is in view (refines FR-039, which keeps the navigation scrolling on its own).
- **FR-054**: The Help window MUST close when throng's main window closes: the main window is the master of every
  window throng opens. It remains never on top and never modal (refines FR-048).
- **FR-055**: Every (?) MUST be drawn smaller than a standard icon control and still legible: its glyph below the
  standard icon size, in a control sized to match, the same in every window and independent of the icon-size
  setting (refines FR-014's control).
- **FR-056**: The Projects pane header MUST NOT carry a (?). This supersedes FR-017's outcome for "the project
  list"; FR-017's other surfaces keep their (?).
- **FR-057**: Every in-app description (settings, key bindings, theme settings), every guide page and the three
  references MUST be written without AI writing patterns, by the `stop-slop` skill's rules, in the voice FR-030
  names. `throng-guide`'s style guide points at `stop-slop` for them rather than restating them.
- **FR-058**: A check MUST fail the build when a guide page, a reference or an in-app description contains
  "says so", "you can never", "no one noticed" or "silently fail(s)", naming the file and the phrase.
- **FR-059**: Every `##` section of a guide page, and every setting, key binding and theme setting section of a
  reference, MUST be laid out as: its heading; a bold breadcrumb of the user's actions that reach it (for
  example **Cog › Settings › Editor › Links**); the long description, which in a guide task is a short prose
  lead followed by numbered steps; a screenshot where one applies; callouts where they help. A horizontal
  rule MUST separate each section from the next. This supersedes FR-022's "a 'why you'd use this' line" and
  FR-030's **Where:** prefix and "why you'd use this" line; a reference section still opens its description
  with the in-app one-line description (FR-016), and keeps its key and default.
- **FR-060**: Every guide screenshot MUST load lazily, as the home page's do: `loading="lazy"` with the image's
  width and height.
- **FR-061**: Find in Files' (?) MUST open *Search the whole project* (settles FR-017's "the right guide section"
  for Find in Files; replaces *Narrow a search*).
- **FR-062**: In the Help window, while the pointer rests on a link, a small popover MUST show at the window's
  bottom left with the link's address and whether it is in the guide or external. There is at most one; it
  fades in when a link is hovered and fades out when the pointer leaves the link.
- **FR-063**: Before throng hands any external link to the OS (a browser or another app), from any window or
  route (the Help window and its **Open in browser**, terminals, editors, previews, About, the window-open
  guard), it MUST show a themed modal naming the link with **Open** and **Cancel**, and a button that opens
  Preferences at the setting controlling it. **Cancel** opens nothing. The setting, in Preferences'
  Confirmations group, is on by default; off, external links open with no prompt. Refines FR-011 and FR-050:
  their route and policy are unchanged, the prompt comes first. *Derived (analyze, iteration 8): one prompt at a
  time — a link activated while one is open is dropped and the open prompt comes forward; **Cancel** has the
  focus and **Esc** cancels; closing the prompt cancels; it sits over the window the link was activated in,
  else the main window, and closes with it; opening a file (`openPath`, reveal) is not an external link and is
  not asked about; the Preferences button opens Preferences at the Confirmations group.* *(That last clause is
  superseded by FR-064: the button reveals the setting itself.)*
- **FR-064**: Preferences MUST offer one standard reveal: opened at a target (a setting key, a key binding's
  action id, a theme setting key, or a group name) on its tab, it unfolds the target's group, subgroup and
  subsection and scrolls its row into view, in a new window or one already open. Every place throng sends the
  user to a setting, key binding or theme setting uses it, the external-link prompt's Change in Preferences
  included. Extends 068's Settings deep link to the Key Bindings and Themes tabs.
- **FR-065**: The Help window's website MUST follow the build: `https://throng-ide.com/` in a packaged build,
  `http://localhost:8080/` (the `site:preview` server) in a development build. The links it sends to the browser,
  Open in browser (FR-051) and the link popover (FR-062) all use it, and the popover calls every website link
  external.
- **FR-066**: The sitemap page MUST be the website's only: the Help window's bundle leaves out the sitemap page and
  `sitemap.xml`, a link to the sitemap from the Help window opens the website (superseding FR-050's handling of
  the sitemap as a shipped page), and the sitemap page shows no guide page list.
- **FR-067**: Every guide screenshot MUST name the screen it shows, as the source files and folders it is drawn
  from (`site/guide/images/screens.json`), and a check MUST list each screenshot whose screen changed since a given
  release while the image did not. A release runs it against the previous tag and does not tag while it lists any
  (`throng-release`, step 6). An image with no screen, or a screen naming source that does not exist, fails the
  build.
- **FR-068**: Every guide page but the start page MUST show, above its heading, a breadcrumb of where it sits:
  **Guide**, then its reference for a reference section, then the page itself (not a link). Search leaves the
  breadcrumb out of the page's text.
- **FR-069**: The external-link prompt (FR-063) MUST take and hold focus: while it is open no other throng window
  takes a click, key or scroll, any of them that is focused hands focus back to the prompt, and the prompt stays
  above them. Every window takes input again once it is answered or closed. *(Superseded by FR-070: the prompt
  blocks only the window it is shown in.)*
- **FR-070**: The external-link prompt (FR-063) MUST be an inline dialog in the window the link was followed in
  (the focused throng window, else the main window), drawn with the common confirm dialog: the whole address,
  **Change in Preferences**, **Cancel** (focused) and **Open**, Esc as Cancel. It covers and blocks that window
  only, and keeps the keyboard there until answered; other throng windows stay usable. In the Help window it
  covers the guide page too. The window closing or its page going away is Cancel. This supersedes FR-063's prompt
  window and FR-069.

### Key Entities

- **Guide page**: one Markdown page teaching one area of work. It has a title, task-led sections with
  stable anchors, steps, tips, and links to the reference pages.
- **Guide map**: the committed index of tasks. Each entry has a task (in the user's words), its page and
  anchor, and the command ids, panel types, preview types and setting keys it uses. Exclusions carry a
  reason. It is the coverage source for the PR and release checks, and the source of the help URLs.
- **Reference page**: `docs/preferences.md` and `docs/key-bindings.md`, published on the site. They list
  facts, one section per setting or binding group, with anchors keyed by the setting key or group.
- **(?) link**: a control on a setting row or another audited surface, naming a page and an anchor on
  the site.
- **No-user-facing-change marker**: a line in a pull request that tells the guide check the change needs
  no guide or reference update.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Cog menu → **Help**, and F1 from any throng window outside a terminal, open the guide's
  start page in the browser in one action.
- **SC-002**: 100% of settings show a description of at most 100 characters and a (?) that lands on that setting's own
  section.
- **SC-003**: When the last stage merges, every task in [page-plan.md](page-plan.md) has its section,
  and every command, panel type and preview type is covered by a task or excluded with a reason in the
  guide map.
- **SC-004**: A pull request that adds a setting, binding, command, panel type or preview type with no
  guide change and no marker fails CI, every time.
- **SC-005**: Every link and anchor in the guide and in the app's (?) controls resolves against the
  built site. The checks find 0 broken targets.
- **SC-006**: After any deployment, every page on throng-ide.com shows the same version, and it is the
  latest published release.

## Assumptions

- The site generator is chosen in the plan. It must emit plain static files that GitHub Pages serves
  with no server-side code, keep the hand-written `site/index.html` and the repository paths working,
  and work with a static search index such as Pagefind (FR-002c).
- The guide describes the latest release, because the site is built from that release's tag (FR-002b).
  A guide fix between releases goes live with the next release. Versioned copies of the guide per
  release are out of scope; git history holds them.
- `docs/key-bindings.md` keeps its current anchors per group. Per-binding (?) links are not required by
  #477 and are out of scope.
  *Superseded by FR-028 (Session 2026-11-25, iteration 1): every binding has its own section and (?).*
- The rest of `docs/` (installation, architecture, testing, releasing) stays a repository reference and
  is not published as part of the guide. The guide's Quick start page links to the install guides.
- Out of scope: help that works offline or ships with the app, analytics or any visitor tracking,
  localisation, video (#445, which the guide may embed once it exists), and hosting anywhere but GitHub
  Pages.
