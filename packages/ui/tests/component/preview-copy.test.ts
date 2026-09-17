/**
 * 044 T115 — selecting and copying in a preview (FR-035, FR-035a, FR-035b, FR-035c, FR-015e;
 * contracts/menus-and-controls.md §4, contracts/security-policy.md "Export profile"; quickstart §3 step 9).
 *
 * ══ TWO FORMATS, ONE SETTING, TWO EXPLICIT ITEMS ══
 *
 * *Rich text* puts the selection's plain text AND its HTML on the clipboard in one write
 * (`clipboard.writeRich`), so a mail composer keeps headings, lists and links while an editor or terminal
 * pastes plain text. *Plain text* puts the text alone (`clipboard.write`). Copy — the menu item, and the
 * platform copy gesture, which is intercepted so the two cannot diverge — uses `editor.previews.copyFormat`,
 * read live; Copy as Rich Text and Copy as Plain Text ignore it (the #394 pattern: a default action with
 * explicit alternatives beside it). All three are disabled while nothing is selected.
 *
 * ══ THE EXPORT PROFILE ══
 *
 * The HTML is the selection re-sanitised with a stricter profile than the one that drew it: no `class`, no
 * `data-*`, no `id`, highlight spans unwrapped to their text, and `href` restored from the link's
 * classification for EXTERNAL links only — a project file link means nothing outside throng.
 *
 * Mounted with the shipped Markdown view, because the export profile is the Markdown provider's and the
 * DOM it cleans is the real body's: data attributes, link classification and highlight spans included.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewProviderRegistry } from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { COLD, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = [
  '# Release notes',
  '',
  'Read [the site](https://example.com/page) and [setup](docs/setup.md).',
  '',
  '- first item',
  '- second item',
  '',
  '```ts',
  'const answer: number = 42;',
  '```',
  '',
].join('\n');

let m: MountedPreviewWindow | undefined;

async function mountDoc(settings?: Record<string, unknown>): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview(DOC, undefined, settings ? { settings } : {});
  await screen.findByText('Release notes', {}, COLD);
  return m;
}

const markdown = (): HTMLElement => screen.getByTestId(`preview-markdown-${m!.id}`);
const host = (): HTMLElement => screen.getByTestId(`preview-body-${m!.id}`);

function selectWhole(el: Node): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function clearSelection(): void {
  document.getSelection()?.removeAllRanges();
}

/** Open the body menu over plain text (not a link). */
async function openBodyMenu(): Promise<void> {
  fireEvent.contextMenu(screen.getByText('Release notes'));
  await screen.findByTestId('menu-item-Select All');
}

const item = (label: string): HTMLElement => screen.getByTestId(`menu-item-${label}`);
const richHtml = (): string => (m!.writeRich.mock.calls.at(-1) as unknown as [{ html: string }])[0].html;
const richText = (): string => (m!.writeRich.mock.calls.at(-1) as unknown as [{ text: string }])[0].text;

afterEach(() => {
  clearSelection();
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('the body menu’s Content section (FR-035, FR-035c)', () => {
  it('offers Copy, Copy as Rich Text, Copy as Plain Text and Select All', async () => {
    await mountDoc();
    selectWhole(markdown());
    await openBodyMenu();

    for (const label of ['Copy', 'Copy as Rich Text', 'Copy as Plain Text', 'Select All']) {
      expect(item(label)).toBeInTheDocument();
    }
    expect(item('Copy')).toHaveAttribute('aria-disabled', 'false');
  });

  it('disables all three copies while nothing is selected; Select All stays enabled', async () => {
    await mountDoc();
    clearSelection();
    await openBodyMenu();

    for (const label of ['Copy', 'Copy as Rich Text', 'Copy as Plain Text']) {
      expect(item(label)).toHaveAttribute('aria-disabled', 'true');
    }
    expect(item('Select All')).toHaveAttribute('aria-disabled', 'false');
  });

  it('Select All selects the body and nothing outside it', async () => {
    await mountDoc();
    await openBodyMenu();

    fireEvent.click(item('Select All'));

    const selection = document.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    const range = selection.getRangeAt(0);
    expect(host().contains(range.commonAncestorContainer)).toBe(true);
    expect(selection.toString()).toContain('Release notes');
    expect(selection.toString()).toContain('const answer');
    // Not the panel header, not the menu, not the status bar.
    expect(selection.toString()).not.toContain('Preview');
    expect(selection.toString()).not.toContain('Open in Editor');
  });

  it('Ctrl+A in the body selects the body only, too', async () => {
    await mountDoc();
    host().focus();

    const event = fireEvent.keyDown(host(), { key: 'a', ctrlKey: true });

    // `fireEvent` returns false when a handler prevented the default: the page-wide select-all is not run.
    expect(event).toBe(false);
    const range = document.getSelection()!.getRangeAt(0);
    expect(host().contains(range.commonAncestorContainer)).toBe(true);
    expect(document.getSelection()!.toString()).toContain('Release notes');
  });
});

describe('rich text: plain text and export-profile HTML in one write (FR-035a)', () => {
  it('Copy (default rich) writes {text, html} through writeRich, and nothing through write', async () => {
    await mountDoc();
    selectWhole(markdown());
    await openBodyMenu();

    fireEvent.click(item('Copy'));

    await waitFor(() => expect(m!.writeRich).toHaveBeenCalledTimes(1));
    expect(m!.clipboardWrite).not.toHaveBeenCalled();
    expect(richText()).toContain('Release notes');
    expect(richText()).toContain('first item');
    expect(richText()).not.toMatch(/<[a-z]/i);
    const html = richHtml();
    expect(html).toContain('<h1>');
    expect(html).toMatch(/<li>\s*first item\s*<\/li>/);
  });

  it('the HTML carries no class, no data-*, no id, and no role or tabindex', async () => {
    await mountDoc();
    selectWhole(markdown());
    await openBodyMenu();
    fireEvent.click(item('Copy as Rich Text'));
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalled());

    const html = richHtml();
    expect(html).not.toMatch(/\sclass=/);
    expect(html).not.toMatch(/\sdata-[a-z-]+=/);
    expect(html).not.toMatch(/\sid=/);
    expect(html).not.toMatch(/\srole=/);
    expect(html).not.toMatch(/\stabindex=/);
  });

  it('restores href for an EXTERNAL link only — a project file link keeps its text and no address', async () => {
    await mountDoc();
    selectWhole(markdown());
    await openBodyMenu();
    fireEvent.click(item('Copy as Rich Text'));
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalled());

    const doc = new DOMParser().parseFromString(richHtml(), 'text/html');
    const links = [...doc.querySelectorAll('a')];
    const site = links.find((a) => a.textContent === 'the site');
    const setup = links.find((a) => a.textContent === 'setup');
    expect(site?.getAttribute('href')).toBe('https://example.com/page');
    expect(setup).toBeDefined();
    expect(setup?.hasAttribute('href')).toBe(false);
    // The follow hint is throng's, not the document's: it does not travel.
    expect(site?.hasAttribute('title')).toBe(false);
  });

  it('unwraps highlight spans to their text', async () => {
    await mountDoc();
    // Positive control: the fence really was highlighted into spans before the copy.
    await waitFor(() => expect(markdown().querySelectorAll('code span').length).toBeGreaterThan(0), COLD);
    selectWhole(markdown());
    await openBodyMenu();
    fireEvent.click(item('Copy as Rich Text'));
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalled());

    const html = richHtml();
    expect(html).not.toContain('<span');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('code')?.textContent).toContain('const answer: number = 42;');
  });

  it('copies only what is selected', async () => {
    await mountDoc();
    selectWhole(screen.getByText('first item'));
    await openBodyMenu();
    fireEvent.click(item('Copy as Rich Text'));
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalled());

    expect(richText()).toBe('first item');
    expect(richHtml()).not.toContain('Release notes');
  });
});

describe('plain text: the text alone (FR-035a)', () => {
  it('Copy as Plain Text writes text through write, and never writeRich', async () => {
    await mountDoc();
    selectWhole(markdown());
    await openBodyMenu();

    fireEvent.click(item('Copy as Plain Text'));

    await waitFor(() => expect(m!.clipboardWrite).toHaveBeenCalledTimes(1));
    expect(m!.writeRich).not.toHaveBeenCalled();
    const entry = (m!.clipboardWrite.mock.calls[0] as unknown as [{ text: string; mode: string }])[0];
    expect(entry.text).toContain('Release notes');
    expect(entry.text).not.toMatch(/<[a-z]/i);
    expect(entry.mode).toBe('verbatim');
  });
});

describe('Copy and the copy gesture follow editor.previews.copyFormat; the named items ignore it (FR-035b, FR-035c)', () => {
  it('copyFormat plain: Copy writes plain text', async () => {
    await mountDoc({ editor: { previews: { copyFormat: 'plain' } } });
    selectWhole(markdown());
    await openBodyMenu();

    fireEvent.click(item('Copy'));

    await waitFor(() => expect(m!.clipboardWrite).toHaveBeenCalledTimes(1));
    expect(m!.writeRich).not.toHaveBeenCalled();
  });

  it('copyFormat plain: Copy as Rich Text still writes rich', async () => {
    await mountDoc({ editor: { previews: { copyFormat: 'plain' } } });
    selectWhole(markdown());
    await openBodyMenu();

    fireEvent.click(item('Copy as Rich Text'));

    await waitFor(() => expect(m!.writeRich).toHaveBeenCalledTimes(1));
    expect(m!.clipboardWrite).not.toHaveBeenCalled();
  });

  it('the copy event is intercepted and routed through the setting — read live', async () => {
    const mounted = await mountDoc();
    selectWhole(markdown());

    const first = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      host().dispatchEvent(first);
    });
    expect(first.defaultPrevented).toBe(true);
    await waitFor(() => expect(mounted.writeRich).toHaveBeenCalledTimes(1));

    mounted.setSettings({ editor: { previews: { copyFormat: 'plain' } } });
    const second = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      host().dispatchEvent(second);
    });
    expect(second.defaultPrevented).toBe(true);
    await waitFor(() => expect(mounted.clipboardWrite).toHaveBeenCalledTimes(1));
    expect(mounted.writeRich).toHaveBeenCalledTimes(1);
  });

  it('a copy gesture with nothing selected writes nothing', async () => {
    await mountDoc();
    clearSelection();
    const event = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      host().dispatchEvent(event);
    });
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(m!.writeRich).not.toHaveBeenCalled();
    expect(m!.clipboardWrite).not.toHaveBeenCalled();
  });
});

describe('the body menu’s Navigate section (FR-015b, FR-015e)', () => {
  it('a text provider’s preview offers Open in Editor', async () => {
    await mountDoc();
    await openBodyMenu();
    expect(item('Open in Editor')).toBeInTheDocument();
  });

  it('a binary provider’s preview offers neither Open in Editor nor Go to Editor — nor a Content section', async () => {
    const registry = createPreviewProviderRegistry([
      { id: 'testBinary', displayName: 'Test binary', extensions: ['.prvbin'], kind: 'binary', sourceMimeTypes: ['application/pdf'] },
    ]);
    function Body({ panelId }: PreviewBodyProps): ReactElement {
      return createElement('div', { 'data-testid': `fake-body-${panelId}` }, 'a page');
    }
    const views: Record<string, PreviewProviderView> = {
      testBinary: { id: 'testBinary', textSelection: false, load: () => Promise.resolve(Body) },
    };
    m = await mountMarkdownPreview('', 'D:/proj/manual.prvbin', { providers: { registry, views }, providerId: 'testBinary' });
    await screen.findByTestId(`fake-body-${m.id}`);

    fireEvent.contextMenu(screen.getByTestId(`fake-body-${m.id}`));

    await act(() => Promise.resolve());
    expect(screen.queryByTestId('menu-item-Open in Editor')).toBeNull();
    expect(screen.queryByTestId('menu-item-Go to Editor')).toBeNull();
    expect(screen.queryByTestId('menu-item-Copy')).toBeNull();
    expect(screen.queryByTestId('menu-item-Select All')).toBeNull();
  });
});

/* ── US3 fix round 1 ─────────────────────────────────────────────────────────────────────────────── */

/** A range from `start` to `end`, made the document's one selection. */
function selectRange(start: [Node, number], end: [Node, number]): void {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The first text node under `el`. */
function textIn(el: Element): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (node === null) throw new Error(`no text under <${el.tagName.toLowerCase()}>`);
  return node as Text;
}

describe('fix round 1 (item 1) — a copy that starts outside the body still goes through the export profile', () => {
  it('a selection dragged from the link notice into the document: intercepted, trimmed to the body, cleaned', async () => {
    await mountDoc();
    m!.preview.navigate.mockResolvedValue({
      kind: 'refused',
      notice: { kind: 'link-missing-file', target: 'D:/proj/docs/setup.md' },
    });
    fireEvent.click(screen.getByText('setup'), { ctrlKey: true });
    const notice = await screen.findByTestId(`preview-link-notice-${m!.id}`);
    // Positive control: the notice really sits OUTSIDE the body.
    expect(host().contains(notice)).toBe(false);

    selectRange([textIn(notice), 0], [textIn(screen.getByText('first item')), 5]);
    const event = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      // Chromium fires `copy` at the selection's start — here, inside the notice.
      textIn(notice).parentElement!.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalledTimes(1));
    // Trimmed to the body: nothing of the notice travels.
    const noticeText = textIn(notice).data;
    expect(noticeText.length).toBeGreaterThan(0);
    expect(richText()).not.toContain(noticeText);
    expect(richText()).toContain('Release notes');
    expect(richText().trimEnd().endsWith('first')).toBe(true);
    expect(richHtml()).not.toMatch(/\sdata-[a-z-]+=/);
    expect(richHtml()).not.toMatch(/\sclass=/);
    expect(richHtml()).not.toContain('D:/proj');
  });
});

describe('fix round 1 (item 2) — an image in a rich copy becomes its alt text', () => {
  const IMAGES = [
    '# Pictures',
    '',
    'A project image ![Diagram of the flow](images/diagram.png) here.',
    '',
    'A remote image ![Build badge](https://img.example/badge.svg) there.',
    '',
    'And one with no alt ![](images/blank.png) at all.',
    '',
  ].join('\n');

  it('replaces project and remote images with their alt text, and an alt-less image with nothing', async () => {
    // Load remote images ships on (FR-092), so the badge keeps its https: address in the document.
    m = await mountMarkdownPreview(IMAGES);
    await screen.findByText('Pictures', {}, COLD);
    // Positive control: both images are in the document as images, with the addresses that must not travel.
    await waitFor(() => expect(markdown().querySelectorAll('img').length).toBeGreaterThanOrEqual(2));
    const sources = [...markdown().querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
    expect(sources.some((s) => s.startsWith('throng-preview:'))).toBe(true);
    expect(sources).toContain('https://img.example/badge.svg');

    selectWhole(markdown());
    fireEvent.contextMenu(screen.getByText('Pictures'));
    fireEvent.click(await screen.findByTestId('menu-item-Copy as Rich Text'));
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalledTimes(1));

    const html = richHtml();
    expect(html).not.toContain('<img');
    expect(html).not.toContain('throng-preview:');
    expect(html).not.toContain('img.example');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const paragraphs = [...doc.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toContain('A project image Diagram of the flow here.');
    expect(paragraphs).toContain('A remote image Build badge there.');
    expect(paragraphs).toContain('And one with no alt  at all.');
  });
});

/*
 * Adversarial review (security) M1. A selection with no TEXT in it — an image alone, or a link whose only
 * content is an image — used to be treated as no selection: the copy event was not intercepted, and the
 * browser's own copy carried `data-throng-link` (an absolute project path) and the `throng-preview:`
 * address. Any selection inside the body is the document's, and goes through the export profile.
 */
describe('adversarial review M1 — a selection with no text still goes through the export profile', () => {
  const PICTURES = [
    '# Pictures',
    '',
    'Before ![Diagram of the flow](images/diagram.png) after.',
    '',
    'Linked [![](images/logo.png)](docs/setup.md) here.',
    '',
  ].join('\n');

  async function mountPictures(settings?: Record<string, unknown>): Promise<void> {
    m = await mountMarkdownPreview(PICTURES, undefined, settings ? { settings } : {});
    await screen.findByText('Pictures', {}, COLD);
    await waitFor(() => expect(markdown().querySelectorAll('img')).toHaveLength(2));
  }

  /** Select exactly `node` and fire the platform copy at it, as Chromium does at the selection's start. */
  function copyOnly(node: Node): Event {
    const range = document.createRange();
    range.selectNode(node);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    // Positive control: the selection really has no text.
    expect(selection.toString()).toBe('');
    const event = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      node.dispatchEvent(event);
    });
    return event;
  }

  const diagram = (): HTMLImageElement =>
    [...markdown().querySelectorAll('img')].find((i) => i.getAttribute('alt') === 'Diagram of the flow')!;
  const linkedImage = (): HTMLElement => markdown().querySelector<HTMLElement>('[data-throng-link] img')!.closest('[data-throng-link]')!;

  it('an image alone: intercepted, and rich copy carries its alt text and no address', async () => {
    await mountPictures();
    expect(diagram().getAttribute('src')).toMatch(/^throng-preview:/);

    const event = copyOnly(diagram());

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalledTimes(1));
    expect(richText()).toBe('Diagram of the flow');
    expect(richHtml()).toContain('Diagram of the flow');
    expect(richHtml()).not.toContain('throng-preview:');
    expect(richHtml()).not.toContain('<img');
  });

  it('a link holding only an alt-less image: intercepted, and no link classification or path travels', async () => {
    await mountPictures();
    const link = linkedImage();
    expect(link.getAttribute('data-throng-link')).toContain('D:/proj');

    const event = copyOnly(link);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalledTimes(1));
    expect(richText()).toBe('');
    expect(richHtml()).not.toMatch(/\sdata-[a-z-]+=/);
    expect(richHtml()).not.toContain('D:/proj');
    expect(richHtml()).not.toContain('throng-preview:');
  });

  it('copyFormat plain: an image alone is copied as its alt text through write', async () => {
    await mountPictures({ editor: { previews: { copyFormat: 'plain' } } });

    const event = copyOnly(diagram());

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(m!.clipboardWrite).toHaveBeenCalledTimes(1));
    expect(m!.writeRich).not.toHaveBeenCalled();
    expect((m!.clipboardWrite.mock.calls[0] as unknown as [{ text: string }])[0].text).toBe('Diagram of the flow');
  });
});

/*
 * Security batch A, minor. An alt-less image alone exports to nothing — no text and no HTML — and the copy
 * gesture used to write that nothing over whatever the reader had on the clipboard. It is still intercepted
 * (the browser's own copy would carry the `throng-preview:` address), and nothing is written.
 */
describe('an image-only selection that exports to nothing leaves the clipboard alone', () => {
  const BLANK = ['# Pictures', '', 'Before ![](images/blank.png) after.', ''].join('\n');

  async function copyBlankImage(settings?: Record<string, unknown>): Promise<Event> {
    m = await mountMarkdownPreview(BLANK, undefined, settings ? { settings } : {});
    await screen.findByText('Pictures', {}, COLD);
    await waitFor(() => expect(markdown().querySelectorAll('img')).toHaveLength(1));
    const img = markdown().querySelector('img')!;
    const range = document.createRange();
    range.selectNode(img);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    // Positive control: the selection has no text, and the image no alt to stand in for it.
    expect(selection.toString()).toBe('');
    expect(img.getAttribute('alt') ?? '').toBe('');
    const event = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      img.dispatchEvent(event);
    });
    return event;
  }

  it('rich: intercepted, and neither writeRich nor write is called', async () => {
    const event = await copyBlankImage();

    expect(event.defaultPrevented).toBe(true);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(m!.writeRich).not.toHaveBeenCalled();
    expect(m!.clipboardWrite).not.toHaveBeenCalled();
  });

  it('plain: intercepted, and write is not called', async () => {
    const event = await copyBlankImage({ editor: { previews: { copyFormat: 'plain' } } });

    expect(event.defaultPrevented).toBe(true);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(m!.clipboardWrite).not.toHaveBeenCalled();
    expect(m!.writeRich).not.toHaveBeenCalled();
  });
});

describe('fix round 1 (item 5) — a partial range across blocks copies balanced HTML', () => {
  const MIXED = ['# Release notes', '', 'Write to [the team](mailto:team@example.com) today.', '', '- first item', '- second item', ''].join(
    '\n',
  );

  it('mid-heading to mid-list-item, with a mailto link: balanced, mailto href kept, no data-* or class', async () => {
    m = await mountMarkdownPreview(MIXED);
    await screen.findByText('Release notes', {}, COLD);

    selectRange([textIn(screen.getByText('Release notes')), 3], [textIn(screen.getByText('first item')), 5]);
    const event = new Event('copy', { bubbles: true, cancelable: true });
    act(() => {
      host().dispatchEvent(event);
    });
    await waitFor(() => expect(m!.writeRich).toHaveBeenCalledTimes(1));

    const html = richHtml();
    // Balanced: parsing and re-serialising changes nothing, so no tag was left open or closed twice.
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.innerHTML).toBe(html);
    expect(container.querySelector('h1')?.textContent).toBe('ease notes');
    expect(container.querySelector('ul > li')?.textContent).toBe('first');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('mailto:team@example.com');
    expect(container.querySelector('a')?.textContent).toBe('the team');
    expect(html).not.toMatch(/\sdata-[a-z-]+=/);
    expect(html).not.toMatch(/\sclass=/);
    expect(richText().startsWith('ease notes')).toBe(true);
    expect(richText().trimEnd().endsWith('first')).toBe(true);
  });
});
