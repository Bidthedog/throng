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
 * A surface may still decline an action entirely, and the Themes tab does: theme tokens get
 * **clear** (a font stack may be emptied, FR-018) but not reset or revert, because feature 014
 * already restores a theme to its shipped values from the theme row itself. A per-token reset
 * would be a second control writing the same file — the duplication FR-013 exists to prevent.
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
   * A DECLINED action never will — the Themes tab has no per-token reset at all — so holding a
   * slot open for it reserves space for something that can never arrive. That is what made every
   * theme row carry two-thirds of a gutter it could never use.
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
