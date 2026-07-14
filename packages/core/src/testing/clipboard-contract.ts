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
