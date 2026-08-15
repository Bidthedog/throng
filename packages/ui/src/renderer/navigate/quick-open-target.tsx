/**
 * Quick Open's target control — where the chosen file lands (033, FR-010/FR-010a/FR-010b, FR-068).
 *
 * Rendered into the picker's `header` slot, and **only when the modal was invoked from inside an
 * editor panel** (T3, FR-011). "Put it in the editor I am in" has no meaning when the chord came
 * from a terminal or the file tree, and a control offering a choice that cannot apply is worse than
 * no control: it invites the user to make a decision the application will then ignore.
 *
 * ══ TWO OPTIONS, ONE BUTTON — AND THE WORDS ARE INSIDE IT (FR-068) ══
 *
 * *(This paragraph replaces the shipped one, which is kept below it and marked, per this spec's
 * house rule that a superseded argument stays readable rather than being deleted.)*
 *
 * The button carries **both an icon and the sentence that explains it**, and the whole of it is one
 * click target — the icon, the words, and the padding between them. `data-testid` is on the button;
 * `quickopen-target-label` names the sentence so a test can click the WORDS, which is the part a
 * user reaches for and the part an icon-plus-adjacent-label shape would get wrong.
 *
 * **Why a text label here does not breach the themeable-icon-control rule.** That rule is
 * NON-NEGOTIABLE, and it is stated as: every interactive control that performs an action is a
 * themeable icon with a hover title, never a text label — with an exception for **dialog decision
 * buttons**, on the ground that *their label is the statement of the consequence being consented
 * to; replacing it with an icon would remove the very information the dialog exists to convey*.
 *
 * That rationale reaches this control **exactly**, which is why plan.md D5 applies the exception on
 * the rationale rather than on the literal Confirm/Cancel list. "Will open in a new editor" IS the
 * consequence, and the user consents to it by pressing Enter on a row a moment later — so an icon
 * in its place removes precisely the information this dialog exists to convey. FR-068 exists
 * because that is what happened: the shipped control stated its current value in a glyph and its
 * alternative in a hover title, so it stated the choice to nobody and stated the value only to
 * someone who hovered. The rest of the rule still binds and is still honoured: the icon is a theme
 * token drawn through `<Icon>`, every colour comes from a theme token, and the hover title still
 * names what pressing it does.
 *
 * **The exclusion toggle beside it stays a bare icon**, so the two header controls look asymmetric.
 * That is deliberate and recorded (plan.md D5, Complexity Tracking): no requirement asks for text on
 * it, and widening a non-negotiable rule's exception to a control that does not need it would be the
 * wrong direction.
 *
 * ══ SUPERSEDED — the argument for the icon-only shape (FR-010, T1–T6) ══
 *
 * > It is a toggle rather than a pair of radio buttons, and that is a constitutional consequence
 * > rather than a taste: every interactive control that performs an action is a themeable ICON with
 * > a hover title naming it, never a text label, and the exception for dialog decision buttons does
 * > not reach here — this control does not consent to anything, it selects a destination. So the
 * > icon shows the destination currently chosen and the title says what it is and what pressing it
 * > does.
 *
 * The first half survives: it is still one toggle rather than two radios. The second half is what
 * FR-068 overturns — the reading was that the exception is a closed list of button *kinds*, where
 * it is in fact a *rationale*, and hand-testing showed the cost of the narrow reading is a control
 * that never states the choice it exists to offer.
 *
 * ══ WHICH NAME THE PANEL IS GIVEN ══
 *
 * `panelDisplayTitle` from `@throng/core` — the ONE rule that decides a panel's name (#218), so the
 * sentence cannot disagree with the panel header or the tab popover that read it too. The name is
 * taken UNBOUNDED, exactly as the tab popover takes it (031, FR-050b): `tabs.maxNameLength` bounds a
 * name that has to fit a chip, and this one sits in prose, where an unexplained cut is worse than a
 * long word. A name too long for the card ellipsises in CSS instead.
 *
 * `data-value` carries `editor.openTarget`'s OWN vocabulary — `lastActive` / `new` — rather than a
 * second spelling of the same idea. The preselection is then a comparison against the setting
 * instead of a translation of it, and a translation layer between a setting and the control it
 * preselects is exactly where the two drift apart unnoticed.
 */
import { useState, type ReactElement } from 'react';
import { collectPanels, panelDisplayTitle, type EditorOpenTarget } from '@throng/core';
import { Icon } from '../common/icon.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useEditorState } from '../editor/editor-state.js';

/** What each option means, in the one place the icon, the sentence and the title come from. */
const OPTIONS: Record<EditorOpenTarget, { icon: string; name: string; other: string }> = {
  lastActive: {
    icon: 'editorPanel',
    name: 'the currently active editor',
    other: 'a new editor panel in this tab',
  },
  new: {
    icon: 'add',
    name: 'a new editor panel in this tab',
    other: 'the currently active editor',
  },
};

export function QuickOpenTarget({
  initial,
  panelId,
  onChange,
}: {
  /** T2 — preselected from `editor.openTarget`. The setting is not written back; this is a choice
   *  for this invocation, not a change of preference. */
  initial: EditorOpenTarget;
  /** The editor panel the chord came from — FR-011 guarantees there is one, and FR-068 names it. */
  panelId: string;
  onChange: (next: EditorOpenTarget) => void;
}): ReactElement {
  /*
   * The control owns its value, and the modal reads it through `onChange`.
   *
   * The other way round — the modal holding it in state and passing it down — would re-render the
   * whole result list (up to two hundred rows) on every toggle of a control that does not affect a
   * single row. Nothing else on screen depends on this value until a row is chosen.
   */
  const [value, setValue] = useState<EditorOpenTarget>(initial);
  const option = OPTIONS[value];

  /*
   * The destination panel's name, resolved the way every other surface resolves it.
   *
   * The live editor state carries the path once CodeMirror has mounted, and the panel's own config
   * carries it before that — the same two sources, in the same order, that the panel header reads
   * (`panel-placeholder.tsx`). Reading only the live state would leave a freshly opened editor
   * momentarily nameless in the sentence while its header already showed the file.
   */
  const ws = useWorkspace();
  const editor = useEditorState(panelId);
  const panel = ws.layout?.tabs
    .flatMap((tab) => collectPanels(tab.root))
    .find((p) => p.id === panelId);
  const filePath =
    editor?.filePath ?? (typeof panel?.config?.filePath === 'string' ? panel.config.filePath : null);
  /*
   * `panelDisplayTitle` never returns an empty string — every branch of it ends at `panel.title`,
   * which the layout guarantees — so a panel holding no file still has a name ("Panel 3"), and there
   * is no "unnamed editor" case to word. The only way to have no name at all is to have no panel:
   * the layout changed under an open modal and the panel the chord came from is gone. Then the
   * sentence drops the parenthesis rather than inventing a name for a panel that no longer exists,
   * and FR-011's own condition has stopped holding anyway.
   */
  const panelName = panel ? panelDisplayTitle(panel, { editorFilePath: filePath }) : null;
  const destination =
    value === 'new'
      ? 'Will open in a new editor'
      : panelName === null
        ? 'Will open in the active editor'
        : `Will open in the active editor (${panelName})`;

  /*
   * Not `IconButton`, and not by preference: that component takes no children, and its one text-ish
   * slot (`badge`) is documented as "an optional COUNT … never a label". The markup below is the
   * context-menu item's vocabulary instead — the renderer's only established icon-plus-text shape —
   * an `aria-hidden` icon span (which `<Icon>` produces) beside a label span, inside one `<button>`.
   *
   * No `aria-label`: the visible sentence IS the accessible name, and an `aria-label` would override
   * it with a second wording of the same thing. `title` stays, because the constitution asks for a
   * hover title naming the action and because it is the one place the ALTERNATIVE is spelled out.
   *
   * No `.picker__header` wrapper of its own (033 FR-069): the header row holds two controls and
   * `quick-open.tsx` owns the row. The base class is `picker__header-button`, shared with the
   * exclusion toggle — and it is defined in `theme.css`, not `preferences.css`, which only the
   * preferences window loads.
   */
  return (
    <button
      type="button"
      className="picker__header-button picker__header-target"
      data-testid="quickopen-target"
      data-value={value}
      title={`Open in ${option.name} — press to use ${option.other} instead`}
      /*
       * T4 — **Space or Enter changes its value, and opens nothing.**
       *
       * Both come free from `onClick` on a real `<button>`: the browser synthesises the click for
       * either key. The half that had to be built is in `picker.tsx` (E1), which until 033 claimed
       * `Enter` wherever in the dialog it originated — so Enter here would have opened the
       * highlighted file instead of operating the control the user was standing on.
       */
      onClick={() => {
        const next: EditorOpenTarget = value === 'lastActive' ? 'new' : 'lastActive';
        setValue(next);
        onChange(next);
      }}
    >
      <Icon token={option.icon} />
      <span className="picker__header-target-label" data-testid="quickopen-target-label">
        {destination}
      </span>
    </button>
  );
}
