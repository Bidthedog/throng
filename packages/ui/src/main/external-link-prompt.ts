import type { IShellIntegration } from '@throng/core';

/**
 * 080 FR-063 — the one gate every external link passes before the OS sees it.
 *
 * Every route that opens a link outside throng ends in `IShellIntegration.openExternal`: the About and
 * terminal channel and the preview channel (`external-url.ts`), a terminal's and an editor's links (the same
 * file's link-URI channel), the window-open guard, and the Help window's external links and Open in browser.
 * Wrapping the seam once, where the composition builds it, covers all of them and every route added later,
 * with no change at a call site. Each route's scheme policy runs before it calls the seam, so a refused
 * `javascript:` is never put to the user.
 *
 * - The setting is read per link, so turning it off takes effect at once.
 * - One prompt at a time (one condition, one notice): a link followed while a prompt is open is dropped, and
 *   the open prompt comes forward.
 * - Cancel resolves, never rejects: the user said no, so no "the browser would not start" notice follows.
 * - Every other seam call passes straight through; a file is not an external link.
 */
export type LinkPromptAnswer = 'open' | 'cancel';

export interface ExternalLinkPromptOptions {
  /** Whether to ask, read on every link (`confirmations.openExternalLink`). */
  enabled: () => boolean;
  /** Show the prompt for `url` and resolve with the user's answer. */
  ask: (url: string) => Promise<LinkPromptAnswer>;
  /** Bring the prompt that is already open forward. */
  focusPrompt: () => void;
  /** Called right before an asked-about link opens: the foreground hand-on is made again after the prompt. */
  onOpen?: () => void;
}

export function withExternalLinkPrompt<T extends IShellIntegration>(inner: T, options: ExternalLinkPromptOptions): T {
  let asking = false;
  const openExternal = async (url: string): Promise<void> => {
    if (!options.enabled()) return inner.openExternal(url);
    if (asking) {
      options.focusPrompt();
      return;
    }
    asking = true;
    let answer: LinkPromptAnswer;
    try {
      answer = await options.ask(url);
    } finally {
      asking = false;
    }
    if (answer !== 'open') return;
    options.onOpen?.();
    await inner.openExternal(url);
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'openExternal') return openExternal;
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
