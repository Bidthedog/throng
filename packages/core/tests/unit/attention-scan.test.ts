import { describe, expect, it } from 'vitest';
import { createAttentionScan, sanitiseAttentionText } from '../../src/terminal/attention-scan.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ST = `${ESC}\\`;
const osc = (body: string, end = BEL) => `${ESC}]${body}${end}`;

describe('attention scan', () => {
  it('reports a BEL outside an OSC as a bell', () => {
    const scan = createAttentionScan();
    expect(scan.scan(`hello${BEL}world`)).toEqual([{ signal: 'bell', kind: 'attention', detail: null }]);
  });

  it('reports one hit per BEL', () => {
    expect(createAttentionScan().scan(`${BEL}${BEL}`)).toHaveLength(2);
  });

  it('plain output yields nothing', () => {
    expect(createAttentionScan().scan('ls -la\r\nfile.txt\r\n')).toEqual([]);
  });

  it('a BEL that terminates an OSC is not a bell', () => {
    expect(createAttentionScan().scan(osc('0;title'))).toEqual([]);
  });

  it('OSC 9 text is a notification, with either terminator', () => {
    expect(createAttentionScan().scan(osc('9;Build done'))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'Build done' },
    ]);
    expect(createAttentionScan().scan(osc('9;Build done', ST))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'Build done' },
    ]);
  });

  it('ConEmu subcommands are not notifications (FR-060a)', () => {
    const scan = createAttentionScan();
    expect(scan.scan(osc('9;9;C:\\work'))).toEqual([]);
    expect(scan.scan(osc('9;1;500'))).toEqual([]);
    expect(scan.scan(osc('9;12'))).toEqual([]);
    expect(scan.scan(osc('9;4;1;50'))).toEqual([]);
  });

  it('a progress set followed by a remove is progress completed', () => {
    const scan = createAttentionScan();
    expect(scan.scan(osc('9;4;1;10'))).toEqual([]);
    expect(scan.scan(osc('9;4;1;90'))).toEqual([]);
    expect(scan.scan(osc('9;4;0'))).toEqual([{ signal: 'progressEnded', kind: 'attention', detail: null }]);
    expect(scan.scan(osc('9;4;0'))).toEqual([]);
  });

  it('progress state 2 is an error and is Failed; the remove after it adds nothing', () => {
    const scan = createAttentionScan();
    expect(scan.scan(osc('9;4;2;50'))).toEqual([{ signal: 'progressEnded', kind: 'failed', detail: null }]);
    expect(scan.scan(osc('9;4;0'))).toEqual([]);
  });

  it('a bare remove with no preceding set is nothing', () => {
    expect(createAttentionScan().scan(osc('9;4;0'))).toEqual([]);
  });

  it('OSC 777 notify carries title and body', () => {
    expect(createAttentionScan().scan(osc('777;notify;Build;All green'))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'Build: All green' },
    ]);
    expect(createAttentionScan().scan(osc('777;notify;Only title;'))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'Only title' },
    ]);
    expect(createAttentionScan().scan(osc('777;precmd'))).toEqual([]);
  });

  it('OSC 99 reports the final chunk; title and body are joined', () => {
    const scan = createAttentionScan();
    expect(scan.scan(osc('99;i=1:d=0:p=title;Build', ST))).toEqual([]);
    expect(scan.scan(osc('99;i=1:d=1:p=body;done', ST))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'Build: done' },
    ]);
    expect(createAttentionScan().scan(osc('99;;Hello', ST))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'Hello' },
    ]);
  });

  it('OSC 99 concatenates d=0 body chunks by id with no separator, and joins the title once', () => {
    const scan = createAttentionScan();
    expect(scan.scan(osc('99;i=7:d=0:p=body;Hel', ST))).toEqual([]);
    expect(scan.scan(osc('99;i=7:d=1:p=body;lo', ST))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'Hello' },
    ]);
    const titled = createAttentionScan();
    expect(titled.scan(osc('99;i=1:d=0:p=title;T', ST))).toEqual([]);
    expect(titled.scan(osc('99;i=1:d=0:p=body;Hel', ST))).toEqual([]);
    expect(titled.scan(osc('99;i=1:d=1:p=body;lo', ST))).toEqual([
      { signal: 'notification', kind: 'attention', detail: 'T: Hello' },
    ]);
    // A later notification with the same id starts afresh.
    expect(titled.scan(osc('99;i=1:p=body;Again', ST))[0]!.detail).toBe('Again');
  });

  it('OSC 99 keeps different ids apart', () => {
    const scan = createAttentionScan();
    scan.scan(osc('99;i=1:d=0:p=body;one', ST));
    expect(scan.scan(osc('99;i=2:p=body;two', ST))[0]!.detail).toBe('two');
    expect(scan.scan(osc('99;i=1:p=body;!', ST))[0]!.detail).toBe('one!');
  });

  it('OSC 99 decodes e=1 base64 as UTF-8', () => {
    const encoded = Buffer.from('Café ☕', 'utf8').toString('base64');
    expect(createAttentionScan().scan(osc(`99;e=1:p=body;${encoded}`, ST))[0]!.detail).toBe('Café ☕');
  });

  it('reads a sequence split across chunks', () => {
    const scan = createAttentionScan();
    expect(scan.scan(`${ESC}]9;Build`)).toEqual([]);
    expect(scan.scan(` done${BEL}`)).toEqual([{ signal: 'notification', kind: 'attention', detail: 'Build done' }]);
  });

  it('reads an ESC \\ terminator split across chunks and a lone trailing ESC', () => {
    const scan = createAttentionScan();
    expect(scan.scan(`${ESC}]9;hi${ESC}`)).toEqual([]);
    expect(scan.scan('\\')).toEqual([{ signal: 'notification', kind: 'attention', detail: 'hi' }]);
    expect(scan.scan(ESC)).toEqual([]);
    expect(scan.scan(`]9;yo${BEL}`)).toEqual([{ signal: 'notification', kind: 'attention', detail: 'yo' }]);
  });

  it('drops an unterminated OSC beyond 4 KB, and its eventual terminator is not a bell', () => {
    const scan = createAttentionScan();
    expect(scan.scan(`${ESC}]9;${'x'.repeat(5000)}`)).toEqual([]);
    expect(scan.scan(`more${BEL}`)).toEqual([]);
    expect(scan.scan(BEL)).toEqual([{ signal: 'bell', kind: 'attention', detail: null }]);
  });

  it('survives other escape sequences', () => {
    expect(createAttentionScan().scan(`${ESC}[31mred${ESC}[0m${BEL}`)).toEqual([
      { signal: 'bell', kind: 'attention', detail: null },
    ]);
  });

  describe('sanitising (FR-068)', () => {
    it('strips control characters and collapses to one line', () => {
      expect(sanitiseAttentionText(`a\u0001b\r\nc\td`)).toBe('ab c d');
    });
    it('truncates at 200 characters with an ellipsis', () => {
      const out = sanitiseAttentionText('x'.repeat(500))!;
      expect(out).toHaveLength(200);
      expect(out.endsWith('…')).toBe(true);
    });
    it('keeps exactly 200 characters as they are', () => {
      expect(sanitiseAttentionText('y'.repeat(200))).toBe('y'.repeat(200));
    });
    it('turns empty into null', () => {
      expect(sanitiseAttentionText(' \u0001 \n')).toBeNull();
    });
    it('is applied to notification text', () => {
      expect(createAttentionScan().scan(osc('9;line one\u0001  two'))[0]!.detail).toBe('line one two');
    });
    it('a notification with no text has a null detail', () => {
      expect(createAttentionScan().scan(osc('9;'))).toEqual([{ signal: 'notification', kind: 'attention', detail: null }]);
    });
  });
});
