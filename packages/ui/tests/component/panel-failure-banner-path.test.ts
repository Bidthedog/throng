/**
 * 041 FR-019/FR-019a — A PANEL'S FAILURE BANNER PRINTS ITS PATH ONCE.
 *
 * ══ THIS IS A GUARD, NOT A FIX ══
 *
 * FR-019 is ALREADY honoured, and that is precisely why it needs asserting. Both panel types compose
 * a path-free headline — `'This file could not be read'` (`editor-failure.ts`) and `'This terminal
 * could not be opened'` (`terminal-panel.tsx`) — beside a single rendered `detail.path`. Nothing
 * prints it twice today.
 *
 * A requirement that is true with nothing watching it is EXACTLY the shape 029 FR-016, FR-019 and
 * 030 FR-037a had immediately before they stopped being true — which is the entire subject of this
 * feature. So FR-019 takes a guard under FR-028 like every other restored requirement, and takes no
 * implementation task, because writing one would mean changing code that is already correct.
 *
 * It also caught a real trap in the spec's own analysis: FR-019 originally had ZERO tasks, and the
 * first instinct on finding that was to write an implementation for it.
 *
 * ══ WHAT IS ASSERTED ══
 *
 * The COUNT of occurrences, not the presence of the path. Asserting presence would pass just as
 * happily against a banner that printed it three times, which is the failure mode the requirement
 * names.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanelFailureBanner } from '../../src/renderer/common/panel-failure-banner.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';

beforeEach(() => {
  // The banner raises a notice when a RETRY fails, so it calls useNotify() — which needs a provider,
  // which needs the config store. None of that is what these tests are about; it is the minimum tree
  // in which the component renders at all.
  (window as unknown as { throng: unknown }).throng = {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: {} }) },
    osName: 'windows',
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

/** The banner inside the smallest tree that lets it mount. */
function renderBanner(props: Record<string, unknown>): void {
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(PanelFailureBanner, { panelId: 'p1', ...props } as never),
      ),
    ),
  );
}

const PATH = 'D:\\proj\\src\\missing.ts';

/** How many times `PATH` appears in everything the banner renders. */
function pathOccurrences(): number {
  const text = screen.getByTestId('panel-failure-p1').textContent ?? '';
  return text.split(PATH).length - 1;
}

describe('a panel failure banner names its path exactly once (FR-019, FR-019a)', () => {
  it('does so for the EDITOR banner — headline plus one path', () => {
    renderBanner({
        headline: 'This file could not be read',
        subject: 'Proj — Tab — Panel',
        detail: { path: PATH, systemError: `ENOENT: no such file or directory, open '${PATH}'` },
      });

    expect(pathOccurrences(), 'the banner printed its path more than once').toBe(1);
  });

  // DELETED: 'does so for the TERMINAL banner' — one component renders both banners; only the
  // headline text differs, so the EDITOR case above proves the rule.

  it('renders no path at all when there is none to render', () => {
    renderBanner({
        headline: 'This file could not be read',
        subject: 'Proj — Tab — Panel',
        detail: { systemError: 'io' },
      });

    expect(pathOccurrences()).toBe(0);
  });

  // DELETED: 'still keeps the RAW system error off the screen' — panel-failure-banner.test.ts 'never
  // renders the raw system error (FR-034)' asserts it for the same banner; the first case here also
  // carries an ENOENT string and counts the path once.
});
