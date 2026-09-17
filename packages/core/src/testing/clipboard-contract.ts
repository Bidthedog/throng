import type { IClipboard } from '../abstractions/clipboard.js';

/**
 * Reusable contract suite for {@link IClipboard} (016, FR-013a / contracts/clipboard.md).
 *
 * Runnable against any implementation — an in-memory fake in a unit test, or the real Electron
 * clipboard in a contract test. Framework-agnostic: it THROWS on a violation, so callers assert
 * with `expect(() => runClipboardContract(...)).not.toThrow()`.
 *
 * The obligation that matters most is the one that looks pedantic: **line endings survive
 * VERBATIM**. Normalising them here would be a disaster — the clipboard is how text crosses between
 * a CRLF file and an LF one, and a seam that quietly rewrote `\r\n` would corrupt every paste into
 * a file with the other convention. Normalisation is a DOCUMENT concern (FR-023a), decided by the
 * destination, and this layer must not pre-empt it.
 */
export function runClipboardContract(name: string, make: () => IClipboard): void {
  const fail = (why: string): never => {
    throw new Error(`${name} violates the IClipboard contract: ${why}`);
  };

  // Round-trip: what goes in comes back out.
  {
    const cb = make();
    cb.writeText('hello');
    if (cb.readText() !== 'hello') fail(`readText() did not return what writeText() wrote`);
  }

  // Unicode survives — a clipboard that mangles non-ASCII is worse than none.
  {
    const cb = make();
    const text = 'héllo — 世界 — 🎉';
    cb.writeText(text);
    if (cb.readText() !== text) fail('Unicode did not round-trip');
  }

  // LINE ENDINGS SURVIVE VERBATIM. Not normalised, not "helpfully" converted.
  {
    const cb = make();
    const crlf = 'one\r\ntwo\r\n';
    cb.writeText(crlf);
    if (cb.readText() !== crlf) fail('CRLF line endings were altered — they must survive verbatim');

    const lf = 'one\ntwo\n';
    cb.writeText(lf);
    if (cb.readText() !== lf) fail('LF line endings were altered — they must survive verbatim');

    const mixed = 'one\r\ntwo\nthree';
    cb.writeText(mixed);
    if (cb.readText() !== mixed) fail('a mixed-ending text was normalised — it must survive verbatim');
  }

  // A write REPLACES; it never appends.
  {
    const cb = make();
    cb.writeText('first');
    cb.writeText('second');
    if (cb.readText() !== 'second') fail('writeText() did not replace the previous contents');
  }

  // Empty is a legal value — it clears the clipboard, and is not an error.
  {
    const cb = make();
    cb.writeText('something');
    cb.writeText('');
    if (cb.readText() !== '') fail('writing an empty string did not clear the clipboard');
  }

  // Reading is IDEMPOTENT — a read does not consume.
  {
    const cb = make();
    cb.writeText('stable');
    if (cb.readText() !== 'stable' || cb.readText() !== 'stable') {
      fail('readText() is not idempotent — a read must not consume the clipboard');
    }
  }

  // It never throws. An unreadable clipboard yields '' — a paste is not worth crashing over.
  {
    const cb = make();
    try {
      cb.readText();
      cb.writeText('x');
      cb.readText();
    } catch (err) {
      fail(`it threw: ${String(err)}`);
    }
  }
}

/**
 * A double for {@link IClipboard#writeRich} — the underlying OS-clipboard fake, plus a way to read
 * back the HTML it was given. {@link IClipboard#readText} deliberately stays plain-text-only (R12),
 * so nothing on `IClipboard` itself can prove the HTML arrived; the harness exposes it directly,
 * the same shape {@link runShellIntegrationContract}'s harness uses to see past its interface.
 */
export interface ClipboardRichHarness {
  clipboard: IClipboard;
  /** The HTML most recently handed to `writeRich`, as the double recorded it. */
  html(): string;
}

/**
 * Contract suite for {@link IClipboard#writeRich} (044, FR-035a / R12). Separate from
 * {@link runClipboardContract} because it needs a harness that can see the HTML `IClipboard` itself
 * never exposes.
 *
 * `async`, and every `writeRich()` is AWAITED before the harness is read back — `writeRich` returns
 * `Promise<void>`, and a fake that does real async work (a future implementation, or one wrapping a
 * genuinely async OS call) would otherwise be read before it had actually written anything. Callers
 * await the whole suite: `await runClipboardRichContract(...)`.
 */
export async function runClipboardRichContract(
  name: string,
  make: () => ClipboardRichHarness,
): Promise<void> {
  const fail = (why: string): never => {
    throw new Error(`${name} violates the IClipboard writeRich contract: ${why}`);
  };

  // writeRich puts BOTH the plain text and the HTML on the clipboard.
  {
    const { clipboard, html } = make();
    await clipboard.writeRich({ text: 'hello', html: '<p>hello</p>' });
    if (clipboard.readText() !== 'hello') {
      fail("readText() did not return writeRich()'s plain text");
    }
    if (html() !== '<p>hello</p>') fail('the HTML was not written to the clipboard');
  }

  // readText() stays plain — it never returns markup, even right after a rich write.
  {
    const { clipboard } = make();
    await clipboard.writeRich({ text: 'plain fallback', html: '<b>bold</b>' });
    if (clipboard.readText().includes('<')) fail('readText() leaked HTML — it must stay plain text');
  }

  // A write REPLACES; writeRich after writeRich replaces both the text and the HTML.
  {
    const { clipboard, html } = make();
    await clipboard.writeRich({ text: 'first', html: '<i>first</i>' });
    await clipboard.writeRich({ text: 'second', html: '<i>second</i>' });
    if (clipboard.readText() !== 'second') fail('writeRich() did not replace the previous text');
    if (html() !== '<i>second</i>') fail('writeRich() did not replace the previous HTML');
  }

  // A plain writeText() after a rich write still lands as plain text, AND clears the earlier HTML —
  // R12's "the memory implementation records both" cuts both ways: a plain write is not half-rich.
  {
    const { clipboard, html } = make();
    await clipboard.writeRich({ text: 'rich', html: '<b>rich</b>' });
    clipboard.writeText('plain');
    if (clipboard.readText() !== 'plain') fail('writeText() after writeRich() did not replace the text');
    if (html() !== '') fail('writeText() after writeRich() left the earlier HTML in place');
  }
}
