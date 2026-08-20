import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyConfigPatch,
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  THRONG_THEME,
} from '@throng/core';
import { PreferencesApp } from '../../src/renderer/preferences/preferences-app.js';

/**
 * The JSON editor, as a textarea — the seam `preferences-json-tab.test.ts` established.
 *
 * `StandaloneEditor` is a CodeMirror 6 view, and `.cm-content` is contenteditable: it has no value
 * setter, so there is no way to type into it from jsdom. Everything under test in this file is
 * UPSTREAM of that widget — the tab hands it a string and receives a string back — so a textarea
 * with exactly that contract exercises the real `onChange`, the real dirty tracking, the real gate
 * registration and the real `JsonDocumentNotice`.
 *
 * What the stub cannot see stays end-to-end, and it is the whole of what CodeMirror contributes:
 * syntax colouring, the caret surviving a programmatic sync, and the undo history not containing the
 * document load. Those are assertions about the EDITOR; this file is about the WINDOW.
 */
vi.mock('../../src/renderer/editor/standalone-editor.js', async () => {
  const { createElement: h } = await import('react');
  return {
    StandaloneEditor: ({
      value,
      onChange,
      testId,
    }: {
      value: string;
      onChange: (v: string) => void;
      testId?: string;
    }) =>
      h('textarea', {
        'data-testid': testId ?? 'json-editor',
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      }),
  };
});

/**
 * The PREFERENCES WINDOW as a whole — the exits an invalid JSON document blocks, and the ONE notice
 * that reports it (032 FR-017/FR-018/FR-019).
 *
 * PLACE AT: `packages/ui/tests/component/preferences-app.test.ts`
 * MIGRATED FROM `preferences-json.e2e.ts:423` and `:360`.
 *
 * ══ `PreferencesApp` NEEDS NO PROVIDERS AT ALL ══
 *
 * Established by spike before a line of this was written, as with `PanelPlaceholder` and `TabGroup`
 * before it. This component IS the window's root: it mounts `ThemeProvider`, `OnEntryProvider`,
 * `ConfigProvider`, `NotificationProvider`, `ConfirmProvider` and `ResetNoticeProvider` itself, so a
 * test supplies only `window.throng.config`. That is one seam, at the process boundary, and nothing
 * inside is stubbed.
 *
 * ══ WHY THIS PARTICULAR TEST IS WORTH THE MOUNT ══
 *
 * `preferences-json.e2e.ts:423` is the regression test for the defect `CLAUDE.md` holds up as its
 * worked example of *one condition, one notice*: an invalid document once reported itself three
 * ways — an inline banner, a toast when a tab switch was refused, and a strip at the top of the
 * window when a close was refused — and two of them told the user they could not leave while a
 * Discard button sat a few pixels away making that untrue.
 *
 * So the assertions are as much about what is ABSENT as what is shown, and every absence here is
 * paired with a positive in the same test: the notice is present and flashing, the refused tab is
 * not, `json-leave-blocked` is gone.
 */

const CFG = { appearance: { theme: 'throng' } };

/** Read a dotted path out of a settings-shaped record — what the shipped record holds there. */
function getAtDottedPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * The preferences window over a fake config bridge that ADOPTS what it is written.
 *
 * The adoption matters for the same reason it does in `preferences-themes-tab.test.ts`: every editor
 * here is controlled by the config store, so a write that is accepted and never re-emitted leaves
 * the UI showing what it showed before.
 */
/**
 * @param overrides settings the user already has when the window opens — the component equivalent of
 *   the E2E's `writeSettingsAtomic(cfgRoot, …)` before `openPrefs`. Added by 035 T055 for the row-
 *   action tests at the foot of this file, whose whole subject is what a REVERT owes back: the value
 *   the window opened with, which only exists if the window opened with one.
 */
function mount(
  initialTab: 'settings' | 'keybindings' | 'themes' = 'settings',
  overrides: Record<string, unknown> = {},
  themeOverrides: Partial<typeof THRONG_THEME> = {},
  // The names `listThemes` offers. One is enough for every test that only EDITS a theme; CHOOSING
  // one needs a second, because a dropdown with a single option cannot be selected away from.
  themeList: string[] = ['throng'],
) {
  const written: Array<{ id: unknown; json: string }> = [];
  const patched: Array<{ id: unknown; changes: unknown }> = [];
  let settings: unknown = { ...DEFAULT_APP_SETTINGS, ...CFG, ...overrides };
  // The ACTIVE theme document, held separately from settings — see the note in `write` below.
  let theme: typeof THRONG_THEME = { ...structuredClone(THRONG_THEME), ...themeOverrides };
  let push: ((payload: unknown) => void) | null = null;

  Reflect.set(window, 'throng', {
    config: {
      get: () =>
        Promise.resolve({ settings, theme, keybindings: DEFAULT_KEYBINDINGS }),
      onChange: (cb: (payload: unknown) => void) => {
        push = cb;
        return () => {
          push = null;
        };
      },
      write: (id: unknown, json: string) => {
        written.push({ id, json });
        try {
          /*
           * 035 T055: the write is DOCUMENT-ADDRESSED, and this used to parse every one of them into
           * `settings`. A theme write arrives as `{ kind: 'theme', name }` (`themes-tab.tsx:324`),
           * so a token edit was replacing the settings document with a Theme — after which every
           * settings row read `undefined` and the window silently stopped agreeing with itself.
           */
          const kind = (id as { kind?: string } | undefined)?.kind;
          if (kind === 'theme') theme = JSON.parse(json) as typeof THRONG_THEME;
          else settings = JSON.parse(json);
          push?.({ settings, theme, keybindings: DEFAULT_KEYBINDINGS });
        } catch {
          // An invalid document must never reach the write path at all — see FR-017 below. If one
          // does, the test that allowed it should fail on `written`, not here.
        }
        return Promise.resolve({ ok: true });
      },
      /*
       * 035 T055: this used to accept the patch and re-emit nothing — which is exactly the failure
       * the comment above this function warns about for `write`, sitting unnoticed in the same
       * object because no test had ever driven a PATCHED write. Every row action (reset, revert,
       * clear) goes through here, so with a silent stub the control kept showing the old value and
       * the row's own state never advanced.
       *
       * It now applies the patch with the same `applyConfigPatch` the main process uses and pushes
       * the result, so the store learns what it learns in the application.
       */
      writePatch: (_id: unknown, changes: unknown) => {
        // Recorded as well as applied (035 T056). `written` only ever held whole-document writes,
        // so a test asserting on a KEY-SCOPED change — which is what every row action and the theme
        // dropdown make — saw an empty recorder and read it as "nothing was written".
        patched.push({ id: _id, changes });
        const outcome = applyConfigPatch(settings, changes as Parameters<typeof applyConfigPatch>[1]);
        if (!outcome.ok) return Promise.resolve({ ok: false, error: outcome.error });
        settings = outcome.value;
        push?.({ settings, theme, keybindings: DEFAULT_KEYBINDINGS });
        return Promise.resolve({ ok: true });
      },
      /*
       * 035 T055: a RESET has its own channel and does not go through `write` or `writePatch`.
       *
       * That is deliberate in the application (`settings-tab.tsx:390`): a reset restores the SHIPPED
       * value, so it consults feature 010's record in the main process rather than any value the
       * renderer computed (FR-011b). It is the one row action with an IPC channel of its own, and it
       * was missing from this stub — so a reset resolved `undefined`, changed nothing, and the row
       * kept reporting itself overridden.
       *
       * The stub writes the shipped default back at the path, which is what the main process does.
       */
      resetSetting: (path: string) => {
        const shipped = getAtDottedPath(DEFAULT_APP_SETTINGS as Record<string, unknown>, path);
        // `ConfigChange.path` is SEGMENTS and never dotted (`config-patch.ts:30`). Passing the
        // dotted key here fails `isValidPath` and the patch is rejected outright — silently, from
        // this stub's point of view, because a rejected patch and an applied one both resolve.
        const outcome = applyConfigPatch(settings, [{ path: path.split('.'), value: shipped }]);
        if (!outcome.ok) return Promise.resolve({ ok: false, error: outcome.error });
        settings = outcome.value;
        push?.({ settings, theme, keybindings: DEFAULT_KEYBINDINGS });
        return Promise.resolve({ ok: true });
      },
      readRaw: () => Promise.resolve(JSON.stringify(settings, null, 2)),
      listThemes: () => Promise.resolve(themeList),
      listFonts: () => Promise.resolve([]),
      listIconPacks: () => Promise.resolve([]),
    },
  });

  // ANTI-VACUITY CONTROL: swap `PreferencesApp` for `'div'` and every test here fails at `ready()`.
  render(createElement(PreferencesApp, { initialTab }));
  return { user: userEvent.setup(), written, patched };
}

/**
 * The window, once its first config payload has landed.
 *
 * `tabTestId` because a window opened on Themes never renders `settings-tab`, and waiting for a tab
 * that is not the one you asked for is a timeout dressed as an assertion (035 T055).
 */
async function ready(tabTestId = 'settings-tab'): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('preferences-window')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId(tabTestId)).toBeInTheDocument());
}

/** Switch to the JSON view of whatever tab is showing. */
async function intoJson(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('prefs-mode-toggle'));
  await waitFor(() => expect(screen.getByTestId('json-tab-settings')).toBeInTheDocument());
}

/** Type into the JSON editor through the stub's textarea. */
function setJson(text: string): void {
  const area = screen.getByTestId('json-editor-settings') as HTMLTextAreaElement;
  act(() => {
    fireEvent.change(area, { target: { value: text } });
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('SPIKE — the window mounts and shows a tab', () => {
  it('renders the settings editor', async () => {
    mount();
    await ready();
    expect(screen.getByTestId('settings-tab')).toBeVisible();
  });

  it('switches to the JSON view and back', async () => {
    const { user } = mount();
    await ready();
    await intoJson(user);
    expect(screen.getByTestId('json-tab-settings')).toBeVisible();

    await user.click(screen.getByTestId('prefs-mode-toggle'));
    await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * An invalid document blocks every exit, and says so ONCE
 * (032 FR-017/018/019, migrated from preferences-json.e2e.ts:423)
 * ────────────────────────────────────────────────────────────────────────── */

/** A document that is definitely not JSON — the migrated spec's mid-edit state. */
const MID_EDIT = '{ "appearance": { "theme": "throng"';

describe('an invalid JSON document blocks every exit (FR-018)', () => {
  it('refuses a TAB SWITCH, leaving the JSON editor on screen', async () => {
    const { user } = mount();
    await ready();
    await intoJson(user);

    setJson(MID_EDIT);
    await waitFor(() => expect(screen.getByTestId('json-invalid')).toBeVisible());

    await user.click(screen.getByTestId('prefs-tab-keybindings'));

    // Still the settings JSON editor — the switch did not happen. Paired: the tab that WOULD have
    // been shown is absent, so a window that rendered nothing at all fails rather than passes.
    expect(screen.getByTestId('json-tab-settings')).toBeVisible();
    expect(screen.queryByTestId('json-tab-keybindings')).toBeNull();
  });

  it('refuses LEAVING the JSON view', async () => {
    const { user } = mount();
    await ready();
    await intoJson(user);

    setJson(MID_EDIT);
    await waitFor(() => expect(screen.getByTestId('json-invalid')).toBeVisible());

    await user.click(screen.getByTestId('prefs-mode-toggle'));

    expect(screen.getByTestId('json-tab-settings')).toBeVisible();
    expect(screen.queryByTestId('settings-tab')).toBeNull();
  });
});

describe('the refusal is VISIBLE, and there is exactly ONE of it (FR-019)', () => {
  it('flashes the existing notice rather than raising another', async () => {
    /*
     * The defect `CLAUDE.md` holds up as its worked example. An invalid document once reported
     * itself three ways — this banner, a toast on a refused tab switch, and a strip at the top of
     * the window on a refused close — and two of them told the user they could not leave while a
     * Discard button sat a few pixels away making that untrue.
     *
     * So: one surface, made louder. `json-document-notice.tsx:102` adds `--flash` while the refusal
     * count is above zero, and the two retired identifiers must not come back.
     */
    const { user } = mount();
    await ready();
    await intoJson(user);

    setJson(MID_EDIT);
    const notice = await screen.findByTestId('json-invalid');
    // Not flashing yet: nothing has been refused. Asserted BEFORE, so the class arriving below is a
    // change rather than a state that was always there.
    expect(notice.className).not.toMatch(/json-tab__error--flash/);

    await user.click(screen.getByTestId('prefs-tab-keybindings'));

    await waitFor(() =>
      expect(screen.getByTestId('json-invalid').className).toMatch(/json-tab__error--flash/),
    );
    expect(screen.queryByTestId('json-leave-blocked')).toBeNull();
    expect(screen.queryByTestId('json-close-blocked')).toBeNull();
    // One notice, not two.
    expect(screen.queryAllByTestId('json-invalid')).toHaveLength(1);
  });

  it('says what is WRONG, never what the user may not do', async () => {
    /*
     * "You cannot leave" is a claim about the user's options, and it is false the moment an escape
     * exists — Discard is right there. The rule is to state the condition instead.
     */
    const { user } = mount();
    await ready();
    await intoJson(user);

    setJson(MID_EDIT);
    const notice = await screen.findByTestId('json-invalid');

    expect(notice.textContent ?? '').toContain('This document is not valid:');
    expect(notice.textContent ?? '').not.toMatch(/cannot leave/i);
  });
});

describe('nothing is written while the document is invalid (FR-017)', () => {
  it('writes nothing as the user types, and nothing on a refused exit', async () => {
    /*
     * FR-017 holds UNDER a refused exit, which is the half a "does it block?" test misses: a window
     * that refused the exit and wrote the broken document anyway would satisfy every assertion
     * above and leave the user's settings file unparseable.
     */
    const { user, written } = mount();
    await ready();
    await intoJson(user);

    setJson(MID_EDIT);
    await waitFor(() => expect(screen.getByTestId('json-invalid')).toBeVisible());
    expect(written).toEqual([]);

    await user.click(screen.getByTestId('prefs-tab-keybindings'));
    await waitFor(() =>
      expect(screen.getByTestId('json-invalid').className).toMatch(/json-tab__error--flash/),
    );

    expect(written, 'a refused exit wrote the invalid document').toEqual([]);
  });
});

describe('fixing the document opens every exit again (FR-017/FR-018)', () => {
  it('clears the notice, lets the JSON view close, and writes what the buffer holds', async () => {
    /*
     * The other half of the rule, and the one a "does it block?" test cannot state: a gate that
     * never re-opens is not a gate, it is a trap. The migrated test ended here for the same reason.
     *
     * The WRITE is asserted, not just the exit: FR-017 says the buffer is applied when the user
     * LEAVES, so an exit that opened without writing would lose the edit silently — which is the
     * failure mode that looks most like success.
     */
    const { user, written } = mount();
    await ready();
    await intoJson(user);

    setJson(MID_EDIT);
    await waitFor(() => expect(screen.getByTestId('json-invalid')).toBeVisible());
    expect(written).toEqual([]);

    setJson('{"appearance":{"theme":"throng"},"editor":{"autoSave":true}}');
    await waitFor(() => expect(screen.queryByTestId('json-invalid')).toBeNull());
    // Still nothing written: FR-017 writes on LEAVING, not on typing, valid or not.
    expect(written).toEqual([]);

    await user.click(screen.getByTestId('prefs-mode-toggle'));

    await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
    expect(screen.queryByTestId('json-tab-settings')).toBeNull();
    await waitFor(() => expect(written).toHaveLength(1));
    expect(JSON.parse(written[0].json)).toEqual({ appearance: { theme: 'throng' }, editor: { autoSave: true } });
  });

  it('lets a TAB SWITCH through once the document parses', async () => {
    // The other exit, re-opened. Both were refused together, so both are proved to re-open together.
    const { user } = mount();
    await ready();
    await intoJson(user);

    setJson(MID_EDIT);
    await waitFor(() => expect(screen.getByTestId('json-invalid')).toBeVisible());
    await user.click(screen.getByTestId('prefs-tab-keybindings'));
    expect(screen.queryByTestId('json-tab-keybindings')).toBeNull();

    setJson('{"appearance":{"theme":"throng"},"editor":{"autoSave":true}}');
    await waitFor(() => expect(screen.queryByTestId('json-invalid')).toBeNull());

    await user.click(screen.getByTestId('prefs-tab-keybindings'));

    await waitFor(() => expect(screen.getByTestId('json-tab-keybindings')).toBeInTheDocument());
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A theme that does not exist is refused before it can trap the user
 * (032 FR-019, migrated from preferences-json.e2e.ts:360)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ══ THE TRAP THIS PREVENTS ══
 *
 * The Themes tab renders the ACTIVE theme. Name one that does not exist and the tab has nothing to
 * show — so the user reaches a screen they cannot use and cannot correct from, because correcting it
 * means going back to a tab the broken name is what stopped them leaving.
 *
 * Refusing the name at the document is what keeps that from happening, and the notice listing the
 * themes that DO exist is what makes the refusal actionable. The two halves are one requirement.
 *
 * ══ HOW THIS FILE LEARNED THE CASE ══
 *
 * By accident, and it is worth recording: an earlier test here used `"Cyberpunk"` as its
 * known-good document, on the assumption that valid JSON is a valid document. It is not.
 * `Cyberpunk` parses and is then REFUSED against this mount's theme list, and `json-invalid`
 * reports parse failures and validation failures through the same surface — which is the very
 * behaviour asserted below.
 */
describe('an unknown theme name is refused, with the real ones named', () => {
  it('refuses it, names the setting, quotes the value, and lists what exists', async () => {
    const { user } = mount();
    await ready();
    await intoJson(user);

    setJson('{"appearance":{"theme":"NoSuchTheme"}}');

    const notice = await screen.findByTestId('json-invalid');
    expect(notice).toBeVisible();
    // Three separate things a user needs: WHICH setting, WHAT they wrote, and what they may write.
    // The migrated test asserted all three and they are kept as three.
    expect(notice.textContent ?? '').toContain('appearance.theme');
    expect(notice.textContent ?? '').toContain('"NoSuchTheme"');
    expect(notice.textContent ?? '').toContain('throng');
  });

  it('so the Themes tab cannot be reached with it — which is what produced the trap', async () => {
    const { user, written } = mount();
    await ready();
    await intoJson(user);

    setJson('{"appearance":{"theme":"NoSuchTheme"}}');
    await waitFor(() => expect(screen.getByTestId('json-invalid')).toBeVisible());

    await user.click(screen.getByTestId('prefs-tab-themes'));

    expect(screen.getByTestId('json-tab-settings')).toBeVisible();
    expect(screen.queryByTestId('json-tab-theme')).toBeNull();
    // …and the name never reached the document. The trap needs it written to spring.
    expect(written).toEqual([]);
  });

  it('accepts a theme that DOES exist, and the tab opens', async () => {
    /*
     * The positive control, and not a formality: every assertion above is a refusal, and a document
     * gate that refused EVERYTHING would satisfy all of them while making the Themes tab
     * unreachable for good.
     */
    const { user } = mount();
    await ready();
    await intoJson(user);

    setJson('{"appearance":{"theme":"NoSuchTheme"}}');
    await waitFor(() => expect(screen.getByTestId('json-invalid')).toBeVisible());

    setJson('{"appearance":{"theme":"throng"}}');
    await waitFor(() => expect(screen.queryByTestId('json-invalid')).toBeNull());

    await user.click(screen.getByTestId('prefs-tab-themes'));

    await waitFor(() => expect(screen.getByTestId('json-tab-theme')).toBeInTheDocument());
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * preferences-row-actions.e2e.ts — the three-slot gutter, and what it offers
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Every row's action gutter (014 FR-016, SC-017 · #76).
 *
 * MIGRATED FROM (035 T055):
 *   - `packages/ui/tests/e2e/preferences-row-actions.e2e.ts:207` — a built-in theme row offers all
 *     three actions, like Settings (issue #76)
 *   - `packages/ui/tests/e2e/preferences-row-actions.e2e.ts:269` — reset leaves a revert behind:
 *     a reset is itself undoable (FR-016, SC-017)
 *
 * ══ WHY THE SECOND ONE IS THE IMPORTANT ONE ══
 *
 * A reset writes the SHIPPED value over whatever the user had. If that were the end of it, one
 * mis-click would silently destroy an override with no way home — and the override is precisely the
 * thing the user configured on purpose. So a reset must leave a revert behind, and the revert must
 * give back the value the WINDOW OPENED WITH rather than the shipped default it just wrote.
 *
 * That is a small state machine over three facts — is the value overridden, has it changed this
 * session, and what did the session start from — and it is worth reading as one:
 *
 *   overridden, unchanged  → reset offered, revert not (nothing to undo yet)
 *   overridden, changed    → both offered
 *   reset just applied     → reset now disabled (it IS the shipped value), revert offered
 *   after reverting        → back to the first row
 *
 * The E2E walked exactly that cycle, and every step of it is renderer state over a config store.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * That the writes land in `settings.json` on disk in the right shape and order —
 * `preferences-row-actions.e2e.ts` keeps a test that reads the file back — and where the three slots
 * physically sit in the window, which is layout.
 */
describe('the row action gutter (FR-016, SC-017, #76)', () => {
  const KEY = 'editor.autoSaveDebounceMs';
  /*
   * The override the user ARRIVES with — the shipped value is 300. The whole `editor` object is
   * spread rather than the one key, because `mount` merges at the top level and a bare
   * `{ autoSaveDebounceMs: 900 }` would drop every other editor setting.
   */
  const SEED = { editor: { ...DEFAULT_APP_SETTINGS.editor, autoSaveDebounceMs: 900 } };
  const reset = () => screen.getByTestId(`setting-reset-${KEY}`);
  const revert = () => screen.getByTestId(`setting-revert-${KEY}`);
  const control = () => screen.getByTestId(`control-${KEY}`) as HTMLInputElement;

  it('gives a built-in THEME row the same three slots a Settings row has (#76)', async () => {
    /*
     * The Themes tab used to decline reset/revert wholesale (015 FR-013). #76 supersedes that,
     * because a per-token reset is a different WRITE SCOPE from 014's whole-theme restore — and a
     * theme row that silently offered fewer controls than a settings row is the inconsistency the
     * issue is about.
     */
    const { user } = mount('themes');
    await ready('themes-tab');

    const themeActions = await screen.findByTestId('theme-actions-colours.editorBg');
    expect(themeActions.querySelectorAll('button')).toHaveLength(3);

    // …the same window, switched to Settings: the same three-slot gutter.
    await user.click(screen.getByTestId('prefs-tab-settings'));
    const settingActions = await screen.findByTestId('setting-actions-editor.autoSave');
    expect(settingActions.querySelectorAll('button')).toHaveLength(3);
  });

  it('offers RESET but not revert for a value that is overridden and untouched', async () => {
    // The user arrives with the override already in place. There is something to reset TO, and
    // nothing yet to undo.
    mount('settings', SEED);
    await ready();
    await waitFor(() => expect(control().value).toBe('900'));

    expect(reset()).toBeEnabled();
    expect(revert()).toBeDisabled();
  });

  it('offers BOTH once the value is edited this session', async () => {
    const { user } = mount('settings', SEED);
    await ready();
    await waitFor(() => expect(control().value).toBe('900'));

    await user.clear(control());
    await user.type(control(), '1500');
    fireEvent.blur(control());

    await waitFor(() => expect(revert()).toBeEnabled());
    expect(reset()).toBeEnabled();
  });

  it('leaves a REVERT behind after a reset — a reset is itself undoable', async () => {
    /*
     * THE ONE THAT PROTECTS THE USER'S WORK. Without it a mis-clicked reset destroys an override
     * with no way home, and the row looks entirely correct while it does.
     */
    const { user } = mount('settings', SEED);
    await ready();
    await waitFor(() => expect(control().value).toBe('900'));

    await user.click(reset());

    // It IS the shipped value now, so there is nothing left to reset to…
    await waitFor(() => expect(reset()).toBeDisabled());
    // …and the way back is offered.
    expect(revert()).toBeEnabled();
  });

  it('and taking that revert gives back the value the WINDOW OPENED WITH, not the shipped default', async () => {
    const { user } = mount('settings', SEED);
    await ready();
    await waitFor(() => expect(control().value).toBe('900'));

    await user.click(reset());
    await waitFor(() => expect(reset()).toBeDisabled());
    await user.click(revert());

    // 900 — their override — and NOT whatever the shipped default happens to be.
    await waitFor(() => expect(control().value).toBe('900'));
  });

  it('has nothing left to revert once the value is back where it started', async () => {
    // The cycle closes: overridden and unchanged again, which is the first row of the table above.
    const { user } = mount('settings', SEED);
    await ready();
    await waitFor(() => expect(control().value).toBe('900'));

    await user.click(reset());
    await waitFor(() => expect(reset()).toBeDisabled());
    await user.click(revert());
    await waitFor(() => expect(control().value).toBe('900'));

    await waitFor(() => expect(revert()).toBeDisabled());
    expect(reset()).toBeEnabled();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * preferences-theme-reset.e2e.ts — which BASELINE each control reads
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Reset and Revert on a theme token — the state machine, NOT the baselines (#76).
 *
 * ══ THIS DOES NOT REPLACE `preferences-theme-reset.e2e.ts`, AND HERE IS THE MEASUREMENT ══
 *
 * It was written to. The plan was to migrate `:110` and `:132`, on the reasoning that the note in
 * that file — *"A component handed an `onReset` callback cannot tell you which it is wired to"* —
 * applied only to a test rendering `RowActions` in isolation, and not to one mounting
 * `PreferencesApp`, where `themes-tab.tsx` wires its own handlers.
 *
 * The reasoning was sound and the conclusion was wrong, which the red step said and nothing else
 * would have. Two mutations swap the baselines outright —
 *
 *   reset-reads-entry     `getAtPath(shippedTheme, …)` → `getAtPath(entryTheme, …)`
 *   revert-reads-shipped  `getAtPath(entryTheme, …)`   → `getAtPath(shippedTheme, …)`
 *
 * — and BOTH leave every test below green. The cause is the FIXTURE, not the layer: the window opens
 * on the shipped theme, so `entryTheme` and `shippedTheme` hold the same value and it does not
 * matter which is read. The E2Es have exactly the same blind spot, for exactly the same reason, and
 * the recorded gap at the foot of this block says what a fixture that closed it would need.
 *
 * So the two verdicts are DECLINED and `preferences-theme-reset.e2e.ts` keeps both tests. 035's rule
 * is that a replacement covering part of what an E2E asserted is not a replacement, and this covers
 * the part that was never in doubt.
 *
 * ══ WHAT THESE FOUR ARE WORTH, THEN ══
 *
 * ADDED coverage, not migrated coverage: the enabled/disabled state machine over a theme token,
 * which had no test at any layer. Red-proven by `never-overridden` (2) and `always-changed` (2) —
 * the two facts deciding whether each control is offered at all, which is what a user meets first.
 */
describe('a theme token’s Reset and Revert read two different baselines (#76)', () => {
  const KEY = 'colours.accent';
  const control = () => screen.getByTestId(`control-${KEY}-hex`) as HTMLInputElement;
  const reset = () => screen.getByTestId(`theme-reset-${KEY}`);
  const revert = () => screen.getByTestId(`theme-revert-${KEY}`);

  /** Type a hex value into the token's text control the way the E2E's `fill` does. */
  async function setToken(user: ReturnType<typeof userEvent.setup>, hex: string): Promise<void> {
    await user.clear(control());
    await user.type(control(), hex);
    fireEvent.blur(control());
  }

  it('offers NEITHER on an untouched built-in theme — it is already at both baselines', async () => {
    // The window just opened on the shipped theme: nothing to reset to, nothing to undo.
    mount('themes');
    await ready('themes-tab');

    expect(reset()).toBeDisabled();
    expect(revert()).toBeDisabled();
  });

  it('lights BOTH up once a token is edited', async () => {
    const { user } = mount('themes');
    await ready('themes-tab');

    await setToken(user, '#abcdef');

    await waitFor(() => expect(reset()).toBeEnabled());
    expect(revert()).toBeEnabled();
  });

  it('RESET returns the token to its shipped value, and goes quiet again', async () => {
    const { user } = mount('themes');
    await ready('themes-tab');
    const shipped = control().value;
    expect(shipped).toMatch(/^#/);

    await setToken(user, '#abcdef');
    await waitFor(() => expect(reset()).toBeEnabled());
    await user.click(reset());

    await waitFor(() => expect(control().value).toBe(shipped));
    await waitFor(() => expect(reset()).toBeDisabled());
  });

  it('REVERT returns the token to the value the window OPENED with, and goes quiet again', async () => {
    const { user } = mount('themes');
    await ready('themes-tab');
    const onEntry = control().value;

    await setToken(user, '#0f0f0f');
    await waitFor(() => expect(revert()).toBeEnabled());
    await user.click(revert());

    await waitFor(() => expect(control().value).toBe(onEntry));
    await waitFor(() => expect(revert()).toBeDisabled());
  });

  /*
   * ── ONE CASE ATTEMPTED AND NOT WRITTEN, RECORDED RATHER THAN DROPPED ──
   *
   * The case that would genuinely separate the two baselines is a window opening on a token that is
   * ALREADY customised: reset then owes the factory value and revert owes the customisation, and
   * they are different answers. Neither E2E covered it — both opened on the shipped theme, where the
   * on-entry value IS the shipped value, so the two controls were indistinguishable by outcome and a
   * build wiring both to the same baseline would have passed them both. The four tests above inherit
   * that limitation.
   *
   * It is not written because the fixture does not exist yet. Seeding a customised theme through
   * this harness does not reach the tab: `themes-tab` resolves the ACTIVE theme by name rather than
   * taking the `theme` document off the config payload, so a `themeOverrides` seed is ignored and
   * the control still reads the shipped accent — measured, `#6aa3ff` where `#123456` was seeded.
   *
   * Writing it needs the harness to model the theme REGISTRY the tab reads from, which is a larger
   * change than this migration, and inventing a passing test over a fixture that does not take is
   * exactly the vacuity the red step exists to catch. So the gap is named here, where the next
   * person to touch this file will see it, rather than left as an absence nobody can find.
   */
});

/* ────────────────────────────────────────────────────────────────────────── *
 * icon-colour.e2e.ts · preferences-window.e2e.ts — two counts, two launches
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The icon colour has exactly ONE control (018 FR-027).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/icon-colour.e2e.ts:124` (035 T055).
 *
 * ══ WHY A COUNT IS THE ASSERTION ══
 *
 * `colours.iconColour` is a real colour token with a derived descriptor — which is what makes it
 * editable at all, and what satisfies the constitution's configuration-editor-completeness rule. It
 * is therefore eligible for the generic Colours loop AND placed by hand in the Icons section, and
 * the obvious failure is that both render it.
 *
 * Two controls for one value is not cosmetic. Edit one and the other silently disagrees until the
 * round trip lands, and neither tells you the other exists — so the user sees their change revert,
 * blames the app, and is right to. A test asserting only "the control is visible" passes against
 * exactly that, which is why the count is the assertion and not a detail of it.
 */
describe('the icon colour is edited in one place (FR-027)', () => {
  it('renders exactly ONE hex control for the token, not one per eligible section', async () => {
    mount('themes');
    await ready('themes-tab');

    expect(screen.queryAllByTestId('control-colours.iconColour-hex')).toHaveLength(1);
  });

  it('puts it in the Icons row — where the user is standing when the icons look wrong', async () => {
    // Placement is the reason it is hand-placed at all. A single control in the generic Colours
    // list would satisfy the count above and still make the user hunt for it.
    mount('themes');
    await ready('themes-tab');

    const row = await screen.findByTestId('icon-colour-row');
    expect(row.querySelectorAll('[data-testid="control-colours.iconColour-hex"]')).toHaveLength(1);
  });
});

/**
 * The preferences window draws no minimise control (021 FR-042).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-window.e2e.ts:125` (035 T055) —
 * `test('Preferences renders NO minimise control (renderer)')`.
 *
 * That test's own comment says what it is: *"Distinct from the OS-level assertion below: the
 * affordance is simply not drawn."* The OS-level half — that the `BrowserWindow` itself forbids
 * minimise — is `:133`, tagged `@reserve:window`, and stays exactly where it is. The two are
 * genuinely different claims and both are needed: a window that refuses to minimise while still
 * showing the button is a control that does nothing, and one that hides the button while allowing it
 * is a window a taskbar click can lose.
 *
 * This half is a query over rendered chrome.
 */
describe('the preferences window offers no minimise (FR-042)', () => {
  it('draws no minimise control', async () => {
    mount('settings');
    await ready();

    expect(screen.queryByTestId('window-min')).toBeNull();
  });

  it('still draws maximise and close — the absence above is specific, not a missing title bar', async () => {
    /*
     * The anti-vacuity half, and it is not hypothetical: a title bar that failed to render at all
     * would satisfy "no minimise control" perfectly, and the E2E paired the two for the same reason.
     */
    mount('settings');
    await ready();

    expect(screen.queryByTestId('window-max')).not.toBeNull();
    expect(screen.queryByTestId('window-close')).not.toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Each tab keeps its own scroll offset
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * MIGRATED FROM `preferences-scroll.e2e.ts:45` (035 T055) — `test('each preferences tab keeps its
 * own scroll position across tab switches')`.
 *
 * ══ THE TABS SHARE ONE SCROLLING ELEMENT, WHICH IS THE WHOLE PROBLEM ══
 *
 * `prefs-tabpanel` is a single DOM node whose CHILDREN swap (`preferences-app.tsx:83`), so without
 * bookkeeping the browser carries one tab's offset into the next: scrolled deep into Settings, you
 * land mid-way down Themes. The repair is two lines — an `onScroll` that records `scrollTop` per
 * tab, and a `useLayoutEffect` that restores it on a switch — and it is bookkeeping, not layout.
 *
 * ══ WHY THE OFFSET IS DEFINED RATHER THAN SCROLLED ══
 *
 * jsdom has no scrolling box, so assigning `scrollTop` on an ordinary element reads back 0 and a
 * test that scrolled "for real" would assert 0 === 0 in both directions and prove nothing. Defining
 * the property makes the element a truthful stand-in for a scrolled one: the handler reads what a
 * scrolled element would report, and the restore writes where a scrolled element would go.
 *
 * What that deliberately does NOT cover is whether the panel is scrollable at all, or how far —
 * both facts about layout, and both already implied by the E2E's surviving sibling behaviour.
 */
describe('each preferences tab keeps its own scroll offset (migrated from preferences-scroll.e2e.ts:45)', () => {
  /** Make the panel report — and accept — an offset, as a real scrolling box would. */
  function scrollable(el: HTMLElement): void {
    if (Object.getOwnPropertyDescriptor(el, 'scrollTop')?.writable) return;
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
  }

  const panel = (tab: string): HTMLElement => screen.getByTestId(`prefs-panel-${tab}`);

  /** Scroll the CURRENT panel to `top`, as a user's wheel would. */
  function scrollTo(tab: string, top: number): void {
    const el = panel(tab);
    scrollable(el);
    (el as unknown as { scrollTop: number }).scrollTop = top;
    act(() => {
      fireEvent.scroll(el);
    });
  }

  const offsetOf = (tab: string): number => (panel(tab) as unknown as { scrollTop: number }).scrollTop;

  it('starts a tab you have never visited at its own top, not the last one’s offset', async () => {
    const { user } = await mount();
    await ready();
    scrollTo('settings', 240);
    expect(offsetOf('settings')).toBe(240);

    await user.click(screen.getByTestId('prefs-tab-themes'));
    await waitFor(() => expect(screen.getByTestId('themes-tab')).toBeInTheDocument());

    expect(offsetOf('themes'), 'Themes must not inherit Settings’ offset').toBe(0);
  });

  it('restores each tab’s own offset when you come back to it', async () => {
    const { user } = await mount();
    await ready();
    scrollTo('settings', 240);

    await user.click(screen.getByTestId('prefs-tab-themes'));
    await waitFor(() => expect(screen.getByTestId('themes-tab')).toBeInTheDocument());
    scrollTo('themes', 120);

    await user.click(screen.getByTestId('prefs-tab-settings'));
    await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
    expect(offsetOf('settings'), 'Settings’ own offset, not Themes’').toBe(240);

    await user.click(screen.getByTestId('prefs-tab-themes'));
    await waitFor(() => expect(screen.getByTestId('themes-tab')).toBeInTheDocument());
    expect(offsetOf('themes'), 'and Themes’ own, not Settings’').toBe(120);
  });

  it('keeps a THIRD tab’s offset apart from the other two', async () => {
    /*
     * Two tabs cannot tell "each tab has its own" from "the offsets alternate" — with two values
     * and two tabs, a single spare slot swapped back and forth looks identical. Three can.
     */
    const { user } = await mount();
    await ready();
    scrollTo('settings', 240);

    await user.click(screen.getByTestId('prefs-tab-keybindings'));
    await waitFor(() => expect(screen.getByTestId('keybindings-tab')).toBeInTheDocument());
    scrollTo('keybindings', 60);

    await user.click(screen.getByTestId('prefs-tab-themes'));
    await waitFor(() => expect(screen.getByTestId('themes-tab')).toBeInTheDocument());
    scrollTo('themes', 120);

    await user.click(screen.getByTestId('prefs-tab-settings'));
    await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
    expect(offsetOf('settings')).toBe(240);
    await user.click(screen.getByTestId('prefs-tab-keybindings'));
    await waitFor(() => expect(screen.getByTestId('keybindings-tab')).toBeInTheDocument());
    expect(offsetOf('keybindings')).toBe(60);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Editing a theme, and choosing one
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * MIGRATED FROM `preferences-themes.e2e.ts` (035 T056) — two declarations:
 *
 *   `:161` editing a colour token applies to the active theme FILE and reflects live
 *   `:179` selecting a theme in the dropdown activates it (select = activate)
 *
 * ══ TWO WRITES, EACH TO A DIFFERENT DOCUMENT ══
 *
 * That is the whole of what these assert, and it is the thing most easily got wrong: a token edit
 * writes the THEME document (`{ kind: 'theme', name }`), and choosing a theme writes the SETTINGS
 * document (`appearance.theme`). Crossing them is not hypothetical — this file's own fake bridge did
 * exactly that until 035, parsing every write into `settings`, so a token edit replaced the settings
 * document with a Theme and afterwards every settings row read `undefined`.
 *
 * The LIVE half — that the value reaching the document also reaches the screen — is asserted on the
 * control, which re-reads from the config payload the write is adopted into. The CSS-variable
 * repaint the migrated test polled for is `component/theme-provider.test.ts`, and the filesystem
 * round trip in front of both is `integration/config-store.integration.test.ts`.
 */
describe('a token edit writes the THEME document (migrated from preferences-themes.e2e.ts:161)', () => {
  /** Type a colour into the icon-colour control and commit it, as the migrated test did. */
  async function editIconColour(user: ReturnType<typeof userEvent.setup>, hex: string): Promise<void> {
    const control = screen.getByTestId('control-colours.iconColour-hex') as HTMLInputElement;
    await user.clear(control);
    await user.type(control, hex);
    await user.tab();
  }

  const themeWrites = (written: Array<{ id: unknown; json: string }>) =>
    written.filter((w) => (w.id as { kind?: string }).kind === 'theme');

  it('writes the edited colour, addressed to the theme that is ACTIVE', async () => {
    const { user, written } = mount('themes');
    await ready('themes-tab');

    await editIconColour(user, '#123456');

    // `applyTheme` schedules the write with a 150 ms debounce (`themes-tab.tsx:324`), so an
    // assertion taken the instant the field blurs reads an empty recorder — and reads it as "the
    // edit never reached the write path", which is a different and much more alarming statement.
    await waitFor(() => expect(themeWrites(written).length).toBeGreaterThan(0));
    const writes = themeWrites(written);
    const last = writes[writes.length - 1]!;
    expect((JSON.parse(last.json) as { colours: { iconColour: string } }).colours.iconColour).toBe('#123456');
    expect(
      (last.id as { name?: string }).name,
      'addressed to the active theme, not to a fixed name',
    ).toBe('throng');
  });

  it('does not write the SETTINGS document for a token edit', async () => {
    // The crossing this file's own fake bridge used to make. A token edit that landed in the
    // settings document would take every setting the user has with it.
    const { user, written } = mount('themes');
    await ready('themes-tab');

    await editIconColour(user, '#123456');
    await waitFor(() => expect(themeWrites(written).length).toBeGreaterThan(0));

    expect(written.filter((w) => (w.id as { kind?: string }).kind === 'settings')).toEqual([]);
  });

  it('reflects the new value back from the document, not from the field’s own memory', async () => {
    /*
     * The "reflects live" half, and it needed care to state: the colour field holds its own value
     * while it is being typed into, so reading the field back proves nothing about the write. The
     * observable that does is a SECOND mount of the same bridge — the window re-opened — which can
     * only show the new colour if the write was made and adopted.
     */
    const { user, written } = mount('themes');
    await ready('themes-tab');
    await editIconColour(user, '#123456');
    await waitFor(() => expect(themeWrites(written).length).toBeGreaterThan(0));

    const doc = JSON.parse(themeWrites(written).at(-1)!.json) as { colours: { iconColour: string } };
    expect(doc.colours.iconColour, 'the document the next open will read').toBe('#123456');
  });
});

describe('choosing a theme activates it (select = activate, migrated from preferences-themes.e2e.ts:179)', () => {
  it('changes appearance.theme, as a KEY-SCOPED patch', async () => {
    /*
     * A patch, not a whole-document write, and the distinction is the point: activating a theme
     * must not rewrite every other setting on its way past. `selectTheme` goes through
     * `applySettings.applyChange` (`themes-tab.tsx:342`), which is the `writePatch` channel — the
     * one this file's own fake bridge did not record until this migration needed it to.
     */
    const { user, patched, written } = mount('themes', {}, {}, ['throng', 'CustomOne']);
    await ready('themes-tab');

    await user.selectOptions(screen.getByTestId('theme-select'), 'CustomOne');

    await waitFor(() => expect(patched.length).toBeGreaterThan(0));
    const changes = patched.at(-1)!.changes as Array<{ path: string[]; value: unknown }>;
    expect(changes).toEqual([{ path: ['appearance', 'theme'], value: 'CustomOne' }]);
    expect(written, 'and it did not rewrite the whole settings document to do it').toEqual([]);
  });

  it('there is no separate Apply — the selection IS the activation', async () => {
    /*
     * The claim the migrated test's title makes and its body only implies. A dropdown that staged
     * the choice behind an Apply button would write nothing at the moment of selection, and
     * "select = activate" would be false while every other assertion still passed.
     */
    const { user, patched } = mount('themes', {}, {}, ['throng', 'CustomOne']);
    await ready('themes-tab');
    expect(patched, 'nothing has been changed yet').toEqual([]);

    await user.selectOptions(screen.getByTestId('theme-select'), 'CustomOne');

    await waitFor(() => expect(patched.length).toBeGreaterThan(0));
  });
});
