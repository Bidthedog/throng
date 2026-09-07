import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
// Named import: js-yaml 5 is ESM-first and has no default export, so `import yaml from 'js-yaml'`
// yields undefined and fails at the first call rather than at import.
import { load } from 'js-yaml';

/**
 * **No workflow that runs on our own hardware may be triggerable from a fork.**
 *
 * `throng` is a PUBLIC repository. If any workflow ever runs on hardware we own, a fork's pull
 * request would execute that fork's code on it — `npm ci` runs its `postinstall`, its test files
 * run as its author wrote them — on a machine inside somebody's home, with whatever that machine
 * can reach.
 *
 * ── THERE IS NO SELF-HOSTED RUNNER TODAY, AND THAT IS AN INVARIANT, NOT AN ACCIDENT ───────────
 *
 * The gate ran on one for a day and was moved back to `windows-2022`: hosted was about twice as
 * fast on this workload, free on a public repo, and needed no maintaining. So the second test below
 * asserts the ABSENCE of a self-hosted job rather than its presence — which is what it used to do,
 * as an anti-vacuity control back when one existed.
 *
 * That inversion is deliberate and is the useful half now. Re-introducing a self-hosted runner
 * becomes a conscious act: it fails this file, whoever does it has to come here, and arriving here
 * is what puts the fork-reachability rule below in front of them at the moment it starts to matter
 * again. Deleting this file instead — which its own failure message used to suggest — would remove
 * the rule exactly when nothing is left to remind anyone of it.
 *
 * ── Why this file exists anyway ─────────────────────────────────────────────────────────────────
 *
 * Because that is a CONVENTION, and until this test existed the only thing enforcing it was a
 * comment. One line — `pull_request:` added to the wrong workflow — silently converts "nobody can
 * reach the machine" into "anybody can", and nothing in the build would have objected. Review
 * catches that on a good day.
 *
 * The comment explains the rule. This decides it.
 *
 * ── What counts as fork-reachable, and why each one ────────────────────────────────────────────
 *
 * Not just `pull_request`. Every trigger below can be driven, directly or indirectly, by someone
 * without write access to this repository:
 *
 *   - `pull_request` — a fork's PR, running that fork's code.
 *   - `pull_request_target` — worse: runs in the BASE repo's context, with secrets.
 *   - `issue_comment` — fires for anyone who can type in an issue, which on a public repo is
 *     everyone.
 *   - `workflow_run` — chains off another workflow, INCLUDING one a fork PR triggered. The classic
 *     way a fork reaches a job that looks unreachable.
 *   - `repository_dispatch` — an API trigger; safe only as long as no token that can call it ever
 *     leaks.
 *   - `workflow_call` — this workflow becomes callable BY another, and the caller decides what
 *     triggered it. Reachability then depends on a file this test is not looking at.
 *   - `fork` — fires when anybody forks the repository. Anybody can.
 *
 * A job is in scope if any `runs-on` label mentions `self-hosted`, in either the string or array
 * form, case-insensitively — GitHub matches runner labels case-insensitively, so a check that did
 * not would be trivially bypassed by capitalisation.
 */

const WORKFLOWS = fileURLToPath(new URL('../../../../.github/workflows', import.meta.url));

const FORK_REACHABLE = [
  'pull_request',
  'pull_request_target',
  'issue_comment',
  'workflow_run',
  'repository_dispatch',
  'workflow_call',
  'fork',
] as const;

interface Workflow {
  file: string;
  triggers: string[];
  selfHostedJobs: string[];
}

/** `runs-on` is a string, an array of labels, or an object with `labels` / `group`. */
function mentionsSelfHosted(runsOn: unknown): boolean {
  const flat: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') flat.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(runsOn);
  return flat.some((label) => label.toLowerCase().includes('self-hosted'));
}

function readWorkflows(): Workflow[] {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => {
      const doc = load(readFileSync(join(WORKFLOWS, f), 'utf8')) as Record<string, unknown>;
      // YAML 1.1 parses a bare `on:` key as boolean true unless it is quoted. Handle both, or this
      // test reads every workflow as having no triggers at all and passes on everything.
      const on = (doc.on ?? (doc as Record<string, unknown>)[String(true)]) as
        | Record<string, unknown>
        | string
        | string[]
        | undefined;
      const triggers =
        typeof on === 'string' ? [on] : Array.isArray(on) ? on : on ? Object.keys(on) : [];
      const jobs = (doc.jobs ?? {}) as Record<string, { 'runs-on'?: unknown }>;
      return {
        file: f,
        triggers,
        selfHostedJobs: Object.entries(jobs)
          .filter(([, job]) => mentionsSelfHosted(job?.['runs-on']))
          .map(([id]) => id),
      };
    });
}

describe('self-hosted runners are unreachable from forks', () => {
  const workflows = readWorkflows();

  it('parses every workflow and finds their triggers', () => {
    expect(workflows.length, 'no workflows were read — this test is not looking at anything').toBeGreaterThan(0);
    expect(
      workflows.filter((w) => w.triggers.length === 0).map((w) => w.file),
      'a workflow parsed with NO triggers, which almost certainly means the `on:` key was read as ' +
        'the boolean true rather than the string "on". This test would then pass vacuously.',
    ).toEqual([]);
  });

  it('no workflow runs on a self-hosted runner at all', () => {
    const withSelfHosted = workflows
      .filter((w) => w.selfHostedJobs.length > 0)
      .map((w) => `${w.file}: ${w.selfHostedJobs.join(', ')}`);

    expect(
      withSelfHosted,
      'A job now targets a SELF-HOSTED runner. That is not forbidden, but it is a decision with ' +
        'consequences that are easy to miss, so it is made here rather than in passing:\n\n' +
        '  1. The fork-reachability rule below starts applying to that workflow. Read it.\n' +
        '  2. A machine you own now executes whatever the workflow runs, on your network.\n' +
        '  3. It was measured as ~2x slower than windows-2022 on this repo\'s gate, and two of\n' +
        '     nineteen runs died mid-job with no log at all.\n\n' +
        'If you have weighed those and still want it, update this test to expect the job you are ' +
        'adding \u2014 and make sure the check below covers it.',
    ).toEqual([]);
  });

  it('no workflow with a self-hosted job carries a fork-reachable trigger', () => {
    const offenders = workflows
      .filter((w) => w.selfHostedJobs.length > 0)
      .flatMap((w) =>
        w.triggers
          .filter((t) => (FORK_REACHABLE as readonly string[]).includes(t))
          .map((t) => `${w.file}: '${t}' — job(s) ${w.selfHostedJobs.join(', ')} run on our hardware`),
      );

    expect(
      offenders,
      'A workflow that runs on OUR OWN HARDWARE can now be triggered by someone without write ' +
        'access to this repository. On a public repo that means a fork\'s code — its postinstall ' +
        'scripts, its test files — executing on a machine on a private network.\n\n' +
        'This is not a lint preference. Do not add an `if:` guard to make it pass; a guard is one ' +
        'edit away from being wrong, which is the entire reason this check exists rather than a ' +
        'comment. Either remove the trigger, or move that job to a GitHub-hosted runner.\n\n' +
        'Offending triggers:\n',
    ).toEqual([]);
  });
});
