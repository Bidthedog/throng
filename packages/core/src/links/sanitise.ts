/**
 * 045 FR-156, FR-156b, SC-024 — the one validation a link's text passes before it is clickable, and again
 * before main hands anything to the OS (data-model §16.3, contracts `link-resolution.md` §9.5).
 *
 * ══ WHAT IT REFUSES, AND WHAT IT DOES NOT ══
 *
 * A link's target is handed to the OS as ONE value — a location for the file manager, a file for throng,
 * a URI for its scheme's handler — never as a command line. So the only things that can make a crafted
 * target dangerous are the ones that could turn one value into two, or smuggle a terminator a receiver
 * might honour:
 *
 *   - control characters, C0 (`U+0000`–`U+001F`), DEL and C1 (`U+0080`–`U+009F`), raw or
 *     PERCENT-ENCODED (`%0D`, `%09`, `%1B`, `%7F`, `%85`) → `control`. The encoded half matters most
 *     for an opaque URI, which is returned as written and never normalised by the `URL` parser;
 *   - a NUL, raw or percent-encoded (`%00`) → `nul`;
 *   - text after a closing quote (`https://x" --foo`, `"C:\a.txt" --flag`) → CUT, keeping the value
 *     before it. A leading `"` or `'` encloses; any other `"` ends the value. An apostrophe inside a
 *     path is kept (`Bob's files`), because only a leading one encloses.
 *
 * Shell metacharacters — `& | ; ^ ( ) < >` — are **kept** (FR-156b): nothing here reaches a shell, and
 * refusing them would make `D:\R&D\notes.txt` unfollowable for no protection at all.
 *
 * A hierarchical URI (`scheme://…`, a scheme of two or more characters) leaves as the WHATWG `URL`
 * parser's serialisation — one normalised string — and one the parser rejects is `malformed`. A path, and
 * an opaque URI such as `mailto:`, is returned as written, trimmed.
 *
 * Pure and total.
 */
export type Sanitised =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly why: 'control' | 'nul' | 'malformed' | 'device' };

/**
 * The Win32 DEVICE NAMESPACE: `\\?\…` and `\\.\…`, in either separator (review round four, M2).
 *
 * It matches the UNC shape every layer tests with (`^[\\/]{2}[^\\/]+[\\/]` — `?` and `.` are both
 * `[^\\/]`), so without this it classified `unc`, drew as a link, was returned verbatim by
 * `resolveCandidate`, was stat-ed, and was handed to the OS file manager.
 *
 * Refusing it is the answer rather than supporting it, for two reasons and the second is the one that
 * matters. There is nothing to open — `\\.\pipe\…` names a device object, not a file, and Explorer
 * declines a `\\?\` spelling — so the best case was one `refused` notice for a gesture that could
 * never have worked. And **`\\?\` is precisely the prefix that disables Win32 path normalisation**,
 * while `isLinkInProject` → `isUnderPath`, and `comparable()` in `file-link-resolver.ts`, are string
 * comparisons that assume normalised input. A `\\?\` spelling is therefore a second spelling of a path
 * that FR-021's confinement check has never been shown to agree about; refusing the spelling costs a
 * link nobody clicks and removes the question.
 *
 * A server may still be named anything that is not exactly `?` or `.`, and a FILE named `?` or `.foo`
 * inside an ordinary share is untouched — the test is on the first component only.
 */
const DEVICE_NAMESPACE = /^[\\/]{2}[.?][\\/]/;

/** {@link DEVICE_NAMESPACE} as a question, for the one other gate that asks what a target is. */
export function isDeviceNamespacePath(text: string): boolean {
  return DEVICE_NAMESPACE.test(text.trim());
}

/**
 * A hierarchical URI — `scheme://`. Only these go through the `URL` parser: an opaque `mailto:a@b.c`
 * needs no normalising, and a path with a position (`Makefile:12`, `README.md:10`) would be taken for a
 * scheme and have its name lower-cased.
 */
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:\/\//;
const ENCODED_NUL = /%00/i;

/**
 * A percent-encoded control character: C0 (`%00`–`%1F`), DEL (`%7F`) and C1 (`%80`–`%9F`).
 *
 * `hasControl` reads raw code units, so an ENCODED control character is invisible to it — and the
 * receiver is the thing that decodes. An OPAQUE URI makes that reachable rather than theoretical:
 * `URI_SCHEME` requires `://`, so `mailto:a@b.c%0D%0ABcc:someone@elsewhere.example` never reaches the
 * `URL` parser, leaves here exactly as written, and is handed to the scheme's OS handler — which may
 * read the encoded break as a header the user never typed. `%09`, `%1B` and `%7F` are the same shape.
 *
 * Applied to EVERY target, path as well as URI, for the same reason `%00` already is: a file whose
 * name genuinely contains `%` followed by two hex digits in the control range is a case nobody has
 * met, and failing closed on it costs an underline, while failing open costs a fabricated argument.
 */
const ENCODED_CONTROL = /%(?:[01][0-9A-F]|7F|[89][0-9A-F])/i;

export function sanitiseLinkTarget(raw: string): Sanitised {
  if (raw.includes(String.fromCharCode(0)) || ENCODED_NUL.test(raw)) return { ok: false, why: 'nul' };
  // Checked against the WHOLE raw text, before the quoted tail is cut, for the same reason the raw
  // control check below is: a crafted tail is not made safe by being dropped.
  if (ENCODED_CONTROL.test(raw)) return { ok: false, why: 'control' };

  const value = cutQuotedTail(raw.trim()).trim();
  if (value.length === 0) return { ok: false, why: 'malformed' };
  if (hasControl(value)) return { ok: false, why: 'control' };
  // Trimming removed only surrounding whitespace; a control character left in the kept value, or in
  // the text cut away, is refused either way — a crafted tail is not made safe by being dropped.
  if (hasControl(raw.trim())) return { ok: false, why: 'control' };
  if (DEVICE_NAMESPACE.test(value)) return { ok: false, why: 'device' };

  if (!URI_SCHEME.test(value)) return { ok: true, value };
  try {
    return { ok: true, value: new URL(value).href };
  } catch {
    return { ok: false, why: 'malformed' };
  }
}

/** A leading quote encloses the value; any other double quote ends it. */
function cutQuotedTail(text: string): string {
  const first = text[0];
  if (first === '"' || first === "'") {
    const close = text.indexOf(first, 1);
    return close < 0 ? text.slice(1) : text.slice(1, close);
  }
  const quote = text.indexOf('"');
  return quote < 0 ? text : text.slice(0, quote);
}

function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}
