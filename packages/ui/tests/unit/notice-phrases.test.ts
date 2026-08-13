import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 030 FR-058 / SC-013 — A NOTICE MAY NOT REFER TO ITS SUBJECT WITH A GENERIC STAND-IN.
 *
 * ══ THE DEFECT ══
 *
 * #195 is one sentence: "An error occurred when you tried to rename this item." It is grammatical,
 * it is polite, and the single fact it exists to carry — WHICH item — is the one it withholds. US2
 * made the subject a required, structured field so that omitting it is inexpressible
 * (`notice-subject-required.test.ts` compiles a fixture to prove it). That closes the hole where a
 * notice names NOTHING. It does not close the hole where a notice names something and then talks
 * about "this item" anyway — the type is satisfied, the compiler is happy, and the user is back
 * where they started.
 *
 * FR-058 is the second half. `contracts/notice-api.md` states it as a row in the enforcement table:
 * *No generic stand-in ("this item", "the item", "this file") in message text — automated check.*
 * This is that check.
 *
 * ══ WHY IT DISCOVERS ITS CALL SITES INSTEAD OF LISTING THEM ══
 *
 * `notice-inventory.md` counted twelve literal `notify()` call sites when 030 began; there are
 * fourteen now, and two of them (`common/clipboard-copy.ts`, `workspace/panel-failure-notice.ts`)
 * were added by THIS feature, after that count was written down. A guard shaped like the list would
 * have been correct for the length of one user story.
 *
 * CONTRIBUTING.md:123 states the rule this file obeys — *write the guard like the REQUIREMENT, not
 * like the change* — and gives 018's measurement for why: a hand count found five notice surfaces
 * and the guard found nine. So nothing below names a file. The scope is computed from the source
 * every time it runs:
 *
 *   • a RENDERER file is in the notice model when it calls `notify(` or `useErrorNotice(`. Those
 *     are the model's only two entry points (`common/notification.tsx`), so a fifteenth call site
 *     is in scope the moment it is typed — including in a directory nobody has created yet;
 *   • a CORE file is in the notice model when it names `FailureCause` or `NoticeSubject`. That is
 *     where the SENTENCES live (`failure/cause.ts` writes all five of them) and where a subject is
 *     formatted, so the vocabulary is covered as well as the raises.
 *
 * ══ WHAT IS DELIBERATELY NOT AN OFFENCE ══
 *
 * Three things, each of which a blunter scan gets wrong, and each of which is a REQUIREMENT rather
 * than an excuse:
 *
 *   1. **A raise that states `{ kind: 'none' }` may speak generically.** FR-027: where a subject is
 *      genuinely unavailable, the message is left as it is rather than padded with a placeholder or
 *      a guess. `editor/drop-target.tsx` is the case it was written for — an OS drop that yielded no
 *      path at all — and its "That item has no file on disk" is CORRECT: there is no item on disk to
 *      name. Banning the phrase there would leave no satisfiable wording, and a rule no design can
 *      satisfy governs nothing.
 *   2. **A banner headline is per-TYPE by construction.** FR-040 makes it the one sentence a panel
 *      type owns ("This file could not be read", "This terminal could not be opened") and FR-040a
 *      puts the path beside it; it cannot contain a name, and the thing it points at is the panel
 *      the reader is looking at. Banner headlines are out of scope because Rule B inspects `notify()`
 *      raises, not banner props — not because of an exemption someone has to remember.
 *   3. **Anaphora after a name is the house style.** `causeMessage(cause, { subjectPresented: true })`
 *      says "It could not be found" precisely BECAUSE the heading has already said which — FR-023
 *      forbids restating it. So pronouns are not stand-ins, and "one" is not in the noun list below.
 *
 * ══ WHAT THIS CHECK CANNOT SEE, STATED SO NOBODY MISTAKES ITS SILENCE FOR PROOF ══
 *
 * A message that reaches `useErrorNotice` through a STORE is written where the store is, and the
 * store is not a notice call site. `explorer/use-explorer-data.ts` is the working example: its watch
 * failure sentence becomes a notice and this file never reads it. Rule A still covers every file
 * that raises, and `notice-subjects.e2e.ts:108` asserts the ban against a REAL notice's rendered
 * text — the two together are the enforcement; neither alone is. `notice-inventory.md` half B is the
 * hand audit of the remainder, and says so.
 *
 * That boundary is also what keeps the guard off two strings that must not move:
 *
 *   • `use-explorer-data.ts` keeps "Live updates have stopped for this project" VERBATIM, because
 *     `editor-stranded-restart.e2e.ts:163` asserts that exact sentence is ABSENT after a recovery.
 *     An assertion of absence is silently satisfied by any rewording, so a guard that forced one
 *     would turn someone else's test into a no-op without a single thing going red;
 *   • the same file's "this item" is the DELETE CONFIRMATION's wording. A confirmation is the other
 *     notice model (018 FR-048a, `notice-inventory.md` S-15): it asks rather than reports, it is
 *     modal, and it cannot be silenced. It is out of the notice contract, and it is out of scope
 *     here structurally — that file raises nothing.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));
const CORE = fileURLToPath(new URL('../../../core/src', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Blank out comments, keeping every other character where it was.
 *
 * The guard polices what the USER READS, not what the authors wrote about it. `notification.tsx`
 * explains at length why "this item" was #195 — quoting it, necessarily — and every one of the
 * three exemptions above is written down in prose somewhere near the code it governs. A guard that
 * failed on its own documentation would train the next author to delete the explanation and keep
 * the defect.
 *
 * Replacing rather than removing keeps line numbers and string offsets true, so a failure message
 * can point at a line that exists.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/.*$/gm, (m, before: string) => before + ' '.repeat(m.length - before.length));
}

interface Source {
  /** Repo-relative, forward-slashed — what a failure message has to be able to paste into an editor. */
  readonly name: string;
  readonly text: string;
}

function load(root: string, prefix: string): Source[] {
  return walk(root).map((path) => ({
    name: `${prefix}/${path.slice(root.length + 1).replace(/\\/g, '/')}`,
    text: code(readFileSync(path, 'utf8')),
  }));
}

/**
 * The notice model's two entry points, word-bounded.
 *
 * `\b` matters: `window.throng?.panel?.notifyRenamed?.()` is not a raise, and a substring match
 * would pull `workspace/panel-placeholder.tsx` in for the wrong reason — harmlessly today, and
 * misleadingly the first time someone reads the discovered list to learn what raises a notice.
 */
const RAISES = /\b(?:notify|useErrorNotice)\s*\(/;

/** The vocabulary in which a cause is spoken and a subject is presented. */
const NOTICE_VOCABULARY = /\b(?:FailureCause|NoticeSubject)\b/;

const noticeSources: readonly Source[] = [
  ...load(RENDERER, 'packages/ui/src/renderer').filter((f) => RAISES.test(f.text)),
  ...load(CORE, 'packages/core/src').filter((f) => NOTICE_VOCABULARY.test(f.text)),
];

/** Single-quoted, double-quoted and template literals, with their escapes. */
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/**
 * The generic nouns a subject gets replaced by, and the determiners that introduce them.
 *
 * `contracts/notice-api.md` names three — "this item", "the item", "this file" — and FR-058 adds
 * "and the like", so the list is the cross product of those determiners and those nouns rather than
 * the three strings verbatim: "that folder" is the same defect and would otherwise be the obvious
 * way round the check.
 *
 * `one` is absent on purpose (see the header: it is a pronoun, and pronouns are what FR-023
 * REQUIRES once the heading has named the subject). The plural forms are absent from Rule B for the
 * same reason FR-027 exists — "delete these items" describes a batch that genuinely has no single
 * subject, and `explorer/use-explorer-data.ts` splits its wording on exactly that.
 */
const DETERMINER = 'this|that|the';
const GENERIC_NOUN = 'item|file|folder|thing';

/**
 * The generic word is sometimes an ADJECTIVE, and then it is not standing in for anything.
 *
 * "undo that file operation" names an operation; "hidden in the file tree" names the tree. Both
 * exist in this codebase today, outside the scope below — the lookahead is here so that moving one
 * of them INTO a notice is not reported as a defect it is not.
 */
const COMPOUND = '(?!\\s+(?:operation|tree|name|path|type|count|list|extension|system)s?\\b)';

const STAND_IN = new RegExp(`\\b(?:${DETERMINER})\\s+(?:${GENERIC_NOUN})\\b${COMPOUND}`, 'i');

/** The whole literal is a noun phrase and nothing else — a value used where a NAME belongs. */
const STAND_IN_AS_NAME = new RegExp(
  `^(?:${DETERMINER}|these|those)\\s+(?:${GENERIC_NOUN}|one)s?$`,
  'i',
);

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

interface Offence {
  where: string;
  text: string;
}

/** Rule A — every string literal in the file, as a candidate NAME. */
function namesNothing(file: Source): Offence[] {
  const out: Offence[] = [];
  LITERAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LITERAL.exec(file.text))) {
    const literal = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (STAND_IN_AS_NAME.test(literal)) {
      out.push({ where: `${file.name}:${lineOf(file.text, m.index)}`, text: literal });
    }
  }
  return out;
}

/**
 * Every `notify({ … })` raise in a file, as the source text of its object literal.
 *
 * Brace-matched rather than regex-matched, because a raise spans a dozen lines and carries nested
 * objects (`subject: { kind: 'panel', … }`), and string-aware, because a message may contain a
 * brace. A raise written as `notify(input)` — an object built elsewhere — is not found and is not
 * claimed to be: Rule A still reads every literal in the file, and half B of the inventory is the
 * hand audit that covers what neither rule can reach.
 */
function raisesIn(file: Source): { at: string; body: string }[] {
  const out: { at: string; body: string }[] = [];
  const opens = /\bnotify\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = opens.exec(file.text))) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let i = start;
    for (; i < file.text.length; i++) {
      const c = file.text[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      } else if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        i++;
        while (i < file.text.length && file.text[i] !== quote) {
          if (file.text[i] === '\\') i++;
          i++;
        }
      }
    }
    out.push({ at: `${file.name}:${lineOf(file.text, m.index)}`, body: file.text.slice(start, i + 1) });
  }
  return out;
}

/** FR-027's escape, stated in the raise itself: there is nothing to stand in for. */
const NO_SUBJECT = /\bsubject\s*:\s*\{\s*kind\s*:\s*'none'\s*\}/;

/** The three fields a reader actually reads. `details` and `copyDetail` are the raw error (FR-034). */
const READ_ALOUD = ['message', 'title', 'action'] as const;

function standsInForItsSubject(body: string): { field: string; text: string }[] {
  if (NO_SUBJECT.test(body)) return [];
  const out: { field: string; text: string }[] = [];
  for (const field of READ_ALOUD) {
    const key = new RegExp(`\\b${field}\\s*:\\s*`).exec(body);
    if (!key) continue;
    const rest = body.slice(key.index + key[0].length);
    LITERAL.lastIndex = 0;
    const literal = LITERAL.exec(rest);
    // Only when the value STARTS with a literal: `message: spoken.message` is computed elsewhere and
    // the next literal in the object would belong to a different field entirely.
    if (!literal || literal.index > 2) continue;
    const text = literal[1] ?? literal[2] ?? literal[3] ?? '';
    if (STAND_IN.test(text)) out.push({ field, text });
  }
  return out;
}

describe('FR-058 — the discovery itself', () => {
  it('finds the notice model rather than a remembered list of files', () => {
    // A guard that quietly scanned nothing would be green and worthless. Both halves must be found:
    // a broken renderer walk and a broken core walk have different causes and the same symptom.
    expect(noticeSources.filter((f) => f.name.includes('/ui/')).length).toBeGreaterThan(10);
    expect(noticeSources.filter((f) => f.name.includes('/core/')).length).toBeGreaterThan(3);
  });

  it('parses the raises it finds, rather than finding none and passing', () => {
    const found = noticeSources.flatMap(raisesIn);
    expect(found.length, 'no notify() raise was parsed — the brace matcher is broken').toBeGreaterThan(
      9,
    );
    // Every parsed body must be a closed object. An unterminated match silently makes Rule B read
    // the rest of the file as one raise, which would be a guard that reports nothing for any reason.
    for (const r of found) expect(r.body.endsWith('}'), `unterminated raise at ${r.at}`).toBe(true);
  });
});

describe('FR-058 — the rules fire (the control)', () => {
  /*
   * "The tree is clean" is satisfied by a regex that matches nothing, by a walk that returns no
   * files, and by a rule someone deleted. Each rule is therefore run against a source that DOES
   * offend, so a green bar above can only mean the tree is clean.
   */
  const OFFENDING: Source = {
    name: 'fixture.ts',
    text: [
      "const what = 'this item';",
      'notify({',
      "  severity: 'error',",
      "  subject: { kind: 'file', name: 'alpha.txt' },",
      "  message: 'The file could not be renamed.',",
      '});',
    ].join('\n'),
  };

  it('Rule A sees a stand-in used as a name', () => {
    expect(namesNothing(OFFENDING).map((o) => o.text)).toEqual(['this item']);
  });

  it('Rule B sees a stand-in in a raise that states a real subject', () => {
    const [raise] = raisesIn(OFFENDING);
    expect(raise, 'the fixture raise was not parsed').toBeDefined();
    expect(standsInForItsSubject(raise!.body)).toEqual([
      { field: 'message', text: 'The file could not be renamed.' },
    ]);
  });

  it('Rule B lets a raise that states { kind: \'none\' } speak generically (FR-027)', () => {
    const excused: Source = {
      name: 'fixture.ts',
      text: OFFENDING.text.replace(
        "subject: { kind: 'file', name: 'alpha.txt' },",
        "subject: { kind: 'none' },",
      ),
    };
    const [raise] = raisesIn(excused);
    expect(standsInForItsSubject(raise!.body)).toEqual([]);
  });

  it('the compound-noun lookahead keeps an adjective out of it', () => {
    expect(STAND_IN.test('undo that file operation')).toBe(false);
    expect(STAND_IN.test('hidden in the file tree')).toBe(false);
    expect(STAND_IN.test('that file could not be opened')).toBe(true);
  });
});

describe('FR-058 — no notice refers to its subject with a generic stand-in', () => {
  it('no string in the notice model is a generic stand-in used as a name', () => {
    const offences = noticeSources.flatMap(namesNothing);
    expect(
      offences.map((o) => `${o.where}  "${o.text}"`),
      'A notice reaches the user calling its subject by a generic noun. That IS #195: the one fact ' +
        'the notice exists to carry is the one it withholds. Name the thing, or — where there is ' +
        'genuinely nothing to name — say nothing rather than padding the sentence with a ' +
        'placeholder (FR-027).',
    ).toEqual([]);
  });

  it('no notify() raise that states a subject then talks about "this item"', () => {
    const offences = noticeSources.flatMap((f) =>
      raisesIn(f).flatMap((r) =>
        standsInForItsSubject(r.body).map((o) => `${r.at}  ${o.field}: ${o.text}`),
      ),
    );
    expect(
      offences,
      'This raise KNOWS what it is about — it states a subject — and its text refers to that ' +
        'subject generically anyway. The heading already presents the name (FR-020); the message ' +
        'should state only what went wrong (FR-023), which is what "It" is for.',
    ).toEqual([]);
  });
});
