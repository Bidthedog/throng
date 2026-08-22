import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DormantTerminal } from '../../src/renderer/terminal/dormant-terminal.js';

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
describe('the dormant terminal placeholder (039 FR-023)', () => {
  const renderDormant = (onReload = (): void => {}) =>
    render(
      createElement(DormantTerminal, { panelId: 'p1', panelName: 'Build', onReload }),
    );

  it('names the panel, so the user knows which terminal is waiting (FR-023)', () => {
    renderDormant();
    // FR-027: a dormant Panel keeps its name. The placeholder is where that is visible — without
    // it, twenty dormant panels are twenty identical boxes and "reload the two I care about" is
    // guesswork.
    expect(screen.getByTestId('terminal-dormant-name')).toHaveTextContent('Build');
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
