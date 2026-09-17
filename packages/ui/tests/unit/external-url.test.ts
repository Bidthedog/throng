import { describe, expect, it } from 'vitest';
import type { IForegroundHandoff, IShellIntegration } from '@throng/core';

import { isSafeExternalUrl, isSafePreviewLinkUrl, registerOpenExternalIpc } from '../../src/main/external-url.js';

/** Every scheme and shape BOTH policies refuse — the injection guard they share. */
const INJECTIONS: unknown[] = [
  'javascript:alert(1)',
  'JavaScript:alert(1)', // case is no defence — the scheme check must not be fooled by it either
  'vbscript:msgbox(1)',
  'file:///C:/Windows/System32/calc.exe',
  'FILE:///C:/Windows/System32/calc.exe',
  'data:text/html,<script>alert(1)</script>',
  'ftp://example.com',
  ' https://leading-space.com',
  ' mailto:a@b.com',
  '\thttps://tab-prefixed.com', // a tab before the scheme is still not the start of the string
  '\nhttps://newline-prefixed.com',
  '//example.com', // protocol-relative — resolves against whatever page loaded it, never safe here
  'httpx://example.com',
  'mailtox:a@b.com',
  '',
  undefined,
  null,
  42,
  { href: 'https://x' },
];

/**
 * 020 FR-003a + 024 US7 (FR-019): the GENERAL policy — About links, terminal links and the window-open
 * guard — opens `http` and `https` only. 024 FR-019 names `mailto:` among the schemes a terminal link MUST
 * NOT open, and 044 never superseded that (adversarial review ruling), so it stays refused here.
 */
describe('isSafeExternalUrl — About, terminal links, window.open (020 FR-003a / 024 FR-019)', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeExternalUrl('https://spdx.org/licenses/MIT.html')).toBe(true);
    expect(isSafeExternalUrl('HTTPS://github.com/owner/repo')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true); // 024: now accepted
    expect(isSafeExternalUrl('HTTP://Example.com/path?q=1')).toBe(true);
  });

  it('refuses mailto (024 FR-019: a terminal opens http and https only)', () => {
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(false);
    expect(isSafeExternalUrl('MAILTO:a@b.com')).toBe(false);
  });

  it('rejects every other scheme and non-string input (the injection guard)', () => {
    for (const bad of INJECTIONS) expect(isSafeExternalUrl(bad)).toBe(false);
  });
});

/** 044 FR-091 (R10): a Markdown preview's links open `http:`, `https:` AND `mailto:` — and nothing else. */
describe('isSafePreviewLinkUrl — a preview’s external links (044 FR-091)', () => {
  it('accepts http, https and mailto URLs', () => {
    expect(isSafePreviewLinkUrl('https://example.com')).toBe(true);
    expect(isSafePreviewLinkUrl('HTTP://Example.com/path?q=1')).toBe(true);
    expect(isSafePreviewLinkUrl('mailto:a@b.com')).toBe(true);
    expect(isSafePreviewLinkUrl('MAILTO:a@b.com')).toBe(true);
    expect(isSafePreviewLinkUrl('mailto:a@b.com?subject=Hello%20there')).toBe(true);
  });

  it('rejects every other scheme and non-string input (the injection guard)', () => {
    for (const bad of INJECTIONS) expect(isSafePreviewLinkUrl(bad)).toBe(false);
  });
});

/**
 * The two CALLERS, through the handlers main actually registers: the general channel (About, terminal)
 * and the preview's own. One policy per channel, so a terminal link cannot borrow the preview's `mailto:`.
 */
function wiring(): {
  send(channel: string, url: unknown): void;
  opened: string[];
  /** Every `allow()` and every `openExternal`, interleaved in the order they happened. */
  order: string[];
} {
  const listeners = new Map<string, (event: unknown, url: unknown) => void>();
  const opened: string[] = [];
  const order: string[] = [];
  const shell: IShellIntegration = {
    revealInFileManager: async () => {},
    openFolder: async () => {},
    openExternal: async (url: string) => {
      opened.push(url);
      order.push(`open:${url}`);
    },
  };
  const foregroundHandoff: IForegroundHandoff = {
    allow: () => {
      order.push('allow');
      return true;
    },
  };
  registerOpenExternalIpc(
    { on: (channel, listener) => void listeners.set(channel, listener) },
    shell,
    foregroundHandoff,
  );
  return {
    opened,
    order,
    send: (channel, url) => {
      const listener = listeners.get(channel);
      if (!listener) throw new Error(`nothing registered on ${channel}`);
      listener({}, url);
    },
  };
}

describe('registerOpenExternalIpc — one policy per caller', () => {
  it('the general channel (terminal, About) opens http(s) and refuses mailto', () => {
    const { send, opened } = wiring();
    send('throng:openExternal', 'https://example.com');
    send('throng:openExternal', 'mailto:a@b.com');
    send('throng:openExternal', 'javascript:alert(1)');
    expect(opened).toEqual(['https://example.com']);
  });

  it('the preview channel opens http(s) AND mailto, and refuses the rest', () => {
    const { send, opened } = wiring();
    send('throng:preview:openExternal', 'https://example.com');
    send('throng:preview:openExternal', 'mailto:a@b.com');
    send('throng:preview:openExternal', 'file:///C:/Windows/System32/calc.exe');
    expect(opened).toEqual(['https://example.com', 'mailto:a@b.com']);
  });
});

/**
 * 044 FR-119 (refines FR-091): after a followed web or `mailto:` link, throng MUST NOT take the
 * foreground back — the handler's window is left in front.
 *
 * Windows only lets the process that already OWNS the foreground hand it on. throng owns it here
 * (the click landed in its window), and the browser does not — so when the browser is ALREADY
 * running, `ShellExecute` reaches an existing process whose `SetForegroundWindow` the OS refuses,
 * and throng stays in front. `IForegroundHandoff.allow()` is the sanctioned hand-on, and #199
 * already established it for the same lock met from a terminal.
 *
 * What is assertable without an OS is the CALL and its ORDER, which is all this pins:
 * - `allow()` runs BEFORE the open — the grant has to be in place when the handler is launched;
 * - exactly once per accepted URL — the grant decays with the user's next input, so re-granting
 *   adds nothing and widens the window in which any process may raise itself;
 * - never for a URL the scheme policy refuses — a refused `javascript:` must not buy a stranger
 *   the foreground.
 *
 * Whether Windows honours the grant is the seam's business, contract-tested in
 * `platform-windows/tests/contract/windows-foreground-handoff.contract.test.ts`, which records why
 * no test may assert the return value.
 */
describe('registerOpenExternalIpc — the foreground is handed on (044 FR-119)', () => {
  it('grants the handoff immediately before opening, on the general channel', () => {
    const { send, order } = wiring();
    send('throng:openExternal', 'https://example.com');
    expect(order).toEqual(['allow', 'open:https://example.com']);
  });

  it('grants the handoff immediately before opening, on the preview channel', () => {
    const { send, order } = wiring();
    send('throng:preview:openExternal', 'https://example.com');
    send('throng:preview:openExternal', 'mailto:a@b.com');
    expect(order).toEqual([
      'allow',
      'open:https://example.com',
      'allow',
      'open:mailto:a@b.com',
    ]);
  });

  it('grants nothing for a URL either policy refuses', () => {
    const { send, order } = wiring();
    send('throng:openExternal', 'javascript:alert(1)');
    send('throng:openExternal', 'mailto:a@b.com'); // 024 FR-019: a terminal opens http(s) only
    send('throng:preview:openExternal', 'javascript:alert(1)');
    send('throng:preview:openExternal', 'file:///C:/Windows/System32/calc.exe');
    expect(order).toEqual([]);
  });
});
