/**
 * The Objective-C runtime through koffi, for the few Cocoa calls that have no C API (070 R6, R7). Loaded once, lazily,
 * so a process on another OS that imports this package loads nothing.
 *
 * `objc_msgSend` is bound once per shape of message: on arm64 it is not variadic, and a call through a mismatched
 * prototype corrupts its arguments. Every object a caller makes is autoreleased, so callers work inside {@link pooled}.
 */
import { createRequire } from 'node:module';
import { logCaught } from '@throng/core';

const require = createRequire(import.meta.url);

export const LIBOBJC_PATH = '/usr/lib/libobjc.A.dylib';
export const FOUNDATION_PATH = '/System/Library/Frameworks/Foundation.framework/Foundation';
export const APPKIT_PATH = '/System/Library/Frameworks/AppKit.framework/AppKit';

/** An Objective-C object or class, as koffi hands it over; null is nil. */
export type Id = unknown;

export interface ObjcRuntime {
  readonly getClass: (name: string) => Id;
  readonly selector: (name: string) => Id;
  /** `[self op]` returning an object. */
  readonly sendId: (self: Id, op: Id) => Id;
  /** `[self op:text]`, `text` as a C string. */
  readonly sendIdText: (self: Id, op: Id, text: string) => Id;
  /** `[self op:arg]` returning an object. */
  readonly sendIdId: (self: Id, op: Id, arg: Id) => Id;
  /** `[self op:index]` returning an object. */
  readonly sendIdIndex: (self: Id, op: Id, index: number) => Id;
  /** `[self op]` returning an integer. */
  readonly sendLong: (self: Id, op: Id) => number;
  /** `[self op:url resultingItemURL:&into error:&error]`, the out parameters as one-element arrays. */
  readonly sendTrash: (self: Id, op: Id, url: Id, into: Id[], error: Id[]) => boolean;
  /** An NSString made from `text`. */
  readonly string: (text: string) => Id;
  /** An NSString's text, copied out before the pool that owns it drains; '' for nil. */
  readonly text: (object: Id) => string;
  /** Runs `body` inside an autorelease pool. */
  readonly pooled: <T>(body: () => T) => T;
}

let bound: ObjcRuntime | null | undefined;

/** The runtime with Foundation and AppKit loaded. Null where it cannot be, which on macOS means a broken install. */
export function objcRuntime(): ObjcRuntime | null {
  if (bound !== undefined) return bound;
  try {
    const koffi = require('koffi') as KoffiModule;
    koffi.load(FOUNDATION_PATH); // registers NSFileManager, NSString, NSURL with the runtime
    koffi.load(APPKIT_PATH); // and NSPasteboard
    const objc = koffi.load(LIBOBJC_PATH);
    const getClass = objc.func('void *objc_getClass(const char *name)');
    const selector = objc.func('void *sel_registerName(const char *name)');
    const poolPush = objc.func('void *objc_autoreleasePoolPush()');
    const poolPop = objc.func('void objc_autoreleasePoolPop(void *pool)');
    const sendId = objc.func('void *objc_msgSend(void *self, void *op)');
    const sendIdText = objc.func('void *objc_msgSend(void *self, void *op, const char *text)');
    const sendIdId = objc.func('void *objc_msgSend(void *self, void *op, void *arg)');
    const sendIdIndex = objc.func('void *objc_msgSend(void *self, void *op, unsigned long index)');
    const sendText = objc.func('const char *objc_msgSend(void *self, void *op)');
    const sendLong = objc.func('long objc_msgSend(void *self, void *op)');
    const sendTrash = objc.func('uint8_t objc_msgSend(void *self, void *op, void *url, _Out_ void **into, _Out_ void **error)');

    const nsString = getClass('NSString');
    if (!nsString) throw new Error('Foundation did not register NSString');
    const stringWithUTF8String = selector('stringWithUTF8String:');
    const utf8 = selector('UTF8String');

    bound = {
      getClass: (name) => getClass(name),
      selector: (name) => selector(name),
      sendId: (self, op) => sendId(self, op),
      sendIdText: (self, op, text) => sendIdText(self, op, text),
      sendIdId: (self, op, arg) => sendIdId(self, op, arg),
      sendIdIndex: (self, op, index) => sendIdIndex(self, op, index),
      sendLong: (self, op) => Number(sendLong(self, op)),
      sendTrash: (self, op, url, into, error) => Number(sendTrash(self, op, url, into, error)) !== 0,
      string: (text) => sendIdText(nsString, stringWithUTF8String, text),
      text: (object) => (object ? String(sendText(object, utf8) ?? '') : ''),
      pooled: (body) => {
        const pool = poolPush();
        try {
          return body();
        } finally {
          poolPop(pool);
        }
      },
    };
  } catch (error) {
    logCaught('objc-runtime: bind the Objective-C runtime through koffi', error);
    bound = null;
  }
  return bound;
}

/** What this module uses of koffi. */
interface KoffiModule {
  load(path: string): { func(signature: string): (...args: unknown[]) => unknown };
}
