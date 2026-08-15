import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  SETTINGS_METADATA,
  buildShippedDefaults,
  emptyValueFor,
  filterFields,
  getAtPath,
  isSettingOverridden,
  LANGUAGES,
  settingDiffersFromEntry,
  type FieldDescriptor,
} from '@throng/core';
import type { DetectedFlavourDto } from '../global.js';
import { useAppSettings } from '../config/config-store.js';
import { debounce } from '../config/write-config.js';
import { IconButton } from '../common/icon-button.js';
import { useConfirm, type ConfirmOptions } from '../confirm-dialog.js';
import { useResetNotice } from './reset-notice.js';
import { useOnEntry } from './on-entry.js';
import { RowActions } from './row-actions.js';
import { SettingControl } from './form-controls.js';
import { createApplyClient } from './apply-client.js';

/**
 * The Settings tab (feature 007, US2 — FR-026/027/028). A generic form rendered
 * entirely from {@link SETTINGS_METADATA}: descriptors grouped into labelled
 * sections, each row a label + description + a type-matched control. Editing a
 * control writes the whole settings document via the immediate-apply pipeline
 * (FR-016); the write rides the config watcher so the running app reacts live.
 *
 * FR-043 (form side): the values come from `useAppSettings()`, which is the
 * tolerant, defaults-merged parse of `settings.json`. A malformed file therefore
 * renders the defaults-merged form here without crashing, and a subsequent valid
 * edit repairs the file on write.
 *
 * FR-049: a typeahead at the top narrows the form to the settings matching any
 * typed word (name / description / value). Typing is never blocked — the query
 * updates the field immediately and the filter settles after a short debounce.
 */

/** How long the typeahead waits after the last keystroke before filtering. */
const SEARCH_DEBOUNCE_MS = 150;

function groupDescriptors(items: readonly FieldDescriptor[]): {
  group: string;
  items: FieldDescriptor[];
}[] {
  const order: string[] = [];
  const byGroup = new Map<string, FieldDescriptor[]>();
  for (const d of items) {
    if (!byGroup.has(d.group)) {
      byGroup.set(d.group, []);
      order.push(d.group);
    }
    byGroup.get(d.group)!.push(d);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

/** The shipped record is frozen and pure — build it once for the overridden-test. */
const SHIPPED = buildShippedDefaults();

/**
 * THE FIRST TWO SETTINGS WHOSE CONTROL DEPENDS ON SOMETHING OTHER THAN ITS OWN VALUE (030 US1,
 * #224) — and the reason they are matched here by key rather than declared in the registry.
 *
 * `SETTINGS_METADATA` has no `enabledWhen` and no `confirmWhen`, and adding either is a change to
 * the shared metadata contract that every descriptor, every completeness test and both other
 * registries (keybindings, theme) would then have to live with. Against Principle VIII that is the
 * YAGNI call: a general dependency mechanism whose entire population is the eight descriptors below
 * is a framework built for one caller, and a framework with one caller is guessed, not designed —
 * we do not yet know whether the second dependency will want equality, a predicate, a hidden state
 * rather than a disabled one, or a confirmation keyed on the OLD value rather than the new.
 *
 * The precedent is fifty lines down: `dynamicOptions` matches `appearance.theme`,
 * `editor.languageByExtension` and `terminals.disabledBuiltins` by key, for exactly this reason —
 * a property of a setting that the registry cannot state stays in the renderer that can.
 *
 * The honest answer for the LONGER term is still the registry. Config-editor completeness makes the
 * descriptor the single place a reader can learn what a setting is, and "this control is inert
 * unless its sibling says `timed`" is a fact about the setting, not about this form; a second
 * feature adding a third dependency should lift both of these into `FieldDescriptor` rather than
 * add a third regular expression. Written as two patterns and two small functions precisely so that
 * lift is a move, not a rewrite.
 *
 * They are patterns, not four literal keys each, so all four severities are covered by one rule and
 * a fifth severity would need nothing here.
 */
const NOTICE_TIMEOUT_KEY = /^notifications\.(?:error|warning|info|success)\.timeoutMs$/;
const SILENCEABLE_FAILURE_KEY = /^notifications\.(?:error|warning)\.mode$/;

/**
 * The consent FR-008 requires before a failure stops reporting itself.
 *
 * *Never display* is offerable at all only because the user is told, in the moment, what it costs:
 * a failed operation will say nothing on screen, and the only record left will be the log. That is
 * the bargain, and it is stated as an OUTCOME — "are you sure?" asks someone to confirm a word.
 *
 * Only `error` and `warning` ask. `info` and `success` report things that already happened and
 * worked, so there is no failure to miss and a prompt would be nagging.
 *
 * Returns `null` when no consent is needed, so the caller has one branch and not four.
 */
function silenceConfirmation(d: FieldDescriptor, value: unknown): ConfirmOptions | null {
  if (value !== 'never' || !SILENCEABLE_FAILURE_KEY.test(d.key)) return null;
  return {
    // `d.label` is "Error notices" / "Warning notices" — the setting named the way the user just
    // read it in the row above, never a severity token this file re-spells.
    title: `Never display ${d.label.toLowerCase()}?`,
    message:
      `${d.label} will not be shown anywhere in the application. When one of these events happens ` +
      `it will report nothing on screen, and the only record of it will be the diagnostic log.`,
    confirmLabel: 'Never display them',
    danger: true,
  };
}

export function SettingsTab({
  searchDebounceMs = SEARCH_DEBOUNCE_MS,
}: {
  searchDebounceMs?: number;
} = {}): ReactElement {
  const settings = useAppSettings();
  const entry = useOnEntry().settings;
  const { report } = useResetNotice();
  // THE confirmation model — the one `preferences-app.tsx` already mounts around this tab. A second
  // dialog in this window is the exact duplication 018/FR-054 exists to have removed.
  const confirm = useConfirm();
  const apply = useMemo(() => createApplyClient({ kind: 'settings' }), []);

  // `query` drives the input (instant); `applied` drives the filter (debounced).
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const applySearch = useMemo(
    () => debounce((q: string) => setApplied(q), searchDebounceMs),
    [searchDebounceMs],
  );
  useEffect(() => () => applySearch.cancel(), [applySearch]);

  const onSearchChange = (next: string): void => {
    setQuery(next);
    applySearch(next);
  };
  const clearSearch = (): void => {
    applySearch.cancel(); // the reset is immediate, never debounced
    setQuery('');
    setApplied('');
  };

  const matches = useMemo(
    () => filterFields(applied, SETTINGS_METADATA, (d) => getAtPath(settings, d.key)),
    [applied, settings],
  );
  const groups = useMemo(() => groupDescriptors(matches), [matches]);

  // Dynamic options for the theme selector (the themes present on disk).
  const [themes, setThemes] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    // listThemes lands with the Themes phase (US4); until then this rejects and we
    // simply keep the current value as the only option.
    void window.throng?.config
      ?.listThemes?.()
      .then((list) => {
        if (active) setThemes(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  /**
   * The built-ins this machine actually has — the hidden-built-ins picker's catalogue (019, C10).
   *
   * Fetched once, exactly as the theme list above is, because the answer arrives over IPC and the
   * form renders before it does. It comes from `listDetectedFlavours`, NOT `listFlavours`: the
   * latter has already subtracted the hidden ones, so a picker built from it could not offer back
   * the built-in the user just hid, and hiding would be a one-way door.
   */
  const [detected, setDetected] = useState<DetectedFlavourDto[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.resolve(window.throng?.terminal?.listDetectedFlavours?.())
      .then((list) => {
        // Detection finding nothing renders an EMPTY picker — never a text box (007 FR-029).
        if (active && Array.isArray(list)) setDetected(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  /**
   * Apply an edit — and SAY SO when it could not be applied (FR-006a).
   *
   * The `ConfigWriteResult` used to be dropped on the floor here (`void apply.applyNow(next)`), so a
   * write that failed left the form showing a value the settings file does not contain, with nothing
   * said anywhere: the silent-config-write class of #75, on the way out instead of the way in. The
   * reporter is the one the reset path has always used — the failure is the same failure, and
   * "nothing was changed" is a promise the atomic write actually keeps.
   *
   * It takes the DESCRIPTOR rather than a bare key because a message has to name the setting the way
   * the user does. `notify` replaces a notice carrying the same test id, so a control that commits as
   * you type reports one failure, not one per keystroke.
   */
  const applyEdit = (d: FieldDescriptor, value: unknown): void => {
    /*
     * NO FAILURE REPORT HERE (032, #265). The chokepoint owns it.
     *
     * This used to call `report(\`Saving ${d.label}\`, r)`, and it produced two defects at once.
     *
     * It DOUBLED every message: `config-write-notices.ts` already subscribes to the one point every
     * write passes through, so a failed save raised two notices. The chokepoint's docblock predicted
     * they would collapse — "`notify` replaces a live notice carrying the same [test id]" — but 030
     * moved de-duplication onto `causeKey`, and neither carried one.
     *
     * And the surviving half was WRONG. `d.label` is the setting's label, so the sentence read
     * "Saving Remove a project failed" when the user had changed a confirmation preference and
     * removed nothing at all.
     *
     * The reset path below still reports, and must: a reset goes through `config.resetSetting` in
     * the main process and never touches `writeConfig`, so the chokepoint cannot see it.
     */
    /*
     * ONE KEY, not the whole document (032, FR-001).
     *
     * This used to be `apply.applyNow(setAtPath(settings, d.key, value))` — build a complete
     * settings document from the copy this window is rendering, and write all of it. `settings` here
     * is whatever the watcher last broadcast, so it is stale by however long it has been since the
     * main window changed something. Writing it reverted that change, silently. That is #249.
     *
     * `d.key` is a dotted descriptor key and splits safely: a table descriptor's key names the table
     * (`editor.indentByLanguage`), never a path through it, so no segment here contains a dot.
     */
    void apply.applyChange(d.key.split('.'), value);
  };

  /**
   * Apply an edit, ASKING FIRST where the edit costs the user something they should agree to
   * (030 FR-008).
   *
   * Declining writes nothing at all — not the old value back, nothing. The control that raised this
   * is React-controlled from `settings`, which has not changed, so React restores what it was
   * showing on its own; a dialog whose Cancel branch performs a write would be a dialog that
   * changes the setting whichever button you press, which looks like a choice and is not one.
   *
   * Revert and clear come through here too, and that is correct: choosing *Never display* by
   * reverting to a remembered `never` is still choosing it.
   */
  const commit = (d: FieldDescriptor, value: unknown): void => {
    const question = silenceConfirmation(d, value);
    if (question === null) {
      applyEdit(d, value);
      return;
    }
    void confirm(question).then(
      (accepted) => {
        if (accepted) applyEdit(d, value);
      },
      // A confirmation that fails to settle must not apply the change it was guarding — the
      // unconsented outcome is the one this dialog exists to prevent.
      () => {},
    );
  };

  /**
   * Is this control SHOWN BUT INERT, because the value beside it has taken its meaning away
   * (FR-011)?
   *
   * A notice duration means nothing under *Never display* or *Dismiss only* — the number is real,
   * stored and preserved, but nothing reads it. Leaving it live invites the user to tune a value
   * that will not be consulted, which is the same class of lie as a button that does nothing.
   *
   * The sibling is read from `settings`, the same defaults-merged parse the control's own value
   * comes from, so a `notifications` block missing from the file disables nothing by accident.
   */
  const isInert = (d: FieldDescriptor): boolean => {
    if (!NOTICE_TIMEOUT_KEY.test(d.key)) return false;
    const modeKey = `${d.key.slice(0, d.key.lastIndexOf('.'))}.mode`;
    return getAtPath(settings, modeKey) !== 'timed';
  };

  /**
   * A row's value is clearable when the field declares empty a valid value for it AND it is not
   * already empty — offering "clear" on an empty value is offering a no-op (the same reasoning
   * that hides the reset affordance on a row that is not overridden, FR-004a).
   */
  /**
   * Options a descriptor cannot declare statically, because they are discovered at runtime.
   *
   * Generalised from a single hard-coded check for the theme list: 016 adds a second such field (the
   * language column of `editor.languageByExtension`), and a third would have meant a third `d.key
   * === …` in the JSX. The list of languages is the registry's, so a language added to the registry
   * appears here without anyone remembering to update a settings file.
   */
  const dynamicOptions = (
    d: FieldDescriptor,
    themeNames: readonly string[],
    detectedFlavours: readonly DetectedFlavourDto[],
  ): readonly (string | number)[] | undefined => {
    if (d.key === 'appearance.theme') return themeNames;
    if (d.key === 'editor.languageByExtension') return LANGUAGES.map((l) => l.id);
    // Every detected built-in is offered — INCLUDING the ones currently hidden, which show checked
    // (019, FR-017). The catalogue is the detected set, never the visible set.
    if (d.key === 'terminals.disabledBuiltins') return detectedFlavours.map((f) => f.id);
    return undefined;
  };

  /** What an option's id is CALLED — `cmd` stores, "Command Prompt" reads (019, FR-016). */
  const dynamicOptionLabels = (
    d: FieldDescriptor,
    detectedFlavours: readonly DetectedFlavourDto[],
  ): Record<string, string> | undefined => {
    if (d.key !== 'terminals.disabledBuiltins') return undefined;
    return Object.fromEntries(detectedFlavours.map((f) => [f.id, f.label]));
  };

  /**
   * Is there anything TO clear?
   *
   * The old rule tested `value !== ''`, which is true of every object — so an already-EMPTY map lit
   * its clear button, and clicking it did nothing at all. A control that offers an action it cannot
   * perform teaches the user to distrust the ones that can (016, F6).
   */
  const canClear = (d: FieldDescriptor): boolean => {
    if (!d.clearable) return false;
    const value = getAtPath(settings, d.key);
    if (Array.isArray(value)) return value.length > 0;
    if (value !== null && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== '';
  };

  return (
    <div className="settings-form" data-testid="settings-tab">
      <div className="settings-search">
        <input
          type="text"
          className="settings-search__input"
          data-testid="settings-search"
          placeholder="Search settings…"
          aria-label="Search settings"
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {query ? (
          <IconButton
            token="dismiss"
            className="settings-search__clear"
            testId="settings-search-clear"
            title="Clear search"
            onClick={clearSearch}
          />
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="settings-search__empty" data-testid="settings-search-empty">
          No settings match “{query}”.
        </p>
      ) : null}

      {groups.map(({ group, items }) => (
        <section className="settings-group" key={group} data-testid={`settings-group-${group}`}>
          <h3 className="settings-group__title">{group}</h3>
          {items.map((d) => (
            <div className="settings-row" key={d.key} data-testid={`setting-${d.key}`}>
              <div className="settings-row__meta">
                <label className="settings-row__label">{d.label}</label>
                <p className="settings-row__desc">{d.description}</p>
              </div>
              <div className="settings-row__control">
                <SettingControl
                  descriptor={d}
                  value={getAtPath(settings, d.key)}
                  options={dynamicOptions(d, themes, detected)}
                  optionLabels={dynamicOptionLabels(d, detected)}
                  disabled={isInert(d)}
                  onCommit={(v) => commit(d, v)}
                />
              </div>
              <RowActions
                kind="setting"
                itemKey={d.key}
                label={d.label}
                overridden={isSettingOverridden(settings, d.key, SHIPPED)}
                changed={settingDiffersFromEntry(settings, entry, d.key)}
                clearable={canClear(d)}
                onReset={() => {
                  // A reset restores the SHIPPED value, so it goes through feature 010's record in
                  // the main process — never a value this renderer computed (FR-011b).
                  //
                  // `Promise.resolve` + a rejection handler: optional chaining short-circuits the
                  // WHOLE chain when the bridge is missing, and a throw inside the handler would be
                  // an unhandled rejection — both are the silent failure FR-006a forbids.
                  void Promise.resolve(window.throng?.config?.resetSetting?.(d.key)).then(
                    (r) => report(`Resetting ${d.label}`, r),
                    () => report(`Resetting ${d.label}`, undefined),
                  );
                }}
                // Revert and clear are ordinary EDITS — to a remembered value and to an empty one
                // — so they take the same write path as typing in the box. Only a reset consults
                // the shipped record, and only a reset needs an IPC channel of its own.
                onRevert={() => commit(d, getAtPath(entry, d.key))}
                onClear={() => commit(d, emptyValueFor(d))}
              />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
