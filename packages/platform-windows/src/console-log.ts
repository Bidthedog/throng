import { logAt } from '@throng/core';

/**
 * The `log` this package hands `watchChild` (066 FR-008): the console, which the host process's file
 * log has attached (`attachConsole`), so a line here lands in `daemon.log` / `main.log` at its level.
 * It is core's one router, so fatal is marked the same way everywhere.
 */
export const consoleLog = logAt;
