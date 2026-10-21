/**
 * 057 — terminal attention signals recognised in a session's output (research R2).
 *
 * The daemon reads every byte of every terminal, so it finds the signals here: a bell, a desktop
 * notification (OSC 9, OSC 777 `notify`, OSC 99), and the end of a progress indication (OSC 9;4). One scanner
 * per session; it is stateful because a sequence can be split across chunks and because "progress ended"
 * needs the previous progress state.
 *
 * Pure. The fast path is two `indexOf` calls and a tail test, so ordinary output costs next to nothing
 * (SC-004). An unterminated OSC string is carried into the next chunk up to {@link MAX_OSC}; a longer one is
 * discarded, along with whatever eventually terminates it, so the terminator is never read as a bell.
 */
import type { AttentionKind } from '../attention/attention-types.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC_OPENER = `${ESC}]`;
/** Longest OSC string carried between chunks. */
const MAX_OSC = 4096;
/** FR-068: the longest message kept, ellipsis included. */
const MAX_MESSAGE = 200;
/** ConEmu's numeric subcommands (`9;9;cwd`, `9;4;…`): FR-060a. */
const NUMERIC_SUBCOMMAND = /^\d+(;|$)/;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;

/** The most OSC 99 notifications held half-sent at once; the oldest is dropped past it. */
const MAX_KITTY_PENDING = 16;

/**
 * Terminal replies and reports an emulator writes to the program by itself — device attributes, cursor and
 * status reports, kitty keyboard flags, focus and mouse reports, mode reports, OSC and DCS replies. A write
 * made up of nothing else is not the user typing, so it must not count as input (R8). Keys that are also
 * escape sequences (arrows, function keys) are NOT reports.
 */
const REPORT = new RegExp(
  `^(?:${ESC}\\[(?:\\d+;\\d+R|\\?[\\d;]*R|[?>=][\\d;:]*c|\\?[\\d;:]*u|[IO]|<[\\d;]+[Mm]|\\?[\\d;]*\\$y|[\\d;]*n)` +
    `|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)` +
    `|${ESC}P[^${ESC}]*${ESC}\\\\)+$`,
);

export function isTerminalReport(data: string): boolean {
  return data.length > 0 && REPORT.test(data);
}

/** What the scanner found. `detail` is sanitised message text, or null. */
export interface AttentionHit {
  signal: 'bell' | 'notification' | 'progressEnded';
  kind: AttentionKind;
  detail: string | null;
}

export interface AttentionScanner {
  scan(chunk: string): AttentionHit[];
}

/** FR-068: strip control characters, fold to one line, cap at 200 characters; empty becomes null. */
export function sanitiseAttentionText(text: string): string | null {
  const oneLine = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(CONTROLS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (oneLine === '') return null;
  return oneLine.length > MAX_MESSAGE ? `${oneLine.slice(0, MAX_MESSAGE - 1)}…` : oneLine;
}

export function createAttentionScan(): AttentionScanner {
  /** The unterminated tail of the last chunk: an OSC opener onward, or a lone ESC. */
  let carry = '';
  /** Inside an over-long OSC string: skipping to its terminator. */
  let discarding = false;
  /** OSC 9;4 state last seen: 0 none, 1 set, 2 error, 3 indeterminate, 4 paused. */
  let progress = 0;
  /** OSC 99 notifications still being sent in chunks, by id (kitty's `i=`). */
  const kitty = new Map<string, { title: string; body: string }>();

  function osc(body: string, hits: AttentionHit[]): void {
    if (body.startsWith('9;')) {
      const rest = body.slice(2);
      if (rest.startsWith('4;') || rest === '4') {
        const st = Number.parseInt(rest.slice(2), 10);
        if (!Number.isFinite(st)) return;
        if (st === 2) {
          progress = 0;
          hits.push({ signal: 'progressEnded', kind: 'failed', detail: null });
        } else if (st === 0) {
          if (progress !== 0) hits.push({ signal: 'progressEnded', kind: 'attention', detail: null });
          progress = 0;
        } else {
          progress = st;
        }
        return;
      }
      if (NUMERIC_SUBCOMMAND.test(rest)) return;
      hits.push({ signal: 'notification', kind: 'attention', detail: sanitiseAttentionText(rest) });
    } else if (body.startsWith('777;notify;')) {
      const rest = body.slice('777;notify;'.length);
      const split = rest.indexOf(';');
      const title = split < 0 ? rest : rest.slice(0, split);
      const text = split < 0 ? '' : rest.slice(split + 1);
      const message = text === '' ? title : `${title}: ${text}`;
      hits.push({ signal: 'notification', kind: 'attention', detail: sanitiseAttentionText(message) });
    } else if (body.startsWith('99;')) {
      const rest = body.slice(3);
      const split = rest.indexOf(';');
      if (split < 0) return;
      const meta = new Map<string, string>();
      for (const pair of rest.slice(0, split).split(':')) {
        const eq = pair.indexOf('=');
        if (eq > 0) meta.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      let payload = rest.slice(split + 1);
      if (meta.get('e') === '1') {
        try {
          const binary = atob(payload);
          payload = new TextDecoder('utf-8').decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
        } catch {
          return;
        }
      }
      const part = meta.get('p') ?? 'title';
      if (part !== 'title' && part !== 'body') return;
      // Chunks of one notification share an id; the text of each part is the chunks laid end to end.
      const id = meta.get('i') ?? '';
      let pending = kitty.get(id);
      if (pending === undefined) {
        pending = { title: '', body: '' };
        kitty.set(id, pending);
        if (kitty.size > MAX_KITTY_PENDING) kitty.delete(kitty.keys().next().value as string);
      }
      pending[part] += payload;
      if ((meta.get('d') ?? '1') === '0') return;
      kitty.delete(id);
      const message = pending.title !== '' && pending.body !== '' ? `${pending.title}: ${pending.body}` : pending.title + pending.body;
      hits.push({ signal: 'notification', kind: 'attention', detail: sanitiseAttentionText(message) });
    }
  }

  return {
    scan(chunk) {
      if (
        carry === '' &&
        !discarding &&
        chunk.indexOf(BEL) === -1 &&
        chunk.indexOf(OSC_OPENER) === -1 &&
        !chunk.endsWith(ESC)
      ) {
        return [];
      }
      const hits: AttentionHit[] = [];
      const text = carry + chunk;
      carry = '';
      let i = 0;
      if (discarding) {
        const end = terminatorAt(text, 0);
        if (end === null) {
          // A lone trailing ESC may be the first half of the terminator.
          if (text.endsWith(ESC)) carry = ESC;
          return hits;
        }
        if (end.incomplete) {
          carry = text.slice(end.at);
          return hits;
        }
        discarding = false;
        i = end.at + end.length;
      }
      while (i < text.length) {
        const ch = text[i];
        if (ch === BEL) {
          hits.push({ signal: 'bell', kind: 'attention', detail: null });
          i++;
        } else if (ch === ESC) {
          if (i + 1 >= text.length) {
            carry = ESC;
            break;
          }
          if (text[i + 1] !== ']') {
            i++;
            continue;
          }
          const end = terminatorAt(text, i + 2);
          if (end === null || end.incomplete) {
            const rest = text.slice(i);
            if (rest.length <= MAX_OSC) carry = rest;
            else discarding = true;
            break;
          }
          if (end.length > 0) osc(text.slice(i + 2, end.at), hits);
          // length 0: an ESC followed by something else cancelled the string; re-read from that ESC.
          i = end.at + end.length;
        } else {
          i++;
        }
      }
      return hits;
    },
  };
}

interface Terminator {
  at: number;
  length: number;
  /** The text ends on an ESC that may yet become ESC \. */
  incomplete?: boolean;
}

/** Find the end of an OSC string whose body starts at `from`: BEL, ESC \, or a cancelling ESC. */
function terminatorAt(text: string, from: number): Terminator | null {
  for (let j = from; j < text.length; j++) {
    const ch = text[j];
    if (ch === BEL) return { at: j, length: 1 };
    if (ch === ESC) {
      if (j + 1 >= text.length) return { at: j, length: 0, incomplete: true };
      if (text[j + 1] === '\\') return { at: j, length: 2 };
      return { at: j, length: 0 };
    }
  }
  return null;
}
