/**
 * Decode an OSC 52 clipboard-write sequence (005 / clipboard support). A program
 * running inside the terminal (Claude Code, tmux, vim, …) copies to the system
 * clipboard by emitting `ESC ] 52 ; Pc ; Pd ST`, where `Pc` is the selection
 * (`c` clipboard, `p` primary, combinations, or empty) and `Pd` is the base64 of
 * the UTF-8 text — or `?` to READ the clipboard back. xterm.js hands its OSC 52
 * handler the payload AFTER `52;`, i.e. the `"Pc;Pd"` string.
 *
 * Returns the decoded text to place on the clipboard, or `null` when there is
 * nothing to write: a read/query (`?`), an empty payload, or malformed data. We
 * never honour reads (that would let terminal output exfiltrate the clipboard) and
 * never throw. Pure (no xterm/DOM import) so it is unit-testable.
 */
export function parseOsc52(data: string): string | null {
  const semi = data.indexOf(';');
  if (semi < 0) return null; // no "Pc;Pd" separator
  const payload = data.slice(semi + 1);
  if (payload === '' || payload === '?') return null; // nothing to write / a read request
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null; // not base64
  try {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null; // invalid base64 / not valid UTF-8
  }
}
