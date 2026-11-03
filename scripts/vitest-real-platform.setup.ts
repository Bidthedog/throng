// Integration and contract tests drive real sockets, folders and processes, so they read this machine's host traits, as
// the app does. Unit and component tests fold Windows spellings by default instead: see vitest-default-traits.setup.ts.
import { startPlatform } from '@throng/platform';

startPlatform();
