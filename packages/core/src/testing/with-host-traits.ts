import type { OsName } from '../abstractions/platform-info.js';
import {
  WINDOWS_HOST_TRAITS,
  configureHostTraits,
  hostTraits,
  linuxHostTraits,
  macosHostTraits,
  type HostTraits,
} from '../platform/host-traits.js';

/**
 * Each platform's standard traits for a test that only needs "this platform's rules": a fixed socket folder and, on
 * macOS, no case-sensitive volume. A test about either passes its own `HostTraits` instead.
 */
const TEST_TRAITS: Readonly<Record<OsName, () => HostTraits>> = {
  windows: () => WINDOWS_HOST_TRAITS,
  linux: () => linuxHostTraits('/run/user/1000/throng'),
  macos: () => macosHostTraits('/var/folders/zz/T/throng', []),
};

/** Run `fn` under `traits` (or a platform's standard test traits), restoring the previous ones afterwards, async or not. */
export function withHostTraits<T>(traits: HostTraits | OsName, fn: () => T): T {
  const before = hostTraits();
  configureHostTraits(typeof traits === 'string' ? TEST_TRAITS[traits]() : traits);
  let result: T;
  try {
    result = fn();
  } catch (error) {
    configureHostTraits(before);
    throw error;
  }
  if (result instanceof Promise) {
    return result.finally(() => configureHostTraits(before)) as T;
  }
  configureHostTraits(before);
  return result;
}
