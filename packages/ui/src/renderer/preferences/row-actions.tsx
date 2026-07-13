import { type CSSProperties, type ReactElement } from 'react';
import { IconButton } from '../common/icon-button.js';
import { ROW_ACTION_TOKENS, type RowActionName } from './row-action-tokens.js';

/**
 * The per-item affordances (015, FR-015 / FR-015a / FR-016).
 *
 * Three actions sit on every row, and they are three different questions:
 *
 *   - **reset**  (`retry`)   — "what does Throng ship?"                 applies while overridden
 *   - **revert** (`revert`)  — "what did I open this window with?"      applies while changed
 *   - **clear**  (`destroy`) — "nothing, thanks"                        applies while clearable
 *
 * Reset and revert are NOT the same control wearing two hats. A user who arrives with an item
 * already overridden and then edits it wants their override back, not the factory value — so the
 * two must stay tellable apart, which is why they carry distinct tokens and titles rather than
 * one glyph with clever wording.
 *
 * **All three render at all times.** An action that does not currently apply is **disabled and
 * greyed**, never hidden, and this is the requirement (FR-015) rather than a style: the row's
 * control MUST NOT move. Hiding an affordance means the row's geometry changes the instant the
 * user edits something — the input slides out from under the pointer at the exact moment they
 * touched it. Showing all three also makes them *discoverable*: you learn a revert exists before
 * you need it, not after you have already changed something and gone looking for a way back.
 *
 * (An earlier attempt reserved an empty gutter to hold the geometry still. That worked, but it
 * bought stillness with dead space on every row and taught the user nothing.)
 *
 * A surface may still decline an action per row. On the Themes tab (issue #76) all three apply —
 * theme tokens now get reset and revert like Settings and Key Bindings — EXCEPT **Reset on a
 * custom theme**, which has no shipped value to return to and so is declined there. (This
 * superseded 015 FR-013's original scoping, which withheld per-token reset entirely: a per-token
 * reset is a *different write scope* from 014's whole-theme restore and takes the editor's own
 * token-write path, so it does not reintroduce the duplicate-write hazard FR-013 guarded against.)
 * Declining is not the same as disabling: a declined action is absent because it will *never*
 * apply here, a disabled one is present because it does not apply *yet*.
 */
export interface RowActionsProps {
  /** Which registry the row belongs to — it prefixes every test id on the row. */
  kind: 'setting' | 'binding' | 'theme';
  /** The row's dotted setting path, its ActionId, or its theme token. */
  itemKey: string;
  /** The row's human label, so each hover title names its own scope. */
  label: string;
  overridden?: boolean;
  changed?: boolean;
  /** Empty is a valid value here AND the value is not already empty. */
  clearable?: boolean;
  /** Omit a handler to DECLINE the action on this surface (it is never rendered at all). */
  onReset?: () => void;
  onRevert?: () => void;
  onClear?: () => void;
}

export function RowActions({
  kind,
  itemKey,
  label,
  overridden = false,
  changed = false,
  clearable = false,
  onReset,
  onRevert,
  onClear,
}: RowActionsProps): ReactElement {
  // `<kind>-<action>-<key>`, e.g. `setting-reset-editor.autoSave`. The action comes before the
  // key so the identifier names the control, not just the row it sits on (FR-012b).
  const testId = (action: string): string => `${kind}-${action}-${itemKey}`;

  /**
   * The gutter is sized to the actions this SURFACE offers, not to the three that exist.
   *
   * The distinction that matters is declining vs disabling. A disabled action still occupies its
   * slot, because it may light up on the next keystroke and the row must not move when it does.
   * A DECLINED action never will — e.g. Reset on a *custom* theme row (issue #76), which has no
   * shipped value to return to — so holding a slot open for it would reserve space for something
   * that can never arrive. Sizing the gutter to the actions the surface actually offers keeps a
   * custom-theme row (revert + clear) from carrying a dead reset slot.
   */
  const slots = [onRevert, onReset, onClear].filter(Boolean).length;

  /**
   * A disabled affordance explains ITSELF (FR-015a). It is on screen precisely so the user can
   * see that the action exists, so a bare greyed glyph with no explanation would be the worst of
   * both worlds — visible, but mute about why it will not respond.
   */
  const action = (
    name: RowActionName,
    enabled: boolean,
    activeTitle: string,
    idleTitle: string,
    onClick: (() => void) | undefined,
  ): ReactElement | null =>
    onClick ? (
      <IconButton
        token={ROW_ACTION_TOKENS[name]}
        className={enabled ? 'settings-row__action' : 'settings-row__action settings-row__action--idle'}
        testId={testId(name)}
        title={enabled ? activeTitle : idleTitle}
        disabled={!enabled}
        onClick={onClick}
      />
    ) : null;

  return (
    <div
      className="settings-row__actions"
      data-testid={testId('actions')}
      style={{ '--row-action-slots': slots } as CSSProperties}
    >
      {action(
        'revert',
        changed,
        `Revert ${label} to the value it had when this window was opened`,
        `${label} has not changed since this window was opened`,
        onRevert,
      )}
      {action(
        'reset',
        overridden,
        `Reset ${label} to its default value`,
        `${label} is already at its default value`,
        onReset,
      )}
      {action(
        'clear',
        clearable,
        `Clear ${label}`,
        `${label} is already empty, or cannot be emptied`,
        onClear,
      )}
    </div>
  );
}
