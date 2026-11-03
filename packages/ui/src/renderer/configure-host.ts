import { configureHostTraits, linuxHostTraits, WINDOWS_HOST_TRAITS } from '@throng/core';

/**
 * The renderer's host traits (062 contracts/host-traits.md), from what preload exposes. Imported first by `main.tsx`,
 * so path identity and the shipped bindings are right before the first render. The renderer opens no sockets, so it
 * has no socket folder to name. An OS with no set here keeps Windows' traits only until main, which has already refused
 * to start on one (FR-050), would have stopped it reaching this line.
 */
const osName = window.throng?.osName;
configureHostTraits(osName === 'linux' ? linuxHostTraits('') : WINDOWS_HOST_TRAITS);
