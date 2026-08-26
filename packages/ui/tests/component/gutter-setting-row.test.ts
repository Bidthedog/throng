/**
 * `editor.showGutter` is an editable row on the visual Settings form (040 US4 — FR-053, FR-040).
 *
 * ══ WHY THIS IS A SEPARATE CLAIM FROM THE DESCRIPTOR TEST ══
 *
 * `packages/core/tests/unit/settings-gutter-040.test.ts` proves a DESCRIPTOR exists. That is not
 * the same claim as a row appearing — the metadata completeness gate stays green for a setting the
 * form never renders, which is exactly the failure Principle X's configuration-editor rule exists
 * to stop. `settings-tab-subgroups.test.ts` draws the same distinction for the two
 * `editor.statusBar.*` toggles and reaches only those; FR-053 covers all THREE new settings, so
 * this file is the third one's half.
 *
 * ══ WHY THE COMPONENT TIER ══
 *
 * The claim is about a rendered tree — an `input` exists, it is a checkbox, it is not disabled, and
 * it sits under the right heading. jsdom renders all of that. Nothing here is a measurement, and
 * the E2E that opens the preferences window is about a real window, not about a form row.
 *
 * ══ THE ANTI-VACUITY CONTROL ══
 *
 * Change `KEY` below to a setting no descriptor declares and every test here fails on the missing
 * row rather than passing on an absence. The `not.toContainElement` assertion is the one that could
 * pass vacuously, which is why it first proves the subsection AND the row are both present.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const KEY = 'editor.showGutter';
const GROUP = 'Editor';
/** The 040 status-bar subsection — the heading this setting must NOT end up under. */
const STATUS_BAR_ID = `settings-subgroup-${GROUP}-Status Bar`;

function mount(): void {
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(
        ResetNoticeProvider,
        null,
        createElement(ConfirmProvider, null, createElement(SettingsTab, {})),
      ),
    ),
  );
}

describe('the gutter toggle is reachable from the visual editor (FR-053)', () => {
  it('renders a row for editor.showGutter', () => {
    mount();
    expect(screen.getByTestId(`setting-${KEY}`)).toBeInTheDocument();
  });

  it('renders it as an editable checkbox, ticked, because the gutter ships on', () => {
    mount();
    const control = screen.getByTestId(`control-${KEY}`) as HTMLInputElement;
    expect(control.tagName).toBe('INPUT');
    expect(control.type).toBe('checkbox');
    // Not inert. A disabled control satisfies "a row appears" and satisfies nothing a user wants.
    expect(control.disabled, 'it must be editable, not inert').toBe(false);
    expect(control.checked, 'the gutter ships on (FR-040)').toBe(true);
  });

  it('shows the hand-written label beside it', () => {
    mount();
    const row = screen.getByTestId(`setting-${KEY}`);
    // The row carries prose a person wrote, not the key echoed back at the reader.
    expect(row.textContent ?? '').toMatch(/gutter/i);
    expect(row.textContent ?? '').not.toContain(KEY);
  });
});

describe('it sits under Editor, loose — not in the Status Bar subsection (FR-040)', () => {
  it('renders inside the Editor group section', () => {
    mount();
    expect(screen.getByTestId(`settings-group-${GROUP}`)).toContainElement(
      screen.getByTestId(`setting-${KEY}`),
    );
  });

  it('is not inside the Status Bar subsection', () => {
    mount();
    // Both halves proved present FIRST, so this cannot pass because either one failed to render —
    // which is how a containment assertion goes vacuous.
    const subsection = screen.getByTestId(STATUS_BAR_ID);
    const row = screen.getByTestId(`setting-${KEY}`);
    expect(subsection).not.toContainElement(row);
  });

  it('renders ABOVE the Status Bar subsection, with the other ungrouped Editor rows (FR-036b)', () => {
    mount();
    const row = screen.getByTestId(`setting-${KEY}`);
    const position = row.compareDocumentPosition(screen.getByTestId(STATUS_BAR_ID));
    expect(
      position & Node.DOCUMENT_POSITION_FOLLOWING,
      'a subgroup-less row must come BEFORE a subsection heading it does not belong to',
    ).toBeTruthy();
  });
});
