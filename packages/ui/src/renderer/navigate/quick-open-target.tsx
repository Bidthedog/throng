/**
 * Quick Open's target control — where the chosen file lands (033, FR-010/FR-010a/FR-010b, T1–T6).
 *
 * Rendered into the picker's `header` slot, and **only when the modal was invoked from inside an
 * editor panel** (T3, FR-011). "Put it in the editor I am in" has no meaning when the chord came
 * from a terminal or the file tree, and a control offering a choice that cannot apply is worse than
 * no control: it invites the user to make a decision the application will then ignore.
 *
 * ══ TWO OPTIONS, ONE BUTTON ══
 *
 * It is a toggle rather than a pair of radio buttons, and that is a constitutional consequence
 * rather than a taste: every interactive control that performs an action is a themeable ICON with a
 * hover title naming it, never a text label, and the exception for dialog decision buttons does not
 * reach here — this control does not consent to anything, it selects a destination. So the icon
 * shows the destination currently chosen and the title says what it is and what pressing it does.
 *
 * `data-value` carries `editor.openTarget`'s OWN vocabulary — `lastActive` / `new` — rather than a
 * second spelling of the same idea. The preselection is then a comparison against the setting
 * instead of a translation of it, and a translation layer between a setting and the control it
 * preselects is exactly where the two drift apart unnoticed.
 */
import { useState, type ReactElement } from 'react';
import type { EditorOpenTarget } from '@throng/core';
import { IconButton } from '../common/icon-button.js';

/** What each option means, in the one place both the icon and the sentence come from. */
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
  onChange,
}: {
  /** T2 — preselected from `editor.openTarget`. The setting is not written back; this is a choice
   *  for this invocation, not a change of preference. */
  initial: EditorOpenTarget;
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
   * No `.picker__header` wrapper of its own any more (033 FR-069).
   *
   * The header row now holds TWO controls — this and the exclusion toggle — and FR-069 requires them
   * to be siblings in it. A control that brought its own row would put them in two rows, and the
   * toggle would additionally vanish whenever FR-011 declined to draw this one. `quick-open.tsx`
   * owns the row; each control is just a control.
   *
   * The class is `picker__header-button` rather than `icon-button`, and that is a fix rather than a
   * rename: `.icon-button` is defined in `preferences.css`, which ONLY the preferences window loads,
   * so this button rendered in the main window with no styling beyond the user-agent default.
   */
  return (
      <IconButton
        token={option.icon}
        className="picker__header-button"
        testId="quickopen-target"
        title={`Open in ${option.name} — press to use ${option.other} instead`}
        dataAttrs={{ 'data-value': value }}
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
      />
  );
}
