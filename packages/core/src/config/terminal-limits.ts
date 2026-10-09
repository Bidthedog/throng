/**
 * 051 FR-013a — how long throng waits for the operating system to end a terminal before it treats
 * that end as failed.
 *
 * Declared ONCE, here, so changing it is a one-line edit; it is deliberately not a user preference.
 * The daemon injects it into the terminal service's settings (Principle IX), and every end request,
 * every process-table read and the shutdown wait take their limit from it, so one edit moves every
 * process-request limit together (FR-013).
 */
export const TERMINAL_END_TIMEOUT_MS = 5000;
