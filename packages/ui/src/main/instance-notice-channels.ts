/**
 * 058 FR-018 — the different-copy notice's two Electron channels, between main and the main
 * window's renderer (contracts/instance-lock.md). Main pushes the notice; the renderer announces
 * once that it is listening, so a launch that arrived before the window loaded is delivered then.
 *
 * Declared here, under `src/main`, rather than in `@throng/ipc-contract` (which carries the daemon's
 * JSON-RPC wire): `ipc-bridge-parity.test.ts` holds the preload's channel literals against the ones
 * under `src`, the same way `config-write-ipc.ts` declares its channel. The sandboxed preload cannot
 * import this module and spells the strings out; `instance-channels.test.ts` keeps them equal.
 * The payload is `@throng/core`'s `DifferentCopyNotice`.
 */

/** main → renderer: a launch of a different copy reached this instance. */
export const DIFFERENT_COPY_NOTICE_CHANNEL = 'throng:instance:differentCopy';

/** renderer → main: the main window is listening for {@link DIFFERENT_COPY_NOTICE_CHANNEL}. */
export const DIFFERENT_COPY_READY_CHANNEL = 'throng:instance:differentCopyReady';
