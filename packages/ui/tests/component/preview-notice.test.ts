/**
 * 044 T106 — a preview's FILE notice (FR-026, FR-027, FR-028; US2 scenario 6;
 * contracts/menus-and-controls.md §9, contracts/preview-ipc.md §2 `update.notice`).
 *
 * ══ ONE CONDITION, ONE NOTICE ══
 *
 * Main owns the condition: the run's `notice` arrives on `throng:preview:update`, and this panel draws
 * it through the ONE shared `PanelFailureBanner` — never a toast, never a second element. A repeat of
 * the same condition (`repeat: true`, which main sets on a refresh that finds it unchanged) FLASHES the
 * banner already shown. The link notice (FR-090e) is a different condition with its own slot, and the
 * two never report the same thing.
 *
 * ══ WHAT EACH NOTICE OFFERS ══
 *
 * | Notice                                         | Actions                                   |
 * |------------------------------------------------|-------------------------------------------|
 * | unreadable, deleted, too-large, not-text       | Try again (= `preview.refresh`), Copy details |
 * | no-provider (FR-027)                           | Close — the panel goes, as Close Panel would |
 *
 * The whole panel is mounted — the real `PanelPlaceholder`, the shipped Markdown body — with main's
 * bridge faked, so each case is main's update exactly as it arrives.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PreviewNotice, PreviewNavigateResponse } from '@throng/core';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { focusPanel } from '../../src/renderer/workspace/panel-focus.js';
import { COLD, README, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreview } from './helpers/mount-preview-panel.js';

const DOC = '# Readme\n\nReadme body.\n\n[Gone](docs/missing.md) and [Setup](docs/setup.md)\n';

let m: MountedPreview | undefined;

async function mountDoc(): Promise<MountedPreview> {
  m = await mountMarkdownPreview(DOC);
  await screen.findByText('Readme body.', {}, COLD);
  return m;
}

const panel = (): MountedPreview => m!;
const banners = (): HTMLElement[] => screen.queryAllByTestId(`panel-failure-${panel().id}`);
const banner = (): HTMLElement => screen.getByTestId(`panel-failure-${panel().id}`);
const body = (): HTMLElement => screen.getByTestId(`preview-body-${panel().id}`);
const linkNotice = (): HTMLElement | null => screen.queryByTestId(`preview-link-notice-${panel().id}`);

function pushNotice(revision: number, notice: PreviewNotice | null, content: string | null = null): void {
  panel().push(
    previewUpdate({
      panelId: panel().id,
      revision,
      notice,
      content: content === null ? null : { kind: 'text', text: content },
    }),
  );
}

beforeEach(() => {
  __resetPreviewStore();
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

/** What each FR-026 condition says: what is wrong, never the raw kind and never what the user may not do. */
const FILE_NOTICES: { kind: 'unreadable' | 'deleted' | 'too-large' | 'not-text'; says: RegExp }[] = [
  { kind: 'deleted', says: /no longer exists/i },
  { kind: 'unreadable', says: /could not be read/i },
  { kind: 'too-large', says: /too large/i },
  { kind: 'not-text', says: /not text/i },
];

describe('each FR-026 notice is ONE shared failure banner with a human message', () => {
  for (const { kind, says } of FILE_NOTICES) {
    it(`${kind}: one PanelFailureBanner, its message, the file's path, Try again and Copy details`, async () => {
      await mountDoc();
      pushNotice(2, { kind });

      expect(banners()).toHaveLength(1);
      const b = banner();
      expect(b).toHaveClass('panel-failure');
      const headline = b.querySelector('.panel-failure__headline')?.textContent ?? '';
      expect(headline).toMatch(says);
      expect(headline).not.toContain(kind);
      expect(b.querySelector('.panel-failure__path')?.textContent).toContain('README.md');
      expect(within(b).getByTitle('Try again')).toBeInTheDocument();
      expect(within(b).getByTitle('Copy details')).toBeInTheDocument();
      expect(within(b).queryByTitle('Close')).toBeNull();
    });
  }

  it('fix round 1 (item 1) — the pointer names no notification, because none is raised (FR-026 as amended)', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'unreadable' });
    expect(banner().querySelector('.panel-failure__pointer')?.textContent).toBe('Copy the details here.');
    expect(banner()).not.toHaveTextContent(/notification/i);

    // 044 US3 — the no-provider banner offers Close only (FR-027 as amended), so it has no Copy control
    // for a pointer to name: it draws no pointer at all rather than one naming a route that is not there.
    pushNotice(3, { kind: 'no-provider' });
    expect(banner().querySelector('.panel-failure__pointer')).toBeNull();
    expect(banner()).not.toHaveTextContent(/notification/i);
  });

  it('says nothing while the run carries no notice', async () => {
    await mountDoc();
    expect(banners()).toHaveLength(0);
    expect(body()).toBeVisible();
  });
});

describe('Try again is Refresh (FR-028)', () => {
  it('calls preview.refresh for this panel, and the banner goes when the refreshed update carries no notice', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'unreadable' });
    panel().preview.refresh.mockImplementation(() =>
      Promise.resolve({
        update: previewUpdate({
          panelId: panel().id,
          revision: 3,
          notice: null,
          content: { kind: 'text', text: '# Readme\n\nRead again.\n' },
        }),
      }),
    );

    fireEvent.click(within(banner()).getByTitle('Try again'));

    await waitFor(() => expect(panel().preview.refresh).toHaveBeenCalledWith(panel().id));
    await waitFor(() => expect(banners()).toHaveLength(0));
    expect(await screen.findByText('Read again.')).toBeVisible();
  });

  it('a refresh that finds the same condition leaves ONE banner, flashing, and says the condition is still there', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'unreadable' });
    const first = banner();
    panel().preview.refresh.mockImplementation(() =>
      Promise.resolve({
        update: previewUpdate({ panelId: panel().id, revision: 3, notice: { kind: 'unreadable', repeat: true }, content: null }),
      }),
    );

    fireEvent.click(within(first).getByTitle('Try again'));

    await waitFor(() => expect(banner()).toHaveClass('panel-failure--flash'));
    expect(banners()).toHaveLength(1);
    expect(banner()).toBe(first);
    await waitFor(() => expect(banner().querySelector('.panel-failure__retry-failed')).not.toBeNull());
  });
});

describe('Copy details', () => {
  it('puts the message and the path on the clipboard — never a raw error', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'too-large' });

    fireEvent.click(within(banner()).getByTitle('Copy details'));

    await waitFor(() => expect(panel().clipboardWrite).toHaveBeenCalledTimes(1));
    const written = (panel().clipboardWrite.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(written).toMatch(/too large/i);
    expect(written).toContain('README.md');
    expect(written).not.toContain('too-large');
  });
});

describe('no-provider offers Close, which closes the panel (FR-027)', () => {
  it('one banner saying the file type has no preview, with Close as its ONLY action', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'no-provider' });

    expect(banners()).toHaveLength(1);
    expect(banner().querySelector('.panel-failure__headline')?.textContent).toMatch(/file type has no preview/i);
    expect(within(banner()).getByTitle('Close')).toBeInTheDocument();
    expect(within(banner()).queryByTitle('Try again')).toBeNull();
    expect(within(banner()).queryByTitle('Clear panel type')).toBeNull();
    // 044 US3 (carried) — FR-027 as amended in 980cd3bc and menus-and-controls.md §9: Close, and nothing else.
    expect(within(banner()).queryByTitle('Copy details')).toBeNull();
    expect(within(banner()).getAllByRole('button')).toHaveLength(1);
  });

  it('Close ends the preview exactly as Close Panel does: main is told, and the preview is gone', async () => {
    await mountDoc();
    const id = panel().id;
    pushNotice(2, { kind: 'no-provider' });

    fireEvent.click(within(banner()).getByTitle('Close'));

    await waitFor(() => expect(panel().preview.destroyed).toHaveBeenCalledWith(id));
    await waitFor(() => expect(screen.queryByTestId(`preview-${id}`)).toBeNull());
  });
});

describe('a repeat flashes the banner already shown (FR-026)', () => {
  it('repeat: true keeps ONE banner — the same element — and flashes it on every repeat', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'deleted' });
    const first = banner();
    expect(first).not.toHaveClass('panel-failure--flash');

    pushNotice(3, { kind: 'deleted', repeat: true });
    expect(banners()).toHaveLength(1);
    expect(banner()).toBe(first);
    expect(first).toHaveClass('panel-failure--flash');
    const flashes = Number(first.getAttribute('data-flash'));

    pushNotice(4, { kind: 'deleted', repeat: true });
    expect(banners()).toHaveLength(1);
    expect(Number(banner().getAttribute('data-flash'))).toBe(flashes + 1);
  });

  it('a different condition replaces the message in the one banner rather than adding a second', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'unreadable' });
    pushNotice(3, { kind: 'deleted' });
    expect(banners()).toHaveLength(1);
    expect(banner().querySelector('.panel-failure__headline')?.textContent).toMatch(/no longer exists/i);
  });

  it('fix round 1 (item 3) — a failed retry’s sentence does not carry over to a different condition', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'unreadable' });
    panel().preview.refresh.mockImplementation(() =>
      Promise.resolve({
        update: previewUpdate({ panelId: panel().id, revision: 3, notice: { kind: 'unreadable', repeat: true }, content: null }),
      }),
    );
    fireEvent.click(within(banner()).getByTitle('Try again'));
    await waitFor(() => expect(banner().querySelector('.panel-failure__retry-failed')).not.toBeNull());

    pushNotice(4, { kind: 'deleted' });

    expect(banners()).toHaveLength(1);
    expect(banner().querySelector('.panel-failure__headline')?.textContent).toMatch(/no longer exists/i);
    expect(banner().querySelector('.panel-failure__retry-failed')).toBeNull();
    expect(banner()).not.toHaveClass('panel-failure--flash');
  });
});

describe('fix round 1 (item 4) — focusing a preview while its notice is up', () => {
  it('puts the keyboard on the banner’s first control, not on the covered body', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'deleted' });

    act(() => {
      focusPanel(panel().id);
    });

    const active = document.activeElement as HTMLElement | null;
    expect(screen.getByTestId(`preview-${panel().id}`).contains(active)).toBe(true);
    expect(banner().contains(active)).toBe(true);
    expect(active?.getAttribute('title')).toBe('Try again');
  });

  it('still focuses the body when no notice is up', async () => {
    await mountDoc();
    act(() => {
      focusPanel(panel().id);
    });
    expect(document.activeElement).toBe(body());
  });
});

describe('a deleted file shows the notice and nothing else (US2 scenario 6)', () => {
  it('the rendered document is not shown under the notice; it returns when the file does', async () => {
    await mountDoc();
    pushNotice(2, { kind: 'deleted' });

    expect(banners()).toHaveLength(1);
    expect(body()).not.toBeVisible();
    expect(screen.getByText('Readme body.')).not.toBeVisible();
    expect(linkNotice()).toBeNull();
    expect(screen.getByTestId(`preview-${panel().id}`).querySelectorAll('.panel-failure')).toHaveLength(1);

    pushNotice(3, null, '# Readme\n\nBack again.\n');
    await waitFor(() => expect(banners()).toHaveLength(0));
    expect(body()).toBeVisible();
    expect(await screen.findByText('Back again.')).toBeVisible();
  });

  it('fix round 1 (item 2) — the body is COVERED, not taken out of layout, so its scroll offset survives (FR-024)', async () => {
    await mountDoc();
    body().scrollTop = 120;
    pushNotice(2, { kind: 'deleted' });

    // Out of layout (`hidden`, display:none) is what resets a scroll offset in Chromium; covered is not.
    expect(body()).not.toHaveAttribute('hidden');
    expect(body().style.visibility).toBe('hidden');
    expect(body()).toHaveAttribute('inert');
    expect(body().scrollTop).toBe(120);

    pushNotice(3, null, '# Readme\n\nBack again.\n');
    await waitFor(() => expect(banners()).toHaveLength(0));
    expect(body()).not.toHaveAttribute('inert');
    expect(body().style.visibility).toBe('');
    expect(body().scrollTop).toBe(120);
  });
});

describe('the file notice and the link notice never report one condition twice', () => {
  const shownUnshowable = (): PreviewNavigateResponse => ({
    kind: 'shown',
    update: previewUpdate({
      panelId: panel().id,
      filePath: `${ROOT}/docs/setup.md`,
      revision: 5,
      content: { kind: 'text', text: '' },
      notice: { kind: 'too-large' },
    }),
  });

  it('a followed link to an existing file that cannot be shown raises its FILE notice, visibly, and no link notice', async () => {
    await mountDoc();
    panel().preview.navigate.mockImplementation(() => Promise.resolve(shownUnshowable()));

    fireEvent.click(screen.getByText('Setup'), { ctrlKey: true });

    await waitFor(() => expect(banners()).toHaveLength(1));
    expect(banner()).toBeVisible();
    expect(banner().querySelector('.panel-failure__headline')?.textContent).toMatch(/too large/i);
    expect(banner().querySelector('.panel-failure__path')?.textContent).toContain('setup.md');
    expect(linkNotice()).toBeNull();
  });

  it('a link to a missing file raises only the link notice — no file banner', async () => {
    await mountDoc();
    panel().preview.navigate.mockResolvedValue({
      kind: 'refused',
      notice: { kind: 'link-missing-file', target: `${ROOT}/docs/missing.md` },
    });

    fireEvent.click(screen.getByText('Gone'), { ctrlKey: true });

    await screen.findByTestId(`preview-link-notice-${panel().id}`);
    expect(banners()).toHaveLength(0);
    expect(body()).toBeVisible();
  });

  it('a link notice in the update itself is never drawn as a file banner', async () => {
    await mountDoc();
    await act(() => Promise.resolve());
    pushNotice(2, { kind: 'link-missing-file', target: README });
    expect(banners()).toHaveLength(0);
  });
});
