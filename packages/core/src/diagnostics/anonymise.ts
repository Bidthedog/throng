/**
 * 068 FR-034a to FR-034f (#623) — the anonymiser every diagnostic log line passes through.
 *
 * Pure: no Node import (`no-os-imports.test.ts`), so the keyed hash arrives by injection from
 * `@throng/platform-node`. It does two things in order:
 *
 * 1. **Known values first**, longest first — a project root becomes `<project:ID>` plus a token for
 *    the remainder, the home folder, user data folder, username, hostname and other environment
 *    folders become `<kind-xxxxxxxx>`, and the install folder becomes `<install>` with the relative
 *    file and `:line:col` kept so a stack frame stays useful.
 * 2. **A pattern pass** for whatever is left that still looks like a path or an account: drive,
 *    UNC, `\\?\` and `\\.\pipe\` names, POSIX absolute paths, `file:///` URLs, `~/`, relative
 *    paths, the quoted names of an errno message, and `user@host`.
 *
 * Tokens are keyed hashes, never counters: `main.log` and `daemon.log` are reopened across runs and
 * shared across processes, so the same value must give the same token everywhere (research D10).
 * Over-redaction costs readability, never privacy (FR-034f), so every ambiguity resolves to a token.
 */

export type AnonKind =
  | 'projectRoot'
  | 'projectName'
  | 'home'
  | 'userData'
  | 'install'
  | 'user'
  | 'host'
  | 'path';

export interface Anonymiser {
  /** Teach it one value. `id` names a project (`<project:ID>`). Registering twice is harmless. */
  register(kind: AnonKind, value: string, id?: string): void;
  /** The text with every known and recognisable path, name and account replaced by a token. */
  apply(text: string): string;
  /**
   * The stable `<label-xxxxxxxx>` token for a value the caller KNOWS is a name (a file, a panel, a
   * tab), where `apply` would leave a bare name alone because nothing marks it as one.
   */
  token(label: string, value: string): string;
}

export interface AnonymiserOptions {
  salt: string;
  os: 'windows' | 'linux';
  /** Keyed hash, hex. HMAC-SHA256 in production; injected so core imports no Node builtin. */
  hash: (salt: string, value: string) => string;
}

const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);
/** Characters that end an unregistered path. The two marker characters keep held text out of it. */
const STOP = `\\s'"<>|*?),;${OPEN}${CLOSE}`;
/**
 * Words that end the continuation of a path through spaces (see CONT): the small words of prose that
 * commonly follow a path in a log line. A path followed by one of these is over, so the sentence
 * stays readable; anything else after a space is taken to be part of a spaced name.
 */
// One space-separated string, not an array of quoted words: `packaged-runtime-deps.test.ts` scans
// source text for import specifiers, and the word f-r-o-m directly before a quote reads as one.
const PROSE_STOP_WORDS = (
  'a about after again an and are as at because before but by can ' +
  'cannot could did do does end error exit exited failed fails for from has ' +
  'have if in into is it its not now of on or so that the ' +
  'then to was were when which while will with without'
)
  .split(' ')
  .join('|');

/**
 * The continuation of an UNREGISTERED path through spaces (review fix: a name with spaces leaked its
 * tail). After the space-free run, up to six more space-separated words belong to the path, so a name
 * like `Acme Merger Plan.md` or `Project Phoenix` is taken whole. The path ends before a prose stop
 * word, a `key=value` or an opening bracket, or once a word ENDS IN AN EXTENSION (`.md`, `.docx`).
 * Leaking a name is worse than eating a word of prose (FR-034f), so every doubt resolves to "continue".
 */
const CONT =
  `(?:(?<!\\.[A-Za-z0-9]{1,8})[ \\t]+(?!(?:${PROSE_STOP_WORDS})\\b)(?![^\\s=]+=)(?![(\\[{])` +
  `[^${STOP}]*[^${STOP}.:,]){0,6}`;

const HELD = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g');
const TAIL = /(?:(?::\d+){1,2}|[.,;:]+)$/;

const LABEL: Record<AnonKind, string> = {
  projectRoot: 'project',
  projectName: 'project',
  home: 'home',
  userData: 'userdata',
  install: 'install',
  user: 'user',
  host: 'host',
  path: 'path',
};

const ROOTED: ReadonlySet<AnonKind> = new Set(['projectRoot', 'home', 'userData', 'install', 'path']);

interface Entry {
  kind: AnonKind;
  id?: string;
  value: string;
  re: RegExp;
}

/**
 * `%XX` runs decoded as UTF-8. Never throws: the anonymiser sits under the console tee, so a catch
 * that logged would feed itself, and a malformed run simply decodes to replacement characters.
 */
function percentDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    return new TextDecoder().decode(bytes);
  });
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SENSITIVE_OPEN = String.fromCharCode(3);
const SENSITIVE_SEP = String.fromCharCode(4);
const SENSITIVE_CLOSE = String.fromCharCode(5);
const SENSITIVE_SPAN = new RegExp(
  `${SENSITIVE_OPEN}([a-z][a-z-]*)${SENSITIVE_SEP}([\\s\\S]*?)(?:${SENSITIVE_CLOSE}|$)`,
  'g',
);

/**
 * Mark `text` as sensitive free text of a `kind` (a command, a prompt, a title): the anonymiser turns
 * the span into `<kind-xxxxxxxx>` whatever is inside it, even where nothing in it looks like a path or
 * a name. For the caller that KNOWS a value is the user's own words — the pattern pass cannot
 * recognise those, so the call site says so (068 FR-034b).
 *
 * The result travels through `console` and IPC like any string; only the anonymiser reads the marks.
 */
export function sensitive(kind: 'command' | 'prompt' | 'title' | 'input' | 'line', text: string): string {
  const clean = text.split(SENSITIVE_OPEN).join('').split(SENSITIVE_SEP).join('').split(SENSITIVE_CLOSE).join('');
  return `${SENSITIVE_OPEN}${kind}${SENSITIVE_SEP}${clean}${SENSITIVE_CLOSE}`;
}

export function createAnonymiser(opts: AnonymiserOptions): Anonymiser {
  const win = opts.os === 'windows';
  const sep = win ? '[\\\\/]+' : '/+';
  const flags = win ? 'gi' : 'g';
  const entries: Entry[] = [];
  const seen = new Set<string>();

  const norm = (value: string): string => {
    const v = win ? value.replace(/[\\/]+/g, '/').toLowerCase() : value;
    return v.length > 1 ? v.replace(/\/+$/, '') : v;
  };
  const digest = (value: string): string => opts.hash(opts.salt, norm(value)).slice(0, 8);
  const token = (label: string, value: string): string => `<${label}-${digest(value)}>`;

  const entryToken = (e: Entry): string => {
    if (e.kind === 'install') return '<install>';
    if ((e.kind === 'projectRoot' || e.kind === 'projectName') && e.id) return `<project:${e.id}>`;
    return token(LABEL[e.kind], e.value);
  };

  const splitTail = (text: string): [string, string] => {
    const m = TAIL.exec(text);
    return m ? [text.slice(0, text.length - m[0].length), m[0]] : [text, ''];
  };

  const register = (kind: AnonKind, value: string, id?: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const stripped = trimmed.length > 1 ? trimmed.replace(/[\\/]+$/, '') : trimmed;
    if (!stripped || /^[\\/]+$/.test(stripped)) return;
    const key = `${kind}|${norm(stripped)}|${id ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const source = stripped.split(win ? /[\\/]+/ : /\/+/).map(escapeRe).join(sep);
    const rooted = ROOTED.has(kind);
    const re = new RegExp(
      `(?<![A-Za-z0-9_])${source}(?![A-Za-z0-9_])` + (rooted ? `([\\\\/][^${STOP}]*${CONT})?` : ''),
      flags,
    );
    entries.push({ kind, id, value: stripped, re });
    entries.sort((a, b) => b.value.length - a.value.length);
  };

  const apply = (text: string): string => {
    if (!text) return text;
    const held: string[] = [];
    const hold = (s: string): string => {
      held.push(s);
      return `${OPEN}${held.length - 1}${CLOSE}`;
    };
    const pathToken = (p: string): string => token('path', p);

    const registered = (input: string): string => {
      let t = input;
      for (const e of entries) {
        t = t.replace(e.re, (_m: string, group?: unknown) => {
          // An unrooted pattern has no capture group, so the second argument is then the offset.
          const rem = typeof group === 'string' ? group : undefined;
          const tok = entryToken(e);
          if (!rem) return hold(tok);
          if (e.kind === 'install') return hold(tok + rem);
          const [core, tail] = splitTail(rem);
          const rest = core.replace(/^[\\/]+/, '');
          return hold(rest ? `${tok}/${pathToken(rest)}${tail}` : tok + rem);
        });
      }
      return t;
    };

    // The anonymiser's own marker characters never arrive from outside: a forged one would be read back
    // as a held value. Stripping them also keeps `restore` from meeting a marker it did not write.
    let t = text.split(OPEN).join('').split(CLOSE).join('');

    // A span a caller marked with `sensitive()`: tokenised whole, whatever is in it (an unterminated
    // one, cut by a size cap, runs to the end).
    t = t.replace(SENSITIVE_SPAN, (_m: string, kind: string, inner: string) => hold(token(kind, inner)));

    // file:/// URLs: decode, then treat as a path. Whatever the known values miss is tokenised whole.
    t = t.replace(/file:\/\/\/?[^\s'"<>)]+/gi, (url) => {
      let decoded = percentDecode(url.replace(/^file:\/\/\/?/i, ''));
      if (!/^[A-Za-z]:/.test(decoded)) decoded = `/${decoded}`;
      const out = registered(decoded);
      return hold(out.includes(OPEN) ? out : pathToken(decoded));
    });

    t = registered(t);

    // A quoted path: the whole of what is inside the quotes goes, spaces and all.
    t = t.replace(/(["'])((?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])[^\n]*?)\1/g, (m: string, q: string, content: string) =>
      content.includes(OPEN) ? m : `${q}${hold(pathToken(content))}${q}`,
    );

    // errno messages quote the offending name, which may hold spaces.
    t = t.replace(
      /(\bE[A-Z0-9]{3,9}:[^'"\n]*?)((?:'[^'\n]*'|"[^"\n]*")(?:\s*->\s*(?:'[^'\n]*'|"[^"\n]*"))?)/g,
      (_m, head: string, quoted: string) =>
        head +
        quoted.replace(/'([^'\n]*)'|"([^"\n]*)"/g, (q: string, a?: string, b?: string) => {
          const content = a ?? b ?? '';
          return !content || content.includes(OPEN) ? q : `${q[0]}${hold(pathToken(content))}${q[0]}`;
        }),
    );

    const tokenise = (m: string): string => {
      const [core, tail] = splitTail(m);
      return core ? hold(pathToken(core)) + tail : m;
    };
    const run = new RegExp(`[^${STOP}]`).source;
    const runNoSlash = new RegExp(`[^${STOP}/]`).source;

    // UNC, \\?\ and \\.\pipe\ names (with the doubled spelling JSON gives them).
    t = t.replace(new RegExp(`(?<![\\\\\\w])\\\\{2,4}${run}+${CONT}`, 'g'), tokenise);
    // Drive paths, either separator, JSON-escaped.
    t = t.replace(new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:[\\\\/]${run}*${CONT}`, 'g'), tokenise);
    // POSIX absolute paths (not a URL's authority or path, not a closing tag).
    t = t.replace(new RegExp(`(?<![\\w.:/\\\\<)])/${runNoSlash}+(?:/${runNoSlash}*)*${CONT}`, 'g'), tokenise);
    // ~/ paths.
    t = t.replace(new RegExp(`(?<![\\w])~[\\\\/]${run}+${CONT}`, 'g'), tokenise);
    // Relative paths with a separator; prose such as "and/or" and "1/2" is left alone.
    const relSep = win ? '[\\\\/]+' : '/';
    t = t.replace(
      new RegExp(`(?<![\\w.@/\\\\:~-])[\\w.@-]+(?:${relSep}[\\w.@-]+)+`, 'g'),
      (m: string) => {
        const parts = m.split(win ? /[\\/]+/ : /\//);
        const last = parts[parts.length - 1] ?? '';
        const looksLikePath = parts.length > 2 || /\.[A-Za-z0-9]{1,8}$/.test(last);
        return /[A-Za-z]/.test(m) && looksLikePath ? tokenise(m) : m;
      },
    );
    // user@host
    t = t.replace(
      /(?<![\w.+-])([\w.+-]+)@([A-Za-z0-9][\w-]*(?:\.[\w-]+)*)/g,
      (m: string, user: string, host: string) =>
        /[A-Za-z]/.test(host) ? hold(`${token('user', user)}@${token('host', host)}`) : m,
    );

    const restore = (s: string): string => s.replace(HELD, (_m, i: string) => restore(held[Number(i)] ?? ''));
    return restore(t);
  };

  return { register, apply, token };
}
