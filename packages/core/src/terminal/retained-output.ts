import { TERMINAL_RETAINED_CHARS, TERMINAL_RETAINED_LINES } from './output-constants.js';

const LF = '\n';

/** Recent chunks are joined into blocks this size, so a terminal holds a few long strings rather than thousands of short ones. */
const BLOCK_CHARS = 64 * 1024;

function countLines(text: string): number {
  let count = 0;
  for (let at = text.indexOf(LF); at !== -1; at = text.indexOf(LF, at + 1)) count += 1;
  return count;
}

/**
 * The output a terminal keeps for a returning view (061 FR-016): its latest lines, bounded in characters too, because
 * output that only rewrites one line never adds a line.
 *
 * A list of blocks evicted from the front, because the daemon hosting every terminal pays for this on every chunk it
 * reads: appending must not copy what is already kept. The text is joined only when a view attaches.
 *
 * What is kept always starts at the start of a line, so a replay never begins inside an escape sequence or half a row.
 * With no line feed to cut at, it drops to empty rather than replay from an arbitrary offset.
 */
export class RetainedOutput {
  private blocks: string[] = [];
  private blockLines: number[] = [];
  private head = 0;
  private tail: string[] = [];
  private tailChars = 0;
  private tailLines = 0;
  private lines = 0;
  private chars = 0;

  constructor(
    private readonly maxLines: number = TERMINAL_RETAINED_LINES,
    private readonly maxChars: number = TERMINAL_RETAINED_CHARS,
  ) {}

  /** Characters currently held. */
  get length(): number {
    return this.chars;
  }

  append(chunk: string): void {
    if (chunk.length === 0) return;
    const lines = countLines(chunk);
    this.tail.push(chunk);
    this.tailChars += chunk.length;
    this.tailLines += lines;
    this.lines += lines;
    this.chars += chunk.length;
    if (this.tailChars >= BLOCK_CHARS) this.sealTail();
    this.evict();
  }

  snapshot(): string {
    return this.blocks.slice(this.head).join('') + this.tail.join('');
  }

  private sealTail(): void {
    if (this.tail.length === 0) return;
    this.blocks.push(this.tail.join(''));
    this.blockLines.push(this.tailLines);
    this.tail = [];
    this.tailChars = 0;
    this.tailLines = 0;
  }

  private evict(): void {
    // True once text that did not end a line has gone: what follows now starts inside that line.
    let midLine = false;
    while (midLine || this.lines > this.maxLines || this.chars > this.maxChars) {
      if (this.head === this.blocks.length) this.sealTail();
      if (this.head === this.blocks.length) break;
      const front = this.blocks[this.head]!;
      const cut = this.cutPoint(front, midLine);
      if (cut === -1 || cut >= front.length) {
        this.lines -= this.blockLines[this.head]!;
        this.chars -= front.length;
        this.head += 1;
        midLine = !front.endsWith(LF);
      } else {
        const removed = countLines(front.slice(0, cut));
        this.lines -= removed;
        this.chars -= cut;
        this.blocks[this.head] = front.slice(cut);
        this.blockLines[this.head]! -= removed;
        midLine = false;
      }
    }
    this.compact();
  }

  /** Where in `front` the kept text must start, or -1 if nothing in it can start a line. */
  private cutPoint(front: string, midLine: boolean): number {
    let cut = 0;
    for (let excess = this.lines - this.maxLines; excess > 0; excess -= 1) {
      const at = front.indexOf(LF, cut);
      if (at === -1) return -1;
      cut = at + 1;
    }
    cut = Math.max(cut, this.chars - this.maxChars);
    if (cut === 0 && !midLine) return 0;
    if (cut > 0 && cut <= front.length && front[cut - 1] === LF) return cut;
    const at = front.indexOf(LF, cut);
    return at === -1 ? -1 : at + 1;
  }

  private compact(): void {
    if (this.head < 64 || this.head * 2 < this.blocks.length) return;
    this.blocks = this.blocks.slice(this.head);
    this.blockLines = this.blockLines.slice(this.head);
    this.head = 0;
  }
}
