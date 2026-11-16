import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  DEFAULT_ICON_SET_NAME,
  ICON_KEYS,
  ICON_KEY_DESCRIPTIONS,
  logCaught,
  validateIconSetName,
  type IconKey,
  type Theme,
} from '@throng/core';
import { ColourField } from '../common/colour-picker.js';
import { IconButton } from '../common/icon-button.js';
import { ROW_ACTION_TOKENS } from './row-action-tokens.js';
import { Icon } from '../common/icon.js';
import { useConfigLoaded, useIconSets } from '../config/config-store.js';
import { useNotify } from '../common/notification.js';
import { settleConfigWrites } from '../config/write-config.js';
import { useConfirm } from '../confirm-dialog.js';
import type { IconSetsResult } from '../global.js';
import { FoldHeading } from './fold-heading.js';
import { NameDialog } from './name-dialog.js';

/**
 * Icon section of the Themes tab (007 US4, 017 / #54, reworked by 069).
 *
 * Choose the icon set the theme draws; the grid is a READ-ONLY view of the loaded icons — each key's
 * current icon, its name, its file name and its description as the hover title (FR-012, FR-027).
 * There is no editor here: icon files are edited outside throng (FR-026).
 *
 * The grid renders through the SAME <Icon> component as the rest of the app. A preview that renders
 * differently from the thing it is previewing is not a preview.
 */
const ICON_TOKENS = ICON_KEYS;

/** The title of a control only a selected user set can use, while the default set is selected (FR-049). */
const NOT_A_USER_SET = 'Select one of your own icon sets to use this';

/** Why a set the theme names is unavailable when it is not in the listing at all. */
const MISSING_REASON = 'The folder was not found in the icon sets folder.';

/** The two settings rows above the grid: the icon set and the icon colour (056 FR-006). */
const SETTING_ROWS = 2;

export interface IconSectionProps {
  theme: Theme;
  /** Select a set for the theme; `undefined` selects the default set (the theme then carries no `iconPack`). */
  onSetIconSet: (name: string | undefined) => void;
  /**
   * Set the theme's icon colour (018 / US5). `''` clears it back to unset.
   *
   * The colour lives BESIDE the set selector because that is where the user is when the icons look
   * wrong. The bundled set is monochrome line art: it reads well on dark themes and badly on light
   * ones, and the obvious remedy — ship a black set and a white set — is the wrong one. The artwork
   * already inherits its colour, so the two sets would be the same art twice, and would still be
   * wrong for every theme that suits neither pure black nor pure white.
   */
  onSetIconColour: (hex: string) => void;
  /**
   * The icon tokens surviving the Themes tab's typeahead (FR-021), and whether the icon-set row
   * itself matched. `null` means no search is active — show everything.
   *
   * The section used to sit OUTSIDE the filtered groups, so it neither narrowed nor disappeared:
   * search for "terminal" and you got the two matching colour rows plus, still, the entire icon
   * grid. A section that ignores the filter is worse than one with no filter, because it looks
   * like a result.
   */
  filter?: { tokens: readonly string[]; packRowMatches: boolean } | null;
  /** Is the section folded? The Themes tab's `usePreferenceFolds` answers (056 FR-001, FR-013). */
  folded: boolean;
  onToggleFold: () => void;
}

export function IconSection({
  theme,
  onSetIconSet,
  onSetIconColour,
  filter = null,
  folded,
  onToggleFold,
}: IconSectionProps): ReactElement | null {
  // Sets arrive on the same hot-reloaded payload as the theme that selects them, so this grid
  // needs no fetch of its own and cannot show a set that disagrees with the live theme.
  const sets = useIconSets();
  const loaded = useConfigLoaded();
  const selected = theme.iconPack ? sets.find((p) => p.name === theme.iconPack) : undefined;
  /** FR-016: the theme names a set that is not in the listing (its folder is gone). Not before the listing arrives. */
  const missing = loaded && theme.iconPack && !selected && theme.iconPack !== DEFAULT_ICON_SET_NAME ? theme.iconPack : undefined;
  const { notify } = useNotify();
  const confirm = useConfirm();
  const [copying, setCopying] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const existingNames = useMemo(() => sets.map((p) => p.name), [sets]);
  /** The set a copy starts from: the selected user set when it loaded, the default set otherwise. */
  const copyFrom = selected && !selected.error ? selected.name : DEFAULT_ICON_SET_NAME;

  /** Every failure of a main-side icon-set call is shown, with the reason main gave (Principle XIII). */
  const report = (what: string, result: IconSetsResult | undefined): boolean => {
    if (result?.ok) return true;
    notify({
      severity: 'error',
      subject: { kind: 'none' },
      message: `${what}: ${result ? result.message : 'icon sets are not available here'}`,
      testId: 'icon-set-notice-error',
    });
    return false;
  };

  const selectSet = (name: string): void => {
    if (name === DEFAULT_ICON_SET_NAME) {
      onSetIconSet(undefined);
      return;
    }
    onSetIconSet(name);
    // Selecting a set reads its files from disk (FR-029); the reload broadcast updates every window.
    // The theme write that selects it is still debounced, and the broadcast re-reads the theme from
    // disk: reloading first would adopt the OLD theme and reset the tab's optimistic copy, so a token
    // edit made next would drop the set. Let the write land, then reload.
    void settleConfigWrites()
      .then(() => window.throng?.iconSets?.reload())
      .then((r) => {
        if (!report('Could not reload the icon sets', r)) return;
        // FR-046: the hint that used to sit beside the picker, as a toast when it applies.
        notify({
          severity: 'info',
          subject: { kind: 'none' },
          message: `Icon set “${name}” selected. Edits to its files show after your next icon-set action here, or a restart.`,
          testId: 'icon-set-notice-hint',
        });
      });
  };

  /** FR-041: Reload reads every set from disk again, whichever is selected. */
  const reload = (): void => {
    void window.throng?.iconSets?.reload().then((r) => report('Could not reload the icon sets', r));
  };

  /** The selected set's folder, or the icon sets folder itself while the default set is selected. */
  const openFolder = (): void => {
    const name = selected?.name;
    void window.throng?.iconSets
      ?.openFolder(name)
      .then((r) => report(name ? `Could not open the folder of “${name}”` : 'Could not open the icon sets folder', r));
  };

  /** FR-042: the prompt closes once main has renamed it; main carries every theme naming it along. */
  const renameSet = async (to: string): Promise<string | undefined> => {
    if (!selected) return undefined;
    const from = selected.name;
    let result: IconSetsResult | undefined;
    try {
      // The theme write that selected the set must land first: main rewrites the theme file next.
      await settleConfigWrites();
      result = await window.throng?.iconSets?.rename(from, to);
    } catch (error) {
      logCaught('icon-section: rename icon set', error);
      result = { ok: false, reason: 'io', message: error instanceof Error ? error.message : String(error) };
    }
    if (result && !result.ok && (result.reason === 'exists' || result.reason === 'invalid-name')) return result.message;
    setRenaming(false);
    if (report(`Could not rename the icon set “${from}”`, result)) onSetIconSet(to);
    return undefined;
  };

  /** FR-043: ask, then the folder goes to the trash and every theme using it returns to the default set. */
  const deleteSet = async (): Promise<void> => {
    if (!selected) return;
    const name = selected.name;
    const yes = await confirm({
      title: `Delete the icon set “${name}”?`,
      message: `Its folder goes to the trash. Every theme using it draws the default set's icons instead.`,
      confirmLabel: 'Delete',
      testIds: { dialog: 'icon-set-delete-dialog' },
      choices: [
        { label: 'Cancel', value: 'cancel', testId: 'icon-set-delete-no' },
        { label: 'Delete', value: 'accept', danger: true, testId: 'icon-set-delete-yes' },
      ],
    });
    if (!yes) return;
    await settleConfigWrites();
    if (report(`Could not delete the icon set “${name}”`, await window.throng?.iconSets?.remove(name))) onSetIconSet(undefined);
  };

  /** FR-044: the override file goes to the trash and the key draws the default icon again. */
  const resetIcon = async (key: IconKey): Promise<void> => {
    if (!selected) return;
    const set = selected.name;
    report(`Could not reset ${key} in “${set}”`, await window.throng?.iconSets?.resetIcon(set, key));
  };

  /*
   * FR-046: why the selected set cannot be drawn is a toast, raised once per reason rather than a
   * paragraph that pushes the row's controls about. The picker's option still carries it as its title.
   */
  const unavailable = selected?.error
    ? `“${selected.name}” could not be loaded, so the default set's icons are being shown instead. ${selected.error}`
    : missing
      ? `“${missing}” could not be loaded, so the default set's icons are being shown instead. ${MISSING_REASON}`
      : undefined;
  const reported = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (unavailable === reported.current) return;
    reported.current = unavailable;
    if (unavailable) notify({ severity: 'warning', subject: { kind: 'none' }, message: unavailable, testId: 'icon-set-error' });
  }, [unavailable, notify]);

  /**
   * Create the set; the prompt closes only once main has made it. A refusal main gives for the name
   * (`invalid-name`, `exists`) is returned to show on the name field (FR-025); anything else is reported.
   */
  const createSet = async (name: string): Promise<string | undefined> => {
    let result: IconSetsResult | undefined;
    try {
      result = await window.throng?.iconSets?.create(name, copyFrom);
    } catch (error) {
      // Principle XIII: a call that throws is logged and reported, never a prompt left doing nothing.
      logCaught('icon-section: create icon set', error);
      result = { ok: false, reason: 'io', message: error instanceof Error ? error.message : String(error) };
    }
    if (result && !result.ok && (result.reason === 'exists' || result.reason === 'invalid-name')) return result.message;
    setCopying(false);
    if (report(`Could not create the icon set “${name}”`, result)) onSetIconSet(name);
    return undefined;
  };

  /** FR-032 / FR-033: copy the default art in; when the file is there, ask before replacing it. */
  const overrideIcon = async (key: IconKey): Promise<void> => {
    if (!selected) return;
    const set = selected.name;
    const bridge = window.throng?.iconSets;
    let result = await bridge?.override(set, key, false);
    if (result && !result.ok && result.reason === 'exists') {
      const replace = await confirm({
        title: `Replace ${key}.svg?`,
        message: `The set “${set}” already holds ${key}.svg. Replacing it discards that file.`,
        confirmLabel: 'Replace',
        testIds: { dialog: 'icon-replace-dialog' },
        choices: [
          { label: 'Cancel', value: 'cancel', testId: 'icon-replace-no' },
          { label: 'Replace', value: 'accept', danger: true, testId: 'icon-replace-yes' },
        ],
      });
      if (!replace) return; // Cancel leaves the file exactly as it was (FR-033).
      result = await bridge?.override(set, key, true);
    }
    report(`Could not override ${key} in “${set}”`, result);
  };

  // The section takes part in the Themes typeahead like everything else on the tab (FR-021).
  const visibleTokens = filter ? ICON_TOKENS.filter((t) => filter.tokens.includes(t)) : ICON_TOKENS;
  const showPackRow = !filter || filter.packRowMatches;
  if (filter && !showPackRow && visibleTokens.length === 0) return null;

  return (
    <section className="settings-group" data-testid="settings-group-Icons">
      {/*
        056 FR-001 — the section folds through the same `FoldHeading` the generated sections use (FR-013).
        Its rows are the set row, the colour row and one cell per token, so the total is
        `ICON_TOKENS.length + 2`; under a search the matches are the rows that survived the filter, the
        two settings rows counting together because they show and hide together.
      */}
      <FoldHeading
        level={3}
        testId="settings-group-Icons"
        name="Icons"
        titleClassName="settings-group__title"
        total={ICON_TOKENS.length + SETTING_ROWS}
        matches={filter ? visibleTokens.length + (showPackRow ? SETTING_ROWS : 0) : undefined}
        folded={folded}
        onToggle={onToggleFold}
      >
      {showPackRow ? (
        <div className="settings-row">
          <div className="settings-row__meta">
            <label className="settings-row__label">Icon set</label>
            <p className="settings-row__desc">The set of icons the app draws; keys a set does not hold use the default set.</p>
          </div>
          {/*
            FR-047, FR-049 — nothing in this row moves when the selection changes. Read from the right:
            the picker, then the controls every selection can use, then the ones only a user set can use.
            Every control is always on screen; one the selection cannot use is greyed out, with the reason
            as its title. Messages are toasts (FR-046), never a paragraph here.
          */}
          <div className="settings-row__control icon-set-row" data-testid="icon-set-row">
            {/* FR-030 — action controls are THEMED ICONS with hover titles; the name prompts and the
                confirmations keep text buttons, the dialog-decision exception. */}
            <span className="icon-set-controls icon-set-controls--user" data-testid="icon-set-user-controls">
              <IconButton
                token="rename"
                className="icon-button"
                testId="icon-set-rename"
                title={selected ? 'Rename this icon set' : NOT_A_USER_SET}
                disabled={!selected}
                onClick={() => setRenaming(true)}
              />
              <IconButton
                token="destroy"
                className="icon-button"
                testId="icon-set-delete"
                title={selected ? 'Delete this icon set' : NOT_A_USER_SET}
                disabled={!selected}
                onClick={() => void deleteSet()}
              />
            </span>
            <span className="icon-set-controls" data-testid="icon-set-always-controls">
              <IconButton
                token="copy"
                className="icon-button"
                testId="icon-set-copy"
                title="New set from this set"
                onClick={() => setCopying(true)}
              />
              <IconButton
                token="folderOpen"
                className="icon-button"
                testId="icon-set-open-folder"
                title={selected ? "Open this icon set's folder" : 'Open the icon sets folder'}
                onClick={openFolder}
              />
              <IconButton
                token="refresh"
                className="icon-button"
                testId="icon-set-reload"
                title="Reload the icon sets from disk"
                onClick={reload}
              />
            </span>
            <select
              className="ctl ctl--select"
              data-testid="icon-set-select"
              value={selected ? selected.name : (missing ?? DEFAULT_ICON_SET_NAME)}
              onChange={(e) => selectSet(e.target.value)}
            >
              <option value={DEFAULT_ICON_SET_NAME} data-testid={`icon-set-option-${DEFAULT_ICON_SET_NAME}`}>
                {DEFAULT_ICON_SET_NAME}
              </option>
              {missing ? (
                <option
                  value={missing}
                  disabled
                  title={MISSING_REASON}
                  data-testid={`icon-set-option-${missing}`}
                >
                  {missing} (unavailable)
                </option>
              ) : null}
              {sets.map((p) => (
                <option
                  key={p.name}
                  value={p.name}
                  disabled={!!p.error}
                  // The REASON travels with the option, so a broken set explains itself without
                  // the user having to select it first — which they cannot, since it is disabled.
                  title={p.error}
                  data-testid={`icon-set-option-${p.name}`}
                >
                  {/* FR-048 — every set in this list after the default is the user's own: marked so. */}
                  {`${p.name} *`}
                  {p.error ? ' (unavailable)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {showPackRow ? (
        <div className="settings-row" data-testid="icon-colour-row">
          <div className="settings-row__meta">
            <label className="settings-row__label">Icon colour</label>
            <p className="settings-row__desc">
              Leave it empty and every glyph takes the colour of whatever holds it — which is what
              they have always done, so no theme changes until you set this.
            </p>
          </div>
          <div className="settings-row__control">
            {/*
             * The SAME picker every colour token uses (FR-025). It sits here rather than among the
             * colour tokens because this is where you are standing when the icons look wrong.
             *
             * It is one of the two OPTIONAL tokens, and its emptiness is its meaning: unset, the
             * artwork inherits its host's colour, exactly as before this feature — which is what
             * makes FR-029 true, that no bundled theme changes appearance the day it lands.
             */}
            <ColourField
              value={theme.colours.iconColour ?? ''}
              testId="control-colours.iconColour"
              onCommit={(hex) => onSetIconColour(hex)}
              // One of the only two tokens whose ABSENCE is its meaning: unset, every icon keeps the
              // colour of whatever it sits on, which is why no bundled theme sets it.
              clearable
            />
            {/* FR-043a — an action control, therefore a THEMED ICON with a hover title, not a text
                button. 069 FR-049: always on screen, greyed out while there is nothing to clear. */}
            <IconButton
              token={ROW_ACTION_TOKENS.clear}
              className="icon-button icon-colour__clear"
              testId="icon-colour-clear"
              title={
                theme.colours.iconColour
                  ? 'Clear the icon colour — icons take the colour of what they sit on'
                  : 'The icon colour is already empty: icons take the colour of what they sit on'
              }
              disabled={!theme.colours.iconColour}
              onClick={() => onSetIconColour('')}
            />
          </div>
        </div>
      ) : null}

      <div className="icon-grid" data-testid="icon-grid">
        {visibleTokens.map((token) => {
          // FR-027 — decided by the file's presence alone: a copy of the default still reads Overridden.
          const failure = selected?.failures[token];
          const overridden = selected !== undefined && (selected.overrides[token] !== undefined || failure !== undefined);
          return (
            <div
              className="icon-cell"
              key={token}
              data-testid={`icon-cell-${token}`}
              data-overridden={selected ? String(overridden) : undefined}
              title={ICON_KEY_DESCRIPTIONS[token]}
            >
              <div className="icon-cell__box">
                <Icon token={token} className="icon-cell__icon" />
              </div>
              <span className="icon-cell__name">{token}</span>
              <span className="icon-cell__file">{`${token}.svg`}</span>
              {selected ? (
                <>
                  <span className="icon-cell__status" data-testid={`icon-cell-status-${token}`}>
                    {overridden ? 'Overridden' : 'Default'}
                  </span>
                  {failure !== undefined ? (
                    <span className="icon-cell__failure" data-testid={`icon-cell-failure-${token}`} role="alert">
                      Not used: {failure}
                    </span>
                  ) : null}
                </>
              ) : null}
              {/* FR-049 — both actions on every row, always: greyed out, with the reason as the title,
                  where the selection or the row cannot use them (FR-044: Reset only on an override). */}
              <span className="icon-cell__actions">
                <IconButton
                  token="overrideIcon"
                  className="icon-button"
                  testId={`icon-override-${token}`}
                  title={selected ? 'Override this icon' : NOT_A_USER_SET}
                  disabled={!selected}
                  onClick={() => void overrideIcon(token)}
                />
                <IconButton
                  token={ROW_ACTION_TOKENS.reset}
                  className="icon-button"
                  testId={`icon-reset-${token}`}
                  title={
                    !selected ? NOT_A_USER_SET : overridden ? 'Reset this icon to the default' : 'This icon already comes from the default set'
                  }
                  disabled={!overridden}
                  onClick={() => void resetIcon(token)}
                />
              </span>
            </div>
          );
        })}
      </div>
      {selected && selected.unrecognised.length > 0 ? (
        <div className="icon-set-unrecognised" data-testid="icon-set-unrecognised">
          <p className="settings-row__desc">Files in this set&apos;s folder that match no icon key (they are ignored):</p>
          <ul>
            {selected.unrecognised.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {copying ? (
        <NameDialog
          title={`New set from “${copyFrom}”`}
          initialValue={`${copyFrom} copy`}
          validate={(name) => validateIconSetName(name, existingNames)}
          confirmLabel="Create"
          testId="icon-set-name-dialog"
          idPrefix="icon-set-name"
          onConfirm={createSet}
          onCancel={() => setCopying(false)}
        />
      ) : null}
      {renaming && selected ? (
        <NameDialog
          title={`Rename “${selected.name}”`}
          initialValue={selected.name}
          // The set's own name is not a clash, so a change of case alone is accepted (FR-042).
          validate={(name) => validateIconSetName(name, existingNames.filter((n) => n !== selected.name))}
          confirmLabel="Rename"
          testId="icon-set-rename-dialog"
          idPrefix="icon-set-rename"
          onConfirm={renameSet}
          onCancel={() => setRenaming(false)}
        />
      ) : null}
      </FoldHeading>
    </section>
  );
}
