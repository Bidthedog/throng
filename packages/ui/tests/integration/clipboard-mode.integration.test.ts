/**
 * The clipboard mode record is APP-GLOBAL and SELF-CORRECTING (016, FR-015c / SC-011a).
 *
 * One record in UI main, shared by every panel in every window. That is what makes the feature's
 * primary use case work — cut a column block in one file, paste it into another — and a view-local
 * marker would have broken exactly that, silently.
 *
 * It is validated against the live OS clipboard on every paste, which is why there is no polling
 * and no clipboard observer anywhere in this feature: the check happens when the answer is needed,
 * so it cannot be stale, and no OS event can be missed.
 */
import { describe, expect, it } from 'vitest';
import type { IClipboard } from '@throng/core';
import { ClipboardService } from '../../src/main/clipboard-service.js';

/** A fake OS clipboard that ANY source can write to — including "another application". */
function osClipboard(): IClipboard & { setExternally: (text: string) => void } {
  let text = '';
  return {
    writeText: (value: string) => {
      text = value;
    },
    readText: () => text,
    setExternally: (value: string) => {
      text = value;
    },
  };
}

describe('ClipboardService — one record, every panel, every window', () => {
  it('remembers the SHAPE of what throng last copied', () => {
    const os = osClipboard();
    const service = new ClipboardService(os);

    service.write('one\ntwo\n', 'rectangular');
    expect(os.readText()).toBe('one\ntwo\n'); // the OS clipboard carries PLAIN TEXT, as always
    expect(service.pasteMode()).toBe('rectangular');
  });

  it('carries the mode ACROSS PANELS AND WINDOWS — there is only one record', () => {
    // The service is a single instance in UI main. A panel in another window asking for the paste
    // mode is asking the same object, so a block cut in one file pastes as a block in another.
    const os = osClipboard();
    const service = new ClipboardService(os);

    service.write('col1\ncol2\n', 'rectangular'); // panel A, main window
    expect(service.pasteMode()).toBe('rectangular'); // panel B, sub-workspace window
  });

  it('falls back to VERBATIM when ANY other source touches the clipboard', () => {
    const os = osClipboard();
    const service = new ClipboardService(os);
    service.write('a line\n', 'full-line');
    expect(service.pasteMode()).toBe('full-line');

    // A browser, an editor, anything at all copies something. throng's record now describes text
    // that is no longer on the clipboard — so it does not describe what is about to be pasted.
    os.setExternally('something a user copied from a web page');

    expect(service.pasteMode()).toBe('verbatim');
    // …and the pasted TEXT is whatever the OS clipboard now holds — throng's remembered text is not
    // resurrected. The record is a description of the clipboard, never a substitute for it.
    expect(service.read()).toBe('something a user copied from a web page');
  });

  it('recovers WITHOUT polling once throng copies again', () => {
    // Self-correcting: the mismatch is not an error state to be cleared, and nothing had to notice
    // the external copy. The next throng copy simply makes the record true again.
    const os = osClipboard();
    const service = new ClipboardService(os);

    service.write('block\n', 'rectangular');
    os.setExternally('external');
    expect(service.pasteMode()).toBe('verbatim');

    service.write('block again\n', 'rectangular');
    expect(service.pasteMode()).toBe('rectangular');
  });

  it('treats an identical-text external copy as still ours — because it is indistinguishable', () => {
    // If another application put the SAME text on the clipboard, there is nothing to detect and
    // nothing to get wrong: pasting it as a block yields exactly the text the user is looking at.
    const os = osClipboard();
    const service = new ClipboardService(os);
    service.write('same\n', 'rectangular');
    os.setExternally('same\n');
    expect(service.pasteMode()).toBe('rectangular');
  });

  it('survives the OS rewriting the line endings in transit — Windows hands back CRLF', () => {
    // The bug this test exists for. My first fake OS clipboard was a perfect pipe: whatever you put
    // in came back out. The REAL Windows clipboard is not — it normalises text to CRLF. So an LF
    // document that cut a line wrote "beta\n", read back "beta\r\n", concluded that another
    // application must have copied something since, and pasted VERBATIM — splitting the line it
    // landed in, every single time. Caught by an E2E, because no fake was unfaithful enough.
    const os = osClipboard();
    const service = new ClipboardService(os);

    service.write('beta\n', 'full-line');
    os.setExternally('beta\r\n'); // …the OS, "helpfully", on the way back out

    expect(service.pasteMode()).toBe('full-line'); // it is still OUR text
  });

  it('starts verbatim — an app that has copied nothing has no shape to claim', () => {
    const os = osClipboard();
    const service = new ClipboardService(os);
    os.setExternally('text from before throng started');
    expect(service.pasteMode()).toBe('verbatim');
    expect(service.currentRecord()).toBeNull();
  });
});
