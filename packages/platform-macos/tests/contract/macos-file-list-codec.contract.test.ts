import { execFile } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipUnlessMacos } from '@throng/core/testing';
import { MacosFileListCodec } from '../../src/macos-file-list-codec.js';
import { pasteboardFileUrls } from '../../src/pasteboard-file-urls.js';
import { APPKIT_PATH, LIBOBJC_PATH } from '../../src/objc-runtime.js';

/**
 * Layer: contract — only the real system pasteboard shows what Finder's Copy puts there and what Cocoa reads back
 * (070 FR-023, research R7, T068); the unit test can only check the codec against fixtures written from the docs.
 *
 * The pasteboard is driven through JXA (`osascript -l JavaScript`). A codec format key names a raw pasteboard type as
 * `electron application/osclipboard;format="<type>"`, and `ElectronClipboard` hands the codec that type's bytes, so
 * this reads and writes exactly those bytes. Electron's own mapping from key to type is not exercised here: that is
 * the app's, and only an E2E in the running app shows it.
 */
const run = promisify(execFile);

async function jxa(lines: readonly string[], ...args: string[]): Promise<string> {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', lines.join('\n'), ...args], { timeout: 20_000, encoding: 'utf8' });
  return stdout.trim();
}

const PASTEBOARD = ["ObjC.import('AppKit');", 'const pb = $.NSPasteboard.generalPasteboard;'];

/** Every item on the pasteboard, each type's bytes as base64, so the user's clipboard can be put back afterwards. */
const SNAPSHOT = [
  ...PASTEBOARD,
  'function run() {',
  '  const items = pb.pasteboardItems;',
  '  const out = [];',
  '  for (let i = 0; i < items.count; i++) {',
  '    const item = items.objectAtIndex(i);',
  '    const types = item.types;',
  '    const entry = {};',
  '    for (let j = 0; j < types.count; j++) {',
  '      const type = ObjC.unwrap(types.objectAtIndex(j));',
  '      const data = item.dataForType(type);',
  '      if (!data.isNil()) entry[type] = ObjC.unwrap(data.base64EncodedStringWithOptions(0));',
  '    }',
  '    out.push(entry);',
  '  }',
  '  return JSON.stringify(out);',
  '}',
];

const RESTORE = [
  ...PASTEBOARD,
  'function run(argv) {',
  '  pb.clearContents;',
  '  const items = JSON.parse(argv[0]);',
  "  if (items.length === 0) return 'cleared';",
  '  const objects = $.NSMutableArray.array;',
  '  for (const entry of items) {',
  '    const item = $.NSPasteboardItem.alloc.init;',
  '    for (const type of Object.keys(entry)) {',
  '      item.setDataForType($.NSData.alloc.initWithBase64EncodedStringOptions(entry[type], 0), type);',
  '    }',
  '    objects.addObject(item);',
  '  }',
  "  return pb.writeObjects(objects) ? 'restored' : 'refused';",
  '}',
];

/**
 * A copy of files as macOS 27 leaves it: one pasteboard item per file carrying its `public.file-url`, and no
 * `NSFilenamesPboardType` listing them all. Written in this process through the Objective-C runtime: JXA's writes
 * came back as one item for two, or as nothing once osascript had exited and its promised types went with it.
 */
function copyAsItems(paths: readonly string[]): void {
  const koffi = createRequire(import.meta.url)('koffi') as {
    load(path: string): { func(signature: string): (...args: unknown[]) => unknown };
  };
  koffi.load(APPKIT_PATH);
  const objc = koffi.load(LIBOBJC_PATH);
  const cls = objc.func('void *objc_getClass(const char *name)');
  const sel = objc.func('void *sel_registerName(const char *name)');
  const send = objc.func('void *objc_msgSend(void *self, void *op)');
  const sendText = objc.func('void *objc_msgSend(void *self, void *op, const char *text)');
  const sendObject = objc.func('void *objc_msgSend(void *self, void *op, void *arg)');
  const sendTwo = objc.func('uint8_t objc_msgSend(void *self, void *op, void *a, void *b)');
  const sendWrite = objc.func('uint8_t objc_msgSend(void *self, void *op, void *arg)');
  const sendClear = objc.func('long objc_msgSend(void *self, void *op)');
  const nsString = (text: string): unknown => sendText(cls('NSString'), sel('stringWithUTF8String:'), text);

  const board = send(cls('NSPasteboard'), sel('generalPasteboard'));
  sendClear(board, sel('clearContents'));
  const items = send(cls('NSMutableArray'), sel('array'));
  for (const path of paths) {
    const item = send(send(cls('NSPasteboardItem'), sel('alloc')), sel('init'));
    sendTwo(item, sel('setString:forType:'), nsString(pathToFileURL(path).href), nsString('public.file-url'));
    sendObject(items, sel('addObject:'), item);
  }
  expect(Number(sendWrite(board, sel('writeObjects:'), items)), 'the pasteboard refused the items').not.toBe(0);
}

/** The bytes of each named raw type at the pasteboard level, as a paste reads them; null where absent. */
const READ_TYPES = [
  ...PASTEBOARD,
  'function run(argv) {',
  '  const out = {};',
  '  for (const type of argv) {',
  '    const data = pb.dataForType(type);',
  '    out[type] = data.isNil() ? null : ObjC.unwrap(data.base64EncodedStringWithOptions(0));',
  '  }',
  '  return JSON.stringify(out);',
  '}',
];

/** Each raw type's bytes written to the pasteboard, as one write declaring them all. */
const WRITE_TYPES = [
  ...PASTEBOARD,
  'function run(argv) {',
  '  const entries = JSON.parse(argv[0]);',
  '  const types = Object.keys(entries);',
  '  pb.declareTypesOwner($(types), null);',
  '  for (const type of types) {',
  '    if (!pb.setDataForType($.NSData.alloc.initWithBase64EncodedStringOptions(entries[type], 0), type)) return type;',
  '  }',
  "  return 'ok';",
  '}',
];

/** Each pasteboard item's `public.file-url`, in order: what `pasteboardFileUrls` reads in process. */
const READ_ITEM_URLS = [
  ...PASTEBOARD,
  'function run() {',
  '  const items = pb.pasteboardItems;',
  '  const out = [];',
  "  for (let i = 0; i < items.count; i++) { const s = items.objectAtIndex(i).stringForType('public.file-url'); if (!s.isNil()) out.push(ObjC.unwrap(s)); }",
  '  return JSON.stringify(out);',
  '}',
];

/** What a Cocoa paste of files reads (Finder's among them): file URLs, as paths. */
const READ_FILE_URLS = [
  ...PASTEBOARD,
  'function run() {',
  '  const options = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSPasteboardURLReadingFileURLsOnlyKey);',
  '  const urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), options);',
  '  const out = [];',
  '  if (!urls.isNil()) for (let i = 0; i < urls.count; i++) out.push(ObjC.unwrap(urls.objectAtIndex(i).path));',
  '  return JSON.stringify(out);',
  '}',
];

/** The raw pasteboard type a codec format key names. */
const rawType = (format: string): string => /format="([^"]+)"/.exec(format)?.[1] ?? format;

describe.skipIf(skipUnlessMacos('drives the real system pasteboard through NSPasteboard'))('MacosFileListCodec on the real pasteboard', () => {
  const codec = new MacosFileListCodec();
  let saved = '[]';
  let dir = '';
  let files: string[] = [];

  beforeAll(async () => {
    saved = await jxa(SNAPSHOT);
    // realpath: the temporary folder is under /var, a symlink to /private/var, and a pasted URL names the real path.
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'throng-pasteboard-')));
    files = [join(dir, 'a & b.txt'), join(dir, "Fred's <notes>.md")];
    for (const file of files) writeFileSync(file, 'x');
  }, 30_000);

  afterAll(async () => {
    await jxa(RESTORE, saved);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('decodes a copy of two files with no Finder list, from the bytes a paste reads and the items behind them', { timeout: 30_000 }, async () => {
    copyAsItems(files);
    // The items one by one, read in process as the codec does and through JXA, so a disagreement says which is wrong.
    const items = JSON.parse(await jxa(READ_ITEM_URLS)) as string[];
    expect(pasteboardFileUrls(), `the in-process read, where JXA reads ${JSON.stringify(items)}`).toEqual(items);
    // What the copy put on the pasteboard, item by item, type by type: what a failed decode below is read against.
    const layout = (JSON.parse(await jxa(SNAPSHOT)) as Record<string, string>[]).map((item) => Object.keys(item));
    const read = JSON.parse(await jxa(READ_TYPES, ...codec.formats.map(rawType))) as Record<string, string | null>;
    const payloads: Record<string, Uint8Array> = {};
    for (const format of codec.formats) {
      const base64 = read[rawType(format)];
      if (base64) payloads[format] = Buffer.from(base64, 'base64');
    }
    expect(codec.decode(payloads), `the pasteboard held ${JSON.stringify(layout)}`).toEqual({ paths: files, intent: 'copy' });
  });

  it('writes a list that a Cocoa paste reads back as the same files, every one of them', { timeout: 30_000 }, async () => {
    const encoded = codec.encode({ paths: files, intent: 'copy' });
    const entries = Object.fromEntries(
      Object.entries(encoded).map(([format, value]) => [rawType(format), Buffer.from(value).toString('base64')]),
    );
    expect(await jxa(WRITE_TYPES, JSON.stringify(entries))).toBe('ok');
    expect(JSON.parse(await jxa(READ_FILE_URLS))).toEqual(files);
  });
});
