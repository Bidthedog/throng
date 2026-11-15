import { configureHostTraits } from '@throng/core';
import { hostTraitsFromPreload } from './host-traits-from-preload.js';

/**
 * The renderer's host traits (062 contracts/host-traits.md), from what preload exposes: main's own traits, whole (070
 * FR-011, research R32), so a macOS renderer gets macOS traits and not Windows ones. Imported first by `main.tsx`, so
 * path identity and the shipped bindings are right before the first render.
 */
configureHostTraits(hostTraitsFromPreload(window.throng?.hostTraits, window.throng?.osName));
