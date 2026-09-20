import type { IRefusedUriSchemes } from '../abstractions/refused-uri-schemes.js';

/**
 * Reusable contract suite for any `IRefusedUriSchemes` implementation (045 FR-159,
 * `contracts/platform-ports.md` §7.1).
 *
 * Pure-throw, in the style of `executable-extensions-contract.ts`: imports nothing, throws
 * `IRefusedUriSchemes contract violation: …` on the first breach.
 *
 * It asserts the SHAPE of the answer — non-empty, lower-case scheme names with no colon, never a web
 * scheme, the same every time — and names no platform scheme: the implementation supplies the content,
 * and its own contract test pins the entries (for Windows, research R27's list).
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IRefusedUriSchemes contract violation: ${message}`);
}

export function runRefusedUriSchemesContract(makeSubject: () => IRefusedUriSchemes): void {
  const subject = makeSubject();
  const first = subject.refusedSchemes();
  const schemes = [...first];

  assert(schemes.length > 0, 'refusedSchemes() must be non-empty — a platform that refuses nothing adds nothing to core’s half');
  for (const scheme of schemes) {
    assert(typeof scheme === 'string' && scheme.length > 0, `every entry must be a non-empty string; got ${JSON.stringify(scheme)}`);
    assert(scheme === scheme.toLowerCase(), `entries are compared lower-case; got ${JSON.stringify(scheme)}`);
    assert(!scheme.includes(':'), `an entry is a scheme NAME, with no colon; got ${JSON.stringify(scheme)}`);
    assert(/^[a-z][a-z0-9+.-]*$/.test(scheme), `an entry must be a valid scheme name; got ${JSON.stringify(scheme)}`);
  }
  for (const web of ['http', 'https']) {
    assert(!first.has(web), `${web} must never be refused — web links are FR-157's class 1`);
  }

  const second = subject.refusedSchemes();
  assert(
    second.size === first.size && [...second].every((s) => first.has(s)),
    'refusedSchemes() must be stable across calls — the renderer asks once per window (research R34)',
  );
}
