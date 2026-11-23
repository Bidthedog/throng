/**
 * The preferences JSON tab's EDIT LIFECYCLE — what is written and when, what the standing warning
 * names, what Discard restores, and which of a clean/dirty buffer follows the file (032, FR-017 /
 * FR-018a; 015 FR-013b).
 *
 * PLACE AT: `packages/ui/tests/component/preferences-json-tab.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-json.e2e.ts` lines 153, 236, 270, 468 and 763
 * (034 FR-045).
 *
 * ══ WHY THESE FIVE COME DOWN, AND NOT THE OTHER ELEVEN ══
 *
 * Each of the five launched Electron, started a daemon, opened a second BrowserWindow, flipped it to
 * JSON mode and typed into a real CodeMirror instance — in order to observe a decision `JsonTab`
 * makes entirely in the renderer: whether to call `writeConfig`, which file name to put in a
 * sentence, what `discard()` restores, and which branch of the external-change effect runs. None of
 * them read a file, resized a window, or watched a window refuse to close. The eleven that stay all
 * do at least one of those.
 *
 * The companion file `preferences-json-notice.test.ts` already owns the notice's own markup. This
 * one owns the HOST: that typing produces problems at all, that the file name is derived from the
 * document rather than fixed, that the two messages alternate as the user edits, and that the write
 * happens on leaving and at no other time.
 *
 * ══ WHY `StandaloneEditor` IS STUBBED, AND WHY THAT IS NOT CHEATING ══
 *
 * `JsonTab` renders one child, a CodeMirror 6 view. Everything under test here is upstream of it:
 * the tab hands the view a string and receives a string back. The stub is a `<textarea>` with
 * exactly that contract, so the tab's real `onChange`, real dirty tracking, real gate registration
 * and the real `JsonDocumentNotice` are all exercised — only the text widget is swapped.
 *
 * What the stub deliberately CANNOT see stays end-to-end, and that is the whole of what CodeMirror
 * contributes: syntax colouring (`preferences-json.e2e.ts:550`, FR-049 real text rendering), the
 * caret surviving a programmatic sync (`:672`), and the undo history not containing the document
 * load (`:610`, #264). Those are assertions about the editor, not about this tab.
 *
 * ══ ANTI-VACUITY CONTROL (mandatory) ══
 *
 * **Delete the `readRaw` member from the fake bridge in `fakeConfig()`.** Optional chaining makes
 * that a silent no-op in production — the tab still mounts, the notice still renders, and every
 * "X is absent" assertion still holds — so it is precisely the vacuity that would otherwise hide
 * here. Every test goes through `mountLoaded()`, which asserts the seeded document actually reached
 * the editor before the test does anything, so withholding it fails **all 15 `it` declarations /
 * 16 cases** in this file — the `it.each` contributes two.
 *
 * (A second, blunter control: drop `NotificationProvider` from `mountLoaded`. `JsonTab` reaches
 * `useCopyToClipboard` → `useNotify`, which throws outside it, so all 15 fail on the render itself.)
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigDocId } from '@throng/core';
import { JsonTab } from '../../src/renderer/preferences/json-tab.js';
import {
  JsonEditGateProvider,
  useJsonEditGate,
} from '../../src/renderer/preferences/json-edit-gate.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

/*
 * The text widget, replaced by a textarea with the same string-in/string-out contract.
 *
 * `vi.mock` is hoisted above every import in this file by the runner, so `JsonTab` above already
 * resolves to the stub — and the factory imports React itself rather than closing over a top-level
 * binding that does not exist yet at hoist time.
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

/** The half-typed document the E2E used: it does not parse, and will not until the brace lands. */
const MID_EDIT = '{"appearance":{"theme":"Matrix"';
const VALID_MATRIX = '{"appearance":{"theme":"Matrix"}}';

const SETTINGS: ConfigDocId = { kind: 'settings' };
const SEEDED = { settings: '{"appearance":{"theme":"throng"}}\n' };

/** The same key `write-config.ts` and `json-tab.tsx` use, so the fake stores documents as they do. */
function keyOf(id: ConfigDocId): string {
  return id.kind === 'theme' ? `theme:${id.name}` : id.kind;
}

/**
 * A config bridge that holds documents as real state.
 *
 * Stateful rather than canned, because `discard()` restores the BASELINE the tab loaded and a bridge
 * that replied with a fixture would leave that test asserting its own constant. `external()` is the
 * config watcher's broadcast — the same `onChange` callback main pushes — which is how the
 * clean/dirty branch is reached without a real file on a real disk.
 */
function fakeConfig(files: Record<string, string>) {
  const docs = new Map(Object.entries(files));
  const listeners = new Set<() => void>();
  const write = vi.fn(async (id: ConfigDocId, json: string) => {
    docs.set(keyOf(id), json);
    return { ok: true } as const;
  });
  const bridge = {
    get: vi.fn(async () => null),
    onChange: vi.fn((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    write,
    readRaw: vi.fn(async (id: ConfigDocId) => docs.get(keyOf(id)) ?? ''),
    // The themes that exist, for FR-019c. Arrives asynchronously, exactly as it does in production.
    listThemes: vi.fn(async () => ['throng', 'Matrix', 'Cyberpunk']),
  };
  return {
    bridge,
    write,
    /** Somebody else changed the file — a text editor, another window, a reset from the toolbar. */
    async external(id: ConfigDocId, raw: string): Promise<void> {
      docs.set(keyOf(id), raw);
      await act(async () => {
        for (const cb of [...listeners]) cb();
        // The tab answers by re-reading the document, so the state change is a promise away.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

/**
 * The shell's half of the gate, reduced to the one thing it does.
 *
 * `PreferencesShell` funnels every exit through `jsonGate.tryLeave()` and proceeds only when it
 * returns true (`preferences-app.tsx:291` and `:297`). That is reproduced here rather than mounted,
 * because mounting the shell means `ConfigProvider`, `ThemeProvider`, `ContextMenuProvider` and a
 * preload bridge — and the tests that need the REAL shell wiring (a refused tab switch, a refused
 * window close) are exactly the ones staying at E2E for that reason.
 */
function GateHost(): ReactElement {
  const gate = useJsonEditGate();
  return createElement('button', {
    type: 'button',
    'data-testid': 'host-leave',
    onClick: () => gate.tryLeave(),
  });
}

/**
 * Mount the tab over `files` and wait for its document to arrive.
 *
 * The wait is the anti-vacuity gate named in the header: the tab reads its document AFTER mount, so
 * a test asserting anything before this resolved would be asserting against an empty editor.
 */
async function mountLoaded(docId: ConfigDocId, files: Record<string, string>) {
  const cfg = fakeConfig(files);
  (window as unknown as { throng?: unknown }).throng = { config: cfg.bridge };

  const tree = (id: ConfigDocId): ReactElement =>
    createElement(
      NotificationProvider,
      null,
      createElement(
        JsonEditGateProvider,
        null,
        createElement(GateHost),
        createElement(JsonTab, { docId: id }),
      ),
    );
  const { rerender } = render(tree(docId));

  const expected = files[keyOf(docId)] ?? '';
  const editor = (await screen.findByTestId(`json-editor-${docId.kind}`)) as HTMLTextAreaElement;
  await waitFor(() => {
    expect(editor.value, 'the seeded document never reached the editor').toBe(expected);
  });
  /*
   * The theme list arrives on its own promise and re-validates what is on screen (`json-tab.tsx`,
   * the `listThemes` effect). Settled here with a macrotask rather than a microtask or two: the
   * number of `.then` hops is an implementation detail of that effect, and a test that guessed it
   * would go green until someone added one.
   */
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    ...cfg,
    editor,
    /**
     * The shell hands the tab another document — what `preferences-app.tsx` does on the Themes tab
     * when `appearance.theme` changes underneath it (#707). Settled like a load, because the tab
     * answers a switch it accepts with a `readRaw` round trip.
     */
    async retarget(id: ConfigDocId): Promise<void> {
      await act(async () => {
        rerender(tree(id));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

/** Replace the whole buffer, as select-all-and-retype does in the real editor. */
function typeDocument(editor: HTMLTextAreaElement, text: string): void {
  fireEvent.change(editor, { target: { value: text } });
}

/** Long enough that "nothing was written" means something: the debounce this replaced was 300 ms. */
const PAST_THE_OLD_DEBOUNCE = 400;
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
  vi.restoreAllMocks();
});

describe('FR-017 — when the document is written', () => {
  it('writes NOTHING while the user is typing, valid or not', async () => {
    /*
     * The negative the E2E spent a 1200 ms sleep and a whole Electron launch on. There is no write
     * path out of `onChange` at all now, so the assertion is that the bridge was never asked — and
     * the wait that remains is still longer than the debounce this replaced, so reinstating one
     * reddens it.
     */
    const h = await mountLoaded(SETTINGS, SEEDED);

    // A COMPLETE, VALID document — the hard case, because a half-typed value that happens to parse
    // is exactly what the old debounce applied.
    typeDocument(h.editor, VALID_MATRIX);
    await settle(PAST_THE_OLD_DEBOUNCE);
    expect(
      h.write,
      'a valid buffer must NOT be written while the user is still editing it',
    ).not.toHaveBeenCalled();

    // …and an invalid one, which must obviously not reach the file either.
    typeDocument(h.editor, MID_EDIT);
    await settle(PAST_THE_OLD_DEBOUNCE);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('applies the buffer when the user LEAVES, and applies exactly what is in it', async () => {
    const h = await mountLoaded(SETTINGS, SEEDED);
    typeDocument(h.editor, VALID_MATRIX);

    fireEvent.click(screen.getByTestId('host-leave'));

    await waitFor(() => expect(h.write).toHaveBeenCalledTimes(1));
    expect(h.write).toHaveBeenCalledWith({ kind: 'settings' }, VALID_MATRIX);
  });

  it('offers no editor until the document has loaded, so a late load cannot swallow an edit', async () => {
    /*
     * The load is a round trip and the tab mounts before it answers. With an editor on screen in that
     * gap, an edit typed there was replaced by the answer when it landed — and the answer also marked
     * the buffer clean, so leaving wrote nothing. `preferences-json.e2e.ts:300` failed that way on a
     * slow runner: the window closed, and settings.json still held the old theme.
     *
     * The answer is held here until the test lets it go, which is the only way to make the gap
     * deterministic. RED against a tab that renders its editor unconditionally: the edit goes in,
     * the load replaces it, and the leave writes nothing.
     */
    const cfg = fakeConfig(SEEDED);
    let answer!: (raw: string) => void;
    cfg.bridge.readRaw.mockImplementationOnce(
      () => new Promise<string>((resolve) => (answer = resolve)),
    );
    (window as unknown as { throng?: unknown }).throng = { config: cfg.bridge };
    render(
      createElement(
        NotificationProvider,
        null,
        createElement(
          JsonEditGateProvider,
          null,
          createElement(GateHost),
          createElement(JsonTab, { docId: SETTINGS }),
        ),
      ),
    );
    await screen.findByTestId('json-tab-settings');

    // The user gets in first, if the tab lets them.
    const early = screen.queryByTestId('json-editor-settings') as HTMLTextAreaElement | null;
    if (early) typeDocument(early, VALID_MATRIX);

    await act(async () => {
      answer(SEEDED.settings);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (early) {
      // What a pre-load editor costs the user: they leave, and their edit is not what lands.
      fireEvent.click(screen.getByTestId('host-leave'));
      await settle(50);
      expect(cfg.write, 'the edit typed before the load answered was lost').toHaveBeenCalledWith(
        SETTINGS,
        VALID_MATRIX,
      );
    }
    expect(early, 'the editor was offered before its document had loaded').toBeNull();

    // Once it has, it holds the document — and an edit made now is the one that leaving applies.
    const editor = (await screen.findByTestId('json-editor-settings')) as HTMLTextAreaElement;
    expect(editor.value).toBe(SEEDED.settings);
    typeDocument(editor, VALID_MATRIX);
    fireEvent.click(screen.getByTestId('host-leave'));
    await waitFor(() => expect(cfg.write).toHaveBeenCalledWith(SETTINGS, VALID_MATRIX));
  });

  it('writes nothing on leaving a buffer the user never touched', async () => {
    // `commit` returns early when the buffer is clean. Writing an unchanged document anyway would
    // touch the file's timestamp, wake the watcher and broadcast a change nobody made.
    const h = await mountLoaded(SETTINGS, SEEDED);
    fireEvent.click(screen.getByTestId('host-leave'));
    await settle(50);
    expect(h.write).not.toHaveBeenCalled();
  });
});

describe('FR-017 — the standing warning', () => {
  it('states the rule in full and names the document it is about', async () => {
    await mountLoaded(SETTINGS, SEEDED);
    const warning = screen.getByTestId('json-unsaved-warning');
    expect(warning).toHaveTextContent(
      'This file will not be saved until you switch back to the UI, switch tab, or close preferences',
    );
    // It names the document, because "this file" is ambiguous in a window with three of them.
    expect(warning.querySelector('strong') as HTMLElement).toHaveTextContent('settings.json');
    expect(warning).toHaveTextContent('may result in data loss');
  });

  it.each([
    {
      what: 'the key bindings document',
      docId: { kind: 'keybindings' } as ConfigDocId,
      files: { keybindings: '{}\n' },
      fileName: 'keybindings.json',
    },
    {
      what: 'a theme document, named after the theme',
      docId: { kind: 'theme', name: 'Matrix' } as ConfigDocId,
      files: { 'theme:Matrix': '{"name":"Matrix"}\n' },
      fileName: 'Matrix.json',
    },
  ])('names $what rather than always settings.json', async ({ docId, files, fileName }) => {
    // The E2E reached only settings and keybindings, because selecting a theme first is a whole
    // extra journey. The theme document's name is derived from `docId.name`, and that is the branch
    // a hardcoded "settings.json" would survive.
    await mountLoaded(docId, files);
    expect(
      screen.getByTestId('json-unsaved-warning').querySelector('strong') as HTMLElement,
    ).toHaveTextContent(fileName);
  });

  it('yields its slot to the error as the document breaks, and takes it back when it is fixed', async () => {
    /*
     * That the two are alternatives is `preferences-json-notice.test.ts`'s claim, given problems.
     * What is proved here is the round trip the user performs: typing invalid text PRODUCES the
     * problems, and fixing it removes them.
     */
    const h = await mountLoaded(SETTINGS, SEEDED);
    expect(screen.getByTestId('json-unsaved-warning')).toBeVisible();

    typeDocument(h.editor, MID_EDIT);
    expect(screen.getByTestId('json-invalid')).toBeVisible();
    expect(
      screen.queryByTestId('json-unsaved-warning'),
      'the warning and the error share one slot',
    ).toBeNull();

    typeDocument(h.editor, VALID_MATRIX);
    expect(screen.queryByTestId('json-invalid')).toBeNull();
    expect(screen.getByTestId('json-unsaved-warning')).toBeVisible();
  });
});

describe('FR-018a — Discard', () => {
  it('restores the document in effect, clears the notice, and leaves the editor open', async () => {
    const h = await mountLoaded(SETTINGS, SEEDED);
    typeDocument(h.editor, MID_EDIT);
    expect(screen.getByTestId('json-invalid')).toBeVisible();

    fireEvent.click(screen.getByTestId('json-discard'));

    expect(screen.queryByTestId('json-invalid')).toBeNull();
    expect(h.editor.value).toBe(SEEDED.settings);
    // The user has abandoned an edit, not left the editor.
    expect(screen.getByTestId('json-tab-settings')).toBeVisible();
  });

  it('is a no-op on the FILE — discarding writes nothing', async () => {
    // Stronger than the E2E, which never checked. A Discard that restored the baseline and then
    // committed it would write a document nobody changed, and would look identical on screen.
    const h = await mountLoaded(SETTINGS, SEEDED);
    typeDocument(h.editor, MID_EDIT);
    fireEvent.click(screen.getByTestId('json-discard'));
    await settle(50);
    expect(h.write).not.toHaveBeenCalled();
  });
});

describe('an external change (015 FR-013b)', () => {
  it('a CLEAN buffer follows the file silently, with no notice', async () => {
    /*
     * If the user has typed nothing there is nothing of theirs to protect, so showing the file is
     * simply showing the truth — and a notice would be reporting an event with no consequence. It is
     * also what 015 FR-013b requires: a reset pressed from the toolbar while the JSON view is open
     * must refresh the visible document, and pressing a button is not typing.
     */
    const h = await mountLoaded(SETTINGS, { settings: '{"appearance":{"theme":"Matrix"}}\n' });

    await h.external(SETTINGS, '{"appearance":{"theme":"Cyberpunk"}}\n');

    await waitFor(() => expect(h.editor.value).toContain('Cyberpunk'));
    expect(
      screen.queryByTestId('json-external-change'),
      'a clean buffer following the file is not an event worth a notice',
    ).toBeNull();
  });

  it('a DIRTY buffer keeps the user’s text and offers the choice', async () => {
    /*
     * The complement, and it is here on purpose: without it the test above passes just as well
     * against a build that NEVER raises the notice, which is the worse of the two defects. The E2E
     * that stays (`preferences-json.e2e.ts:672`) proves this same branch through a real file watcher
     * and a real caret; what is proved here is only which branch was chosen.
     */
    const h = await mountLoaded(SETTINGS, { settings: '{"appearance":{"theme":"Matrix"}}\n' });
    typeDocument(h.editor, '{"appearance":{"theme":"throng"}}');

    await h.external(SETTINGS, '{"appearance":{"theme":"Cyberpunk"}}\n');

    const external = await screen.findByTestId('json-external-change');
    expect(external).toHaveTextContent('settings.json');
    expect(external).toHaveTextContent('has changed on disk');
    expect(h.editor.value, 'the document must not be swapped under the user').toContain('throng');
  });
});

describe('#707 — the document is switched underneath the editor (032 FR-017 / FR-020a)', () => {
  /*
   * The Themes JSON view edits the ACTIVE theme's file, and the shell passes it the active theme's
   * name — which is hot-reloaded. Change `appearance.theme` anywhere else (a text editor on
   * settings.json, another window) and the tab is handed another document while it holds an edit of
   * the first. It used to tear down the gate without committing and load the other theme over the
   * buffer: the edit vanished, nothing was written, and nothing said so.
   */
  const ALPHA: ConfigDocId = { kind: 'theme', name: 'Alpha' };
  const BETA: ConfigDocId = { kind: 'theme', name: 'Beta' };
  const THEMES = {
    'theme:Alpha': '{"name":"Alpha"}\n',
    'theme:Beta': '{"name":"Beta"}\n',
  };
  const EDITED_ALPHA = '{"name":"Alpha","colors":{"background":"#101010"}}';
  const editorNow = (): HTMLTextAreaElement =>
    screen.getByTestId('json-editor-theme') as HTMLTextAreaElement;

  it('keeps a DIRTY buffer and says the active theme changed, and leaving writes it to ITS theme', async () => {
    const h = await mountLoaded(ALPHA, THEMES);
    typeDocument(h.editor, EDITED_ALPHA);

    await h.retarget(BETA);
    await settle(20);

    expect(editorNow().value, 'the unsaved edit was replaced by the other theme').toBe(EDITED_ALPHA);
    const notice = screen.getByTestId('json-external-change');
    expect(notice).toHaveTextContent('Alpha.json');
    expect(notice).toHaveTextContent('Beta');
    expect(h.write, 'nothing is written while the user is still editing (FR-017)').not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('host-leave'));
    await waitFor(() => expect(h.write).toHaveBeenCalledTimes(1));
    expect(h.write).toHaveBeenCalledWith(ALPHA, EDITED_ALPHA);
  });

  it('Overwrite With These Changes saves the edit to its theme, then follows the active one', async () => {
    const h = await mountLoaded(ALPHA, THEMES);
    typeDocument(h.editor, EDITED_ALPHA);
    await h.retarget(BETA);

    await act(async () => {
      fireEvent.click(screen.getByTestId('json-external-overwrite'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(h.write).toHaveBeenCalledWith(ALPHA, EDITED_ALPHA);
    await waitFor(() => expect(editorNow().value).toBe(THEMES['theme:Beta']));
    expect(screen.queryByTestId('json-external-change')).toBeNull();
  });

  it('Reload From Disk drops the edit, writes nothing, and follows the active theme', async () => {
    const h = await mountLoaded(ALPHA, THEMES);
    typeDocument(h.editor, EDITED_ALPHA);
    await h.retarget(BETA);

    await act(async () => {
      fireEvent.click(screen.getByTestId('json-external-reload'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(editorNow().value).toBe(THEMES['theme:Beta']));
    expect(screen.queryByTestId('json-external-change')).toBeNull();
    fireEvent.click(screen.getByTestId('host-leave'));
    await settle(20);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('a CLEAN buffer follows the new document silently', async () => {
    // The complement: without it the tests above pass against a tab that never follows at all.
    const h = await mountLoaded(ALPHA, THEMES);
    await h.retarget(BETA);

    await waitFor(() => expect(editorNow().value).toBe(THEMES['theme:Beta']));
    expect(screen.queryByTestId('json-external-change')).toBeNull();
    expect(h.write).not.toHaveBeenCalled();
  });
});
