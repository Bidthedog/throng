// Each unit test starts on the default traits (062 contracts/host-traits.md). The `unit` project shares one module
// registry per worker, so a test that builds a composition root would otherwise leave this machine's traits behind for
// whichever file the worker runs next, and the result would depend on how files happen to land on workers.
import { beforeEach } from 'vitest';
import { WINDOWS_HOST_TRAITS, configureHostTraits } from '@throng/core';

beforeEach(() => {
  configureHostTraits(WINDOWS_HOST_TRAITS);
});
