/*
 * The preload bridge as the specs see it from inside `page.evaluate`. The specs reach internals the
 * renderer's own typing (src/renderer/global.d.ts) deliberately does not expose, and an evaluate
 * body runs in the page, not here — so the bridge is typed loosely, and what a spec reads from it is
 * asserted at run time, not trusted at compile time.
 */
declare global {
  interface Window {
    throng: any;
  }
}

export {};
