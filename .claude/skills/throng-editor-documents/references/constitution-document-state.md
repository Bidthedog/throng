# One document, one state — constitution detail

Binding: constitution Principle XI (`.specify/memory/constitution.md`, *XI. Dockable Workspace: Panes, Tabs & Panels › One document, one state*). The
constitution keeps a one-line MUST for each rule below and points here for its detail, which was
moved verbatim from v7.4.0 at v7.4.1. This file is part of the constitution: change it only through
a constitution amendment (`throng-spec-governance`), and keep the constitution's one-line MUST in
step with it. "Above" and "below" in the text refer to this file, or to the constitution where the
rule named is not here.

## One document, one state

- **One document, one state.** A **Panel** is a *view*; the artefact it presents is a
  **document**. Where the same underlying artefact — the same file — is presented by more
  than one Panel (in the same Tab, in different Tabs, or in different windows), it MUST be
  **one document in every respect**. Every Panel showing it MUST share, as a **single
  value**: the content buffer and its dirty/unsaved state, the undo/redo history, the
  effective language (including any manual override), and the effective indentation — along
  with any comparable **content-shaping** state a future panel type introduces. Only **view
  state** — cursor position, selection, scroll position, per-panel zoom — MAY differ per Panel.
  - **One authority, not two peers.** The test is **authority**, not mechanism. Exactly **one**
    component MUST own the document state; every other copy MUST be a **derived replica**, changed
    only by applying that authority's **ordered change stream**, never by being an independent source
    of truth. **Peer-to-peer reconciliation between co-equal copies is FORBIDDEN** — two Panels that
    each own their state and keep in step by relaying updates to each other are still **two states**,
    and they diverge at the first update that is not relayed, arrives out of order, or arrives stale.
    A change that was based on a superseded version of the document MUST be **rebased onto the
    authority's current version**, never applied at the position it originally named.
    - This is deliberately **not** a demand that one in-memory object be literally shared: views may
      live in **different processes**, where that is impossible, and a replica driven by an ordered
      stream from a single authority satisfies this rule. What fails it is *two originals*.
  - This rule binds **every** panel type that can present one artefact twice — an editor, a
    diff view, a document preview, a notebook view, a plugin-supplied Panel — not only the
    editor that first surfaced it.

  Rationale: this is a **data-integrity** rule, not an ergonomic one. Per-Panel content state
  permits a **content-corruption** path: one file, open in two Panels, with a different
  effective indentation in each, writes **both** indentation styles into the **one** buffer
  that is saved to disk. A shared undo history is the same rule seen from the other side — an
  undo stack that does not span every view of a document cannot faithfully reverse an edit made
  through another view of it.
