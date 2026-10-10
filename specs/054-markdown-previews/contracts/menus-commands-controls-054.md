# Contract: menus, commands and controls (054)

## Outlining submenu (FR-010 – FR-014)

Built once by `outliningSubmenu(args)`; used by both `previewContentMenu` and `editorContentMenu`.

```text
Outlining ▸                                  section: viewState   (absent for non-Markdown)
  Collapse This Hn  | Expand This Hn         absent before the first heading
  Collapse All Inside This Hn                absent before the first heading
  Expand All Inside This Hn                  absent before the first heading
  Collapse All                               disabled with no headings
  Expand All                                 disabled with no headings
```

Rows show their bindings (`firstBinding`). No fold row at the menu's top level.

## Commands

| Id | Label (key-bindings editor) | Default |
|---|---|---|
| `markdown.collapseAllInside` | Collapse All Inside This Section | unbound |
| `markdown.expandAllInside` | Expand All Inside This Section | unbound |
| `panel.toggleMaximise` | Maximise / Restore Panel | `Alt+Shift+Enter` |

## Panel header and title menu (FR-071)

- Header: `IconButton` before "+" — `panelMaximise` ("Maximise panel") / `panelRestore` ("Restore panel").
- Title menu, `viewState` section: "Maximise Panel" / "Restore Panel", shortcut shown.
- While a tab is maximised: header "+" disabled with title "Restore the panel to add panels"; Split
  submenu rows disabled; drop zones not shown; the maximised target shows a Restore control.

## Diagram frame toolbar (FR-046b – FR-046h)

Top-left of each diagram box, outside the transformed layer, in order:

| Control | Token | Title |
|---|---|---|
| Fit | `diagramFit` | Fit diagram |
| Full Size | `diagramFullSize` | Fill the panel |
| Zoom In | `zoomIn` | Zoom in |
| Zoom Out | `zoomOut` | Zoom out |
| Full Pane | `diagramFullPane` / `panelRestore` | Fill the middle section / Restore |

Middle-button drag pans. Keyboard: each control is a focusable button; Esc restores Full Pane per the
maximise rules.

## Esc (FR-071, FR-074)

Restores one maximise level unless focus is inside `.xterm` or `.cm-editor`, a find bar is open, a
transient overlay is open, or a context menu is open.

## Preferences layout (FR-050 – FR-052)

```text
Editor
  Previews                       (subgroup)
    Preview update delay, Preview maximum wait, Synchronise preview and editor scrolling, Preview copy format
    Markdown                     (subsection)
      Markdown: Enabled, Markdown: Default open action, Markdown: Open previews in,
      Markdown: Render Mermaid diagrams, Markdown: Load remote images, Markdown: Show front matter,
      Markdown: Preview gutter, Markdown: Heading jump scroll duration (ms), Markdown sections open
    Mermaid                      (subsection)
      Mermaid: Enabled, Mermaid: Default open action, Mermaid: Open previews in
```

Test ids: `settings-subsection-<group>-<subgroup>-<subsection>`.
