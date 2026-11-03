import { configureHostTraits, hostTraits, type HostTraits } from '../platform/host-traits.js';

/** Run `fn` under `traits`, restoring the previous ones afterwards, async or not. */
export function withHostTraits<T>(traits: HostTraits, fn: () => T): T {
  const before = hostTraits();
  configureHostTraits(traits);
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
