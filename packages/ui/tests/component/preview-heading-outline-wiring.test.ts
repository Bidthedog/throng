/**
 * 047 T055 — wiring the Go to Heading pop-down into the real preview panel (US4, research.md R7):
 * `preview.goToHeading`'s chord, the body and header menu rows, and a jump recording history exactly
 * as a followed same-document heading link (044 FR-115).
 *
 * FR-040 (a jump reveals a collapsed target) is NOT covered here — it depends on the fold-state
 * linking (T046/T050), not yet wired; see `preview-panel.tsx`'s `onHeadingOutlineJump` comment.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = '# Title\n\n## Install\n\nwords\n\n## Usage\n\nmore words\n';
const NO_HEADINGS_DOC = 'just a paragraph, no headings at all\n';

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
});

const press = (user: ReturnType<typeof userEvent.setup>, key: string): Promise<void> =>
  user.keyboard(`{Control>}${key}{/Control}`);

describe('preview.goToHeading (Ctrl+G) opens the pop-down', () => {
  it('opens on the focused preview, listing its headings', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByTestId(`preview-markdown-${m.id}`, {}, COLD);
    const user = userEvent.setup();

    await press(user, 'g');

    const dialog = await screen.findByTestId(`heading-outline-${m.id}`);
    expect(dialog).toBeInTheDocument();
    // The FIRST test in the file pays the Markdown pipeline's cold load: the container above exists
    // before the first draw reports its headings, and the pop-down lists them when that draw lands.
    expect(await screen.findByTestId('heading-outline-row-title', {}, COLD)).toBeInTheDocument();
    expect(screen.getByTestId('heading-outline-row-install')).toBeInTheDocument();
    expect(screen.getByTestId('heading-outline-row-usage')).toBeInTheDocument();
  });

  it('says "No headings" for a document with none', async () => {
    m = await mountMarkdownPreview(NO_HEADINGS_DOC);
    await screen.findByTestId(`preview-markdown-${m.id}`, {}, COLD);
    const user = userEvent.setup();

    await press(user, 'g');

    expect(await screen.findByTestId(`heading-outline-${m.id}`)).toBeInTheDocument();
    expect(screen.getByTestId('heading-outline-empty')).toHaveTextContent('No headings');
  });
});

describe('menu rows (contracts/menus-commands-controls.md)', () => {
  it('the body menu offers Go to Heading… with its chord, and opens the pop-down', async () => {
    m = await mountMarkdownPreview(DOC);
    const body = await screen.findByTestId(`preview-body-${m.id}`, {}, COLD);

    fireEvent.contextMenu(body, { clientX: 10, clientY: 10 });
    const item = await screen.findByTestId('menu-item-Go to Heading…');
    expect(item).toHaveTextContent('Ctrl+G');

    fireEvent.click(item);
    await waitFor(() => expect(screen.getByTestId(`heading-outline-${m!.id}`)).toBeInTheDocument());
  });

  it('the header menu offers Go to Heading… too, with the same chord', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByTestId(`preview-body-${m.id}`, {}, COLD);

    fireEvent.contextMenu(screen.getByTestId(`panel-handle-${m.id}`), { clientX: 10, clientY: 10 });
    const item = await screen.findByTestId('menu-item-Go to Heading…');
    expect(item).toHaveTextContent('Ctrl+G');

    fireEvent.click(item);
    await waitFor(() => expect(screen.getByTestId(`heading-outline-${m!.id}`)).toBeInTheDocument());
  });
});

describe('jumping records history exactly as a followed same-document heading (044 FR-115)', () => {
  it('Enter on a row calls preview.navigate with the heading intent, and closes the pop-down', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByTestId(`preview-markdown-${m.id}`, {}, COLD);
    const user = userEvent.setup();
    await press(user, 'g');
    await screen.findByTestId(`heading-outline-${m.id}`);

    fireEvent.keyDown(screen.getByTestId('heading-outline-search'), { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('heading-outline-row-install'), { key: 'Enter' });
      await Promise.resolve();
    });

    expect(m.preview.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: m.id,
        target: expect.objectContaining({ fragment: 'Install' }),
        intent: { kind: 'heading' },
      }),
    );
    expect(screen.queryByTestId(`heading-outline-${m.id}`)).toBeNull();
  });

  it('clicking a row does the same', async () => {
    m = await mountMarkdownPreview(DOC);
    await screen.findByTestId(`preview-markdown-${m.id}`, {}, COLD);
    const user = userEvent.setup();
    await press(user, 'g');
    await screen.findByTestId(`heading-outline-${m.id}`);

    await act(async () => {
      fireEvent.click(screen.getByTestId('heading-outline-row-usage'));
      await Promise.resolve();
    });

    expect(m.preview.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ fragment: 'Usage' }), intent: { kind: 'heading' } }),
    );
  });
});
