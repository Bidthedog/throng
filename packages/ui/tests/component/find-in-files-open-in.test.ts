/**
 * 043 T228 (FR-087, FR-087c, FR-087d) — Open In on a result row.
 *
 * ══ WHAT THIS COVERS THAT `open-in-targets.test.ts` CANNOT ══
 *
 * The unit test owns the DECISION: which targets exist, what they are called, which are disabled.
 * Nothing here re-asserts any of that. What only a mounted panel can show is the WIRING — that the
 * menu asks about the row the user pointed at and no other, that a chosen target is sent back with
 * the row's own range attached, and that the parent is drawn disabled rather than vanishing when
 * the menu names no file.
 *
 * ══ THE PROPERTY THIS FILE EXISTS TO PROTECT ══
 *
 * `renderFindInFilesPanel` mounts the panel with NO WORKSPACE PROVIDER, and every test below passes
 * that way. That is not incidental: the panel deliberately holds no workspace store, which is why
 * the Open In targets arrive through a registration instead of being computed in the menu. A future
 * refactor that "simplified" this by calling `useWorkspace()` in the panel would fail every test in
 * this file with a missing-provider error — which is the failure worth having, because the cost it
 * would otherwise impose is a provider in all twenty-five of this panel's component suites.
 *
 * The stub registered below IS what the chrome does, narrowed to one call: `FindInFilesChrome`
 * registers `listResultOpenTargets` bound to the workspace store, and the panel only ever sees the
 * plain data that comes back.
 *
 * ANTI-VACUITY CONTROL, run rather than reasoned about: in `find-in-files-panel.tsx`, drop the
 * `openInRow ? … : []` guard so the targets are queried unconditionally. **All three of the
 * names-no-file tests fail** — over a group heading, over the toolbar, and over the status line.
 * The menu then offers live targets for a file the user did not point at, which is the exact defect
 * the reading-position clearing exists to prevent for the commit rows.
 *
 * The status-line case was not predicted and is the reason for running the control: the three
 * surfaces reach the handler by different routes, so they are three assertions rather than one
 * restated three times.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  registerResultOpener,
  registerResultOpenTargets,
  type ResultOpenRequest,
} from '../../src/renderer/find-in-files/result-open.js';
import type { OpenInTarget } from '../../src/renderer/editor/open-in-targets.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  resultRow,
  type FileSearchStub,
} from './helpers/find-in-files.js';

let stub: FileSearchStub;
let opened: ResultOpenRequest[];
let askedFor: string[];

/** Two matches in one file and one in another, so "which row" is a question with a wrong answer. */
const ROWS = [
  resultRow('src/a.ts', 1, 6),
  resultRow('src/a.ts', 4, 80),
  resultRow('src/b.ts', 2, 40),
];

/**
 * What the chrome would answer. Fixed rather than derived, because this file is not testing the
 * decision — it is testing that whatever the decision says arrives on the menu intact.
 */
const TARGETS: OpenInTarget[] = [
  { kind: 'lastActive', label: 'Last Active Editor (Scratch)', disabled: false },
  { kind: 'new', label: 'New Editor', disabled: true },
  { kind: 'tab', tabId: 'tab-2', label: 'Docs', disabled: false },
];

beforeEach(() => {
  __resetFindInFilesState();
  stub = installFileSearchStub();
  opened = [];
  askedFor = [];
  registerResultOpener((request) => void opened.push(request));
  registerResultOpenTargets(async (relPath) => {
    askedFor.push(relPath);
    return TARGETS;
  });
});

afterEach(() => {
  registerResultOpener(null);
  registerResultOpenTargets(null);
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Render, search, deliver rows. Replace is never disclosed here — Open In is not a commit. */
async function ready(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderFindInFilesPanel();
  await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), 'needle{Enter}');
  stub.emit({ panelId: PANEL_ID, generation: 1, status: 'complete', rows: ROWS, totalMatches: 3 });
  return user;
}

const rightClick = async (
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
): Promise<void> => {
  await user.pointer({ target: screen.getByTestId(testId), keys: '[MouseRight]' });
};

/** Open the flyout and hand back its container. */
const openFlyout = async (user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
  await user.click(screen.getByTestId('menu-item-Open In'));
  return screen.getByTestId('submenu-Open In');
};

describe('the menu asks about the row it was opened from (FR-087)', () => {
  it('offers the targets for that row, and names the file it asked about', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/b.ts-40');

    expect(screen.getByTestId('menu-item-Open In')).toHaveAttribute('aria-disabled', 'false');
    expect(askedFor).toEqual(['src/b.ts']);
  });

  it('lays the targets out exactly as the shared builder gives them, disabled states and all', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    const flyout = await openFlyout(user);

    // Order and labels are the unit test's business; what matters here is that NONE of it was
    // re-authored on the way through — the panel draws what it was handed.
    expect(within(flyout).getByTestId('menu-item-Last Active Editor (Scratch)')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(within(flyout).getByTestId('menu-item-New Editor')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(flyout).getByTestId('menu-item-Other Tab')).toBeTruthy();
  });

  it('asks again, about the new row, when the menu is reopened elsewhere', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.keyboard('{Escape}');
    await rightClick(user, 'fif-row-src/b.ts-40');

    // The second answer must be about b.ts. A menu that cached the first would offer targets
    // computed for a different file, and nothing on screen would say so.
    expect(askedFor).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('choosing a target sends the row, with its match (FR-087c)', () => {
  it('hands back the chosen target together with the row that was pointed at', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-80');
    const flyout = await openFlyout(user);
    await user.click(within(flyout).getByTestId('menu-item-Last Active Editor (Scratch)'));

    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      relPath: 'src/a.ts',
      // The RANGE goes with it. Without this the file opens and the user is left to find the match
      // themselves, which is the whole of FR-038 undone by a menu that only carried a path.
      from: 80,
      target: { kind: 'lastActive' },
    });
  });

  it('sends a tab target with its tab id, from inside the nested flyout', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/b.ts-40');
    const flyout = await openFlyout(user);
    await user.click(within(flyout).getByTestId('menu-item-Other Tab'));
    await user.click(within(screen.getByTestId('submenu-Other Tab')).getByTestId('menu-item-Docs'));

    expect(opened[0]).toMatchObject({ relPath: 'src/b.ts', target: { kind: 'tab', tabId: 'tab-2' } });
  });

  it('does nothing at all when a disabled target is clicked', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    const flyout = await openFlyout(user);
    await user.click(within(flyout).getByTestId('menu-item-New Editor'));

    expect(opened).toEqual([]);
  });
});

describe('drawn and disabled where the menu names no file (FR-087d)', () => {
  /*
   * The three surfaces that reach the panel's handler without naming a row. Each is a separate test
   * rather than a loop, because they fail for different reasons if they fail at all: a heading has
   * no context-menu handler of its own, the toolbar is outside the list entirely, and the status
   * line sits below it.
   */
  it('over a group heading — which names a file on screen but never sets the reading position', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.keyboard('{Escape}');
    await rightClick(user, 'fif-group-header-src/b.ts');

    expect(screen.getByTestId('menu-item-Open In')).toHaveAttribute('aria-disabled', 'true');
    // And it asked about nothing — the b.ts heading must not resurrect a.ts's position.
    expect(askedFor).toEqual(['src/a.ts']);
  });

  it('over the toolbar', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.keyboard('{Escape}');
    await rightClick(user, `fif-term-${PANEL_ID}`);

    expect(screen.getByTestId('menu-item-Open In')).toHaveAttribute('aria-disabled', 'true');
  });

  it('over the status line', async () => {
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');
    await user.keyboard('{Escape}');
    await rightClick(user, `fif-status-${PANEL_ID}`);

    expect(screen.getByTestId('menu-item-Open In')).toHaveAttribute('aria-disabled', 'true');
  });

  it('is drawn, and disabled, when no chrome is mounted to answer', async () => {
    // A window mid-teardown. Not an error to report — the user right-clicked a panel that is going
    // away — so the row states what it always states: this cannot be done right now.
    registerResultOpenTargets(null);
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');

    expect(screen.getByTestId('menu-item-Open In')).toHaveAttribute('aria-disabled', 'true');
  });

  it('never opens anything from a disabled parent', async () => {
    const user = await ready();
    await rightClick(user, `fif-term-${PANEL_ID}`);
    await user.click(screen.getByTestId('menu-item-Open In'));

    expect(opened).toEqual([]);
  });
});

describe('the panel still needs no workspace store', () => {
  it('renders, searches and builds the whole menu with no workspace provider', async () => {
    /*
     * The guard for the property in this file's header. `renderFindInFilesPanel` supplies a context
     * menu provider and nothing else — no workspace, no projects, no settings — and the menu below
     * is fully built, Open In included. `useWorkspace()` anywhere in the panel makes this throw.
     */
    const user = await ready();
    await rightClick(user, 'fif-row-src/a.ts-6');

    expect(screen.getByTestId('menu-item-Open In')).toBeTruthy();
    expect(screen.getByTestId('menu-item-Run search')).toBeTruthy();
    expect(vi.mocked(stub.start)).toHaveBeenCalled();
  });
});
