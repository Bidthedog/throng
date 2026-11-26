/**
 * 080 FR-011, FR-048, FR-049 — Help and (?) links open in throng's Help window, on the guide shipped with the app;
 * never in the OS browser, throng's HTML preview or any other surface, whatever the default open action for HTML is.
 *
 * Layer: unit — `openHelp` is one call over one preload function; what it must NOT call is the point.
 * The unit project runs in node, so `window` is a stub carrying only what the opener reads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL } from '@throng/core';
import { effectiveHelpBase, openHelp } from '../../src/renderer/help/help-opener.js';

const stubWindow = (throng?: object): void => {
  vi.stubGlobal('window', throng === undefined ? {} : { throng });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const URL_ = `${HELP_APP_BASE_URL}terminals/#open-a-terminal`;

describe('openHelp (FR-011, FR-048)', () => {
  it('hands the URL to window.throng.openHelp, the Help window', () => {
    const openHelpIpc = vi.fn();
    stubWindow({ openHelp: openHelpIpc });
    openHelp(URL_);
    expect(openHelpIpc).toHaveBeenCalledExactlyOnceWith(URL_);
  });

  it('never reaches the OS browser, the link-URI opener or a preview opener, whatever the HTML open action is', () => {
    const openHelpIpc = vi.fn();
    const openExternal = vi.fn();
    const linkOpen = vi.fn();
    const previewOpen = vi.fn();
    stubWindow({
      openHelp: openHelpIpc,
      openExternal,
      linkUri: { openExternal: linkOpen },
      config: { get: () => Promise.resolve({ settings: { files: { htmlOpenAction: 'preview' } } }) },
      preview: { open: previewOpen },
    });
    openHelp(URL_);
    expect(openHelpIpc).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(linkOpen).not.toHaveBeenCalled();
    expect(previewOpen).not.toHaveBeenCalled();
  });

  it('does nothing, and throws nothing, when there is no openHelp', () => {
    stubWindow({});
    expect(() => openHelp(URL_)).not.toThrow();
    stubWindow();
    expect(() => openHelp(URL_)).not.toThrow();
  });
});

describe('effectiveHelpBase (FR-049)', () => {
  it('is the root of the guide shipped with the app', () => {
    stubWindow({});
    expect(effectiveHelpBase()).toBe(HELP_APP_BASE_URL);
  });
});
