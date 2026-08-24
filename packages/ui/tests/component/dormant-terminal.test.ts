import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { DormantTerminal } from '../../src/renderer/terminal/dormant-terminal.js';
import { clearTerminalTitle, setTerminalTitle } from '../../src/renderer/terminal/title-store.js';

/*
 * 039 FR-023/FR-027/FR-029 (#293) — the placeholder a terminal Panel shows when Manual reload mode
 * has left it dormant.
 *
 * At the component layer because that is the lowest layer that can see it. What the placeholder
 * SAYS, what it OFFERS, and what it must NOT look like are all DOM questions; an Electron window
 * adds nothing. The one claim that genuinely needs a window and a real process table — FR-026, that
 * a dormant Panel holds no PTY, no shell and no conhost — is the single E2E this story earns, and
 * it is not this file.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Change the component to render `null`. Every test below fails in its first assertion rather than
 * passing vacuously, because each asserts the PRESENCE of something before asserting anything about
 * it. There is no test here that a blank render would satisfy.
 */
/**
 * A dormant terminal Panel, as the layout holds it.
 *
 * `title` is the PLACEHOLDER the layout numbers panels with; `config.flavourLabel` is captured when
 * the type is confirmed. That pairing is the whole of the naming bug below: the panel wears
 * "Command Prompt" everywhere else and the placeholder was showing "Panel 3".
 */
function dormantPanel(over: Partial<Panel> = {}): Panel {
  return {
    type: 'panel',
    id: 'p1',
    originProjectId: 'proj',
    title: 'Panel 3',
    kind: 'terminal',
    dormant: true,
    config: { flavourId: 'cmd', flavourLabel: 'Command Prompt' },
    ...over,
  } as Panel;
}

afterEach(() => {
  clearTerminalTitle('p1');
});

describe('the dormant terminal placeholder (039 FR-023)', () => {
  const renderDormant = (onReload = (): void => {}, panel: Panel = dormantPanel()) =>
    render(createElement(DormantTerminal, { panel, onReload }));

  /*
   * #294, AGAIN — and that is why this is a structural fix rather than a string change.
   *
   * `panelDisplayTitle` has been the one place a panel's name is decided since #218. #294 was that
   * rule "starved of its inputs": the tab popover called it with no sources, so every automatically
   * named panel was listed as its placeholder. `usePanelDisplayNames` exists because of it.
   *
   * This placeholder was handed `panel.title` — the raw stored title — which is the same defect
   * arriving by a shorter route, in the same PR that fixed the popover's siblings. A user renames
   * nothing, opens a project in Manual mode, and sees "Panel 3" in the body of a panel whose own
   * header, one line above, says "Command Prompt".
   */
  it('names the panel the way the panel names itself, not by its stored title (#294)', () => {
    renderDormant();
    expect(screen.getByTestId('terminal-dormant-name')).toHaveTextContent('Command Prompt');
  });

  it('a name the user typed outranks the flavour, exactly as the header does', () => {
    renderDormant(undefined, dormantPanel({ title: 'Build', titleIsCustom: true }));
    // FR-027: a dormant Panel keeps its name. The placeholder is where that is visible — without
    // it, twenty dormant panels are twenty identical boxes and "reload the two I care about" is
    // guesswork.
    expect(screen.getByTestId('terminal-dormant-name')).toHaveTextContent('Build');
  });

  /*
   * The one source a dormant panel genuinely cannot have, asserted so the resolver is not merely
   * assumed to be in the loop.
   *
   * A dormant panel holds no shell (FR-026), so there is no live OSC 0/2 window title — the
   * flavour label is what names it. But the store is keyed by panel id and outlives an unmount, so
   * a panel that HAD a terminal and was later left dormant can still have one; when it does, it
   * must win, because that is what the header and the tab popover both do. Anything that resolved
   * the name from `panel.config` alone would fail here.
   */
  it('a live window title still wins where one exists, as everywhere else', () => {
    setTerminalTitle('p1', 'ISSUE MANAGEMENT');
    renderDormant();
    expect(screen.getByTestId('terminal-dormant-name')).toHaveTextContent('ISSUE MANAGEMENT');
  });

  it('offers Reload on the panel itself (FR-023)', () => {
    renderDormant();
    expect(screen.getByTestId('terminal-dormant-reload')).toBeVisible();
  });

  it('runs the reload action when that button is pressed', async () => {
    const onReload = vi.fn();
    renderDormant(onReload);
    await userEvent.click(screen.getByTestId('terminal-dormant-reload'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  /*
   * FR-029, and the reason it is a requirement rather than a style note.
   *
   * Dormancy is a state the user CHOSE by setting Manual. Reporting it through the failure
   * surfaces would tell them something is wrong when nothing is, and the repository's "one
   * condition, one notice" rule exists because exactly that kind of over-reporting shipped once
   * before (spec 032 raised one invalid document as three separate notices).
   *
   * `panel-failure-notice` is the testid the real failure banner uses, so its absence here is a
   * genuine check rather than a check against a string this file invented.
   */
  it('is NOT a failure — no banner, no notice, no error role (FR-029)', () => {
    const { container } = renderDormant();
    expect(screen.queryByTestId('panel-failure-notice')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('.panel-failure-banner')).toBeNull();
  });

  /*
   * The placeholder has to explain ITSELF, because the user meets it without having asked for it —
   * they opened a project and their terminals did not start. Naming the preference is what turns
   * "why is this empty?" into "ah, I set that". Asserted on the preference's own wording so the
   * two cannot drift apart silently.
   */
  it('points at the preference that caused it', () => {
    renderDormant();
    expect(screen.getByTestId('terminal-dormant-p1')).toHaveTextContent(/Manual/);
    expect(screen.getByTestId('terminal-dormant-p1')).toHaveTextContent(
      /Reload terminals when a project opens/,
    );
  });
});
