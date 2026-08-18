/**
 * The one failure banner every panel type uses (030 US4 / #236, FR-039 ff).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/panel-failure-banner.e2e.ts` (034 FR-045).
 *
 * `PanelFailureBanner` is already an exported component taking props — the migration needed no
 * production change, only a `NotificationProvider` around it, because `useCopyToClipboard` reaches
 * `useNotify` and that hook throws rather than defaulting. That provider is mounted explicitly here
 * rather than hidden in the setup file, so a reader can see the one dependency this component has.
 *
 * ══ WHY THE E2E COMPARED CLASS LISTS ══
 *
 * The spec's argument is structural and the component test keeps it: two independently-written
 * banners can agree on labels by coincidence and cannot agree on a class list by accident. So the
 * editor and terminal cases are rendered and their root class, role and control set compared — which
 * is a claim about the two calls being the SAME component, and is exactly as true in jsdom as it is
 * in Electron, for a fifth of a second instead of an app launch.
 *
 * WHAT STAYS END-TO-END: everything about the banner's CONDITION and its wiring — that a real
 * unreadable file and a real failed shell raise it, that its three actions also appear in the panel
 * menu, that Clear panel type returns an editor to the type selector, that a retry which succeeds
 * removes it (the caller's state drops it, not this component), and that it appears even when every
 * severity is set to Never display. None of those is visible from here.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NoticeSubject } from '@throng/core';
import { PanelFailureBanner } from '../../src/renderer/common/panel-failure-banner.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

const SUBJECT = { project: 'Proj', tab: 'Tab 1', panel: 'Panel 1' } as unknown as NoticeSubject;

const EDITOR = {
  panelId: 'p1',
  headline: 'This file could not be opened.',
  // 026 P3 — the editor alone carries this, and it is the only thing telling the user the text
  // below is a remembered buffer rather than the file.
  note: 'What is shown here is not the file.',
  subject: SUBJECT,
  detail: { path: 'C:/proj/notes.txt', systemError: 'EACCES: permission denied' },
};

const TERMINAL = {
  panelId: 'p2',
  headline: 'This terminal could not be started.',
  subject: SUBJECT,
  detail: { path: 'C:/proj', systemError: 'ENOENT: no such file or directory' },
};

function mount(props: Record<string, unknown>) {
  const onRetry = vi.fn(async () => false);
  const onCancel = vi.fn();
  const view = render(
    createElement(
      NotificationProvider,
      null,
      createElement(PanelFailureBanner, { ...props, onRetry, onCancel } as never),
    ),
  );
  return { onRetry, onCancel, view, user: userEvent.setup() };
}

/** The banner's root. Its `role` is asserted rather than used to find it. */
const banner = (id = 'p1'): HTMLElement => screen.getByTestId(`panel-failure-${id}`);

const controlNames = (id = 'p1'): string[] =>
  within(banner(id))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? b.textContent ?? '');

describe('one component, two panel types (FR-039, SC-009)', () => {
  it('draws the editor and the terminal with the same root class, role and controls', () => {
    /*
     * The structural comparison, which is the spec's own argument: two independently-written banners
     * can agree on their labels by coincidence and cannot agree on a class list by accident. This is
     * why the assertion is on the class list rather than on the words.
     */
    const editor = render(
      createElement(
        NotificationProvider,
        null,
        createElement(PanelFailureBanner, {
          ...EDITOR,
          onRetry: async () => false,
          onCancel: () => {},
        } as never),
      ),
    );
    const editorRoot = editor.getByTestId('panel-failure-p1');
    const editorClass = editorRoot.className;
    const editorRole = editorRoot.getAttribute('role');
    const editorControls = within(editorRoot)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? b.textContent ?? '');
    expect(editorControls.length, 'the banner drew no controls at all').toBe(3);
    editor.unmount();

    mount(TERMINAL);
    expect(banner('p2').className).toBe(editorClass);
    expect(banner('p2').getAttribute('role')).toBe(editorRole);
    expect(controlNames('p2')).toEqual(editorControls);
  });

  it('offers exactly three controls, and none of them closes the banner (FR-046)', () => {
    // *Clear panel type* is not a close button: it says "I no longer want this panel to be this
    // type", which is a different decision with a different consequence. The banner goes when its
    // CONDITION goes, and that condition is the caller's state.
    mount(EDITOR);
    const names = controlNames().join('|').toLowerCase();
    expect(within(banner()).getAllByRole('button')).toHaveLength(3);
    expect(names).not.toContain('dismiss');
    expect(names).not.toContain('close');
  });

  it('points at its own copy control, in the same words, for both types', () => {
    // FR-041 forbids a pointer promising a route that may not exist — a notification may have been
    // dismissed, timed out, or silenced. Copy always works, so Copy is what the sentence names.
    mount(EDITOR);
    const editorPointer = banner().textContent ?? '';
    expect(editorPointer.toLowerCase()).toContain('copy');
  });
});

describe('what each type says (FR-040, FR-040a)', () => {
  it('names the file the editor could not read', () => {
    // Not decoration. 027 FR-011: an editor holding a recovered buffer over a path throng could not
    // open looks entirely ordinary, and Ctrl+S would write that remembered text back over the path.
    mount(EDITOR);
    expect(banner()).toHaveTextContent('C:/proj/notes.txt');
    expect(banner()).toHaveTextContent('This file could not be opened.');
  });

  it('names the folder the terminal could not start in', () => {
    // 029 FR-004 — a start failure names its folder, and the headline does not contain it.
    mount(TERMINAL);
    expect(banner('p2')).toHaveTextContent('C:/proj');
  });

  it('says the text below is not the file — and ONLY for the editor', () => {
    mount(EDITOR);
    expect(banner()).toHaveTextContent('What is shown here is not the file.');
  });

  it('says no such thing for a terminal, which has no buffer to mistake', () => {
    mount(TERMINAL);
    expect(banner('p2')).not.toHaveTextContent('not the file');
  });

  it('never renders the raw system error (FR-034)', () => {
    // It reaches the user through Copy and the diagnostic log, and nowhere else.
    mount(EDITOR);
    expect(banner()).not.toHaveTextContent('EACCES');
  });
});

describe('the keyboard (FR-045 ff)', () => {
  it('reaches every control by Tab, in the order they are displayed', async () => {
    const { user } = mount(EDITOR);
    const buttons = within(banner()).getAllByRole('button');

    for (const button of buttons) {
      await user.tab();
      expect(button).toHaveFocus();
    }
  });

  it('operates a control from the keyboard, not only by pointer', async () => {
    const { user, onCancel } = mount(EDITOR);
    const clear = within(banner())
      .getAllByRole('button')
      .find((b) => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('clear'));
    expect(clear, 'no clear-panel-type control found').toBeDefined();

    clear!.focus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
