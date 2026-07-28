import { describe, it, expect } from "vitest";
import {
  BASH_PROMPT_COMMAND,
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  resolveShellIntegration,
  resolveShellIntegrationEnv,
  resolveLaunchSpec,
} from "@throng/core";

/**
 * 025 FR-032a/FR-032d — Git Bash is asked to report its directory through the ENVIRONMENT, and its
 * integration must never appear in a command line.
 *
 * This is a regression test with a specific failure behind it. The snippet used to be spliced into
 * the `-c` recipe next to the user's Startup Command, so it became part of the shell's command
 * line — and command memory (FR-019/FR-022), whose whole job is to read command lines, captured it.
 * It was persisted as if the user had typed it, `$PWD` already expanded, and replayed into the next
 * launch, where the second round of expansion produced:
 *
 *     bash: 9: command not found
 *     bash: fg: %s007 D:\...: no such job
 *     bash: unexpected EOF while looking for matching `"'
 *
 * The fix is structural rather than a better escaping: an environment variable is not part of any
 * command line, so there is nothing for capture to see and nothing for a second parse to mangle.
 * Asserting "the argv contains no trace of the integration" is therefore the real requirement —
 * asserting the escaping is correct would pass again the moment the snippet returns to argv.
 */

const GIT_BASH = {
  id: "git-bash",
  file: "bash.exe",
  args: ["-i", "-l"],
  commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES["git-bash"],
  shellIntegration: resolveShellIntegration("git-bash", true),
  shellIntegrationEnv: resolveShellIntegrationEnv("git-bash", true),
};

/** Anything that would identify the integration if it leaked into a command line. */
const FINGERPRINTS = ["PROMPT_COMMAND", "cygpath", "]9;9;", "%s"];

describe("git-bash shell integration (025 FR-032a/FR-032d)", () => {
  it("is delivered as an environment variable, not a snippet", () => {
    expect(GIT_BASH.shellIntegrationEnv).toEqual({
      PROMPT_COMMAND: BASH_PROMPT_COMMAND,
    });
    expect(GIT_BASH.shellIntegration ?? "").toBe("");
  });

  it("leaves NO trace of itself in argv — with a Startup Command, or without one", () => {
    for (const startup of [
      undefined,
      "claude agents",
      '"C:/Program Files/x/PING.EXE" -t',
    ]) {
      const spec = resolveLaunchSpec(GIT_BASH, "", "C:/proj", startup);
      const line = [
        ...spec.args,
        spec.commandLine ?? "",
        spec.writeOnReady ?? "",
      ].join(" ");
      for (const trace of FINGERPRINTS) {
        expect(
          line,
          `integration leaked into the command line via "${trace}"`,
        ).not.toContain(trace);
      }
      expect(spec.env).toEqual({ PROMPT_COMMAND: BASH_PROMPT_COMMAND });
    }
  });

  it("still hands the Startup Command through, unchanged", () => {
    const spec = resolveLaunchSpec(GIT_BASH, "", "C:/proj", "claude agents");
    expect(spec.args.join(" ")).toContain("claude agents");
  });

  it("carries a real escape, so bash prints ESC and BEL rather than the digits", () => {
    // The literal characters matter: `\033` written as an octal escape in TypeScript would send
    // an actual ESC byte to bash, which prints nothing useful. bash's printf must receive the
    // four characters backslash-0-3-3 and do the escaping itself.
    expect(BASH_PROMPT_COMMAND).toContain("\\033");
    expect(BASH_PROMPT_COMMAND).toContain("\\007");
    expect(BASH_PROMPT_COMMAND).not.toContain("\u001b");
    expect(BASH_PROMPT_COMMAND).not.toContain("\u0007");
  });

  it("preserves a PROMPT_COMMAND the user already has (FR-032d)", () => {
    // bash runs a PROMPT_COMMAND from the environment; a user's own is set by their rc files,
    // which run after. Nothing here may overwrite an existing value in the user's own shell
    // configuration — this asserts throng contributes exactly one variable and touches no other.
    const spec = resolveLaunchSpec(GIT_BASH, "", "C:/proj", "echo hi");
    expect(Object.keys(spec.env ?? {})).toEqual(["PROMPT_COMMAND"]);
  });
});
