/** 061 FR-016 / FR-017 — how many lines a terminal keeps, in the daemon and in its panel. */
export const TERMINAL_RETAINED_LINES = 10_000;

/** 061 FR-016 — the bound for output with few line breaks, which a line limit alone would not stop. */
export const TERMINAL_RETAINED_CHARS = 8 * 1024 * 1024;

/** 061 FR-020 — the longest a stream waits between deliveries. 17 ms keeps it at or under 60 a second (SC-004). */
export const TERMINAL_BATCH_INTERVAL_MS = 17;

/** 061 FR-025 — a batch this size is delivered at once. */
export const TERMINAL_BATCH_MAX_CHARS = 1024 * 1024;

/** 061 R6 — xterm yields to the window only between writes, so a replay is written in pieces this size. */
export const TERMINAL_REPLAY_SLICE_CHARS = 64 * 1024;
