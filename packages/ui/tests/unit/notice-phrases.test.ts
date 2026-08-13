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
 * Rule B follows ONE indirection: a sentence hoisted into a module-level `const` and referenced at
 * the raise is resolved to its value (see {@link constantsIn}). That is not a nicety — it is the
 * house style for a wording two surfaces share (FR-042d), so before it the guard was defeated by the
 * plainest refactor available, and this feature's own `clipboard-copy.ts` had the defeating shape.
 * A constant IMPORTED from elsewhere, or built by concatenation or a call, is still not followed:
 * this reads source text and does not run it.
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

/**
 * A named string constant — `const NAME = '…'` — a whole sentence given a name (FR-042d's style).
 *
 * ══ WHY THIS EXISTS ══
 *
 * Rule B below reads the value of `message`, `title` and `action`. It used to read only a value that
 * STARTS with a string literal, which is the correct restriction for `message: spoken.message` — a
 * sentence computed elsewhere, whose next literal in the object belongs to a different field
 * entirely. But it made the guard defeatable by the plainest refactor there is: hoist the sentence
 * into a constant, reference the constant, and a phrase that fails the build inline passes it.
 *
 * That is not a hypothetical. `common/clipboard-copy.ts` is written exactly that way, because one
 * wording has to reach two surfaces (FR-042d) and a named constant is how you say so. So the shape
 * the guard could not see was the shape this feature's own code uses, and SC-013's claim — that such
 * a notice is rejected by the project's own checks before it can be merged — was false for it.
 *
 * ══ WHAT IT DELIBERATELY DOES NOT DO ══
 *
 * One module, one hop. A constant IMPORTED from another file is not followed, and a value built by
 * concatenation or a function call is not evaluated: this reads source text, it does not run it.
 * Rule A still reads every literal in the file whatever it is assigned to, and
 * `notice-subjects.e2e.ts:108` still asserts the ban against a REAL notice's rendered text. The
 * boundary is the same one the header states, moved by exactly one indirection — the one that is
 * routinely used.
 */
const CONSTANT =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;

/**
 * name → the string it holds, for every string constant declared in the file.
 *
 * Scope is not tracked, deliberately: a sentence in a function-local `const` referenced by a raise in
 * the same function is the same defect as one at the top of the module, and a shadowed name would at
 * worst attribute one banned phrase to the wrong line of the same file — a report to correct, not a
 * defect to miss.
 */
function constantsIn(file: Source): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  CONSTANT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONSTANT.exec(file.text))) {
    out.set(m[1]!, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** A field whose value is a bare identifier — `message: COPY_FAILED,`. */
const REFERENCE = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|\}|$)/;

/**
 * What a field SAYS: its own literal, or the constant it names.
 *
 * `undefined` for anything else — a member expression, a call, a template with a hole in it. A guard
 * that guessed at those would report the file rather than the notice.
 */
function spokenValue(rest: string, constants: ReadonlyMap<string, string>): string | undefined {
  LITERAL.lastIndex = 0;
  const literal = LITERAL.exec(rest);
  // Only when the value STARTS with a literal: `message: spoken.message` is computed elsewhere and
  // the next literal in the object would belong to a different field entirely.
  if (literal && literal.index <= 2) return literal[1] ?? literal[2] ?? literal[3] ?? '';
  const named = REFERENCE.exec(rest);
  return named ? constants.get(named[1]!) : undefined;
}

/**
 * How many raises in a file speak through a constant.
 *
 * The control fixtures above prove the resolver works on a source that offends. This proves it is
 * doing work on the REAL tree: if `constantsIn` silently matched nothing — a regex edited, a
 * declaration form nobody thought of — every assertion below would still be green, and the guard
 * would be back to the hole it was written to close. `clipboard-copy.ts` supplies the count today.
 */
function raisesResolvingAConstant(file: Source): number {
  const constants = constantsIn(file);
  let found = 0;
  for (const raise of raisesIn(file)) {
    for (const field of READ_ALOUD) {
      const key = new RegExp(`\\b${field}\\s*:\\s*`).exec(raise.body);
      if (!key) continue;
      const named = REFERENCE.exec(raise.body.slice(key.index + key[0].length));
      if (named && constants.has(named[1]!)) found += 1;
    }
  }
  return found;
}

function standsInForItsSubject(
  body: string,
  constants: ReadonlyMap<string, string>,
): { field: string; text: string }[] {
  if (NO_SUBJECT.test(body)) return [];
  const out: { field: string; text: string }[] = [];
  for (const field of READ_ALOUD) {
    const key = new RegExp(`\\b${field}\\s*:\\s*`).exec(body);
    if (!key) continue;
    const text = spokenValue(body.slice(key.index + key[0].length), constants);
    if (text !== undefined && STAND_IN.test(text)) out.push({ field, text });
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

  it('follows a raise that speaks through a constant, rather than resolving none', () => {
    const resolved = noticeSources.reduce((n, f) => n + raisesResolvingAConstant(f), 0);
    expect(
      resolved,
      'No raise in the notice model was seen to reference a string constant. Either the resolver is ' +
        'broken — in which case Rule B is back to being defeatable by the plainest refactor there ' +
        'is — or the house style changed and this number needs revisiting deliberately.',
    ).toBeGreaterThan(0);
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
    expect(standsInForItsSubject(raise!.body, constantsIn(OFFENDING))).toEqual([
      { field: 'message', text: 'The file could not be renamed.' },
    ]);
  });

  /**
   * …AND SEES IT WHEN THE SENTENCE IS HOISTED INTO A CONSTANT.
   *
   * This is the shape that defeated the guard. Rule B only read a field whose value STARTS with a
   * literal, and Rule A only fires on a literal that is a stand-in noun phrase and nothing else — so
   * a whole sentence moved into a module-level `const` and referenced at the raise passed both, while
   * the identical sentence written inline was caught. `common/clipboard-copy.ts` is written exactly
   * that way (`const COPY_FAILED = …` at the top, `message: COPY_FAILED` at the raise), and it is
   * the house style for a string two surfaces must share (FR-042d) — so the defeating shape is not
   * hypothetical, it is the one this feature's own code uses.
   *
   * SC-013 claims such a notice is rejected before it can be merged. It is only true if the guard
   * follows the reference.
   */
  const HOISTED: Source = {
    name: 'fixture.ts',
    text: [
      "const RENAME_FAILED = 'The file could not be renamed.';",
      'notify({',
      "  severity: 'error',",
      "  subject: { kind: 'file', name: 'alpha.txt' },",
      '  message: RENAME_FAILED,',
      '});',
    ].join('\n'),
  };

  it('Rule A does NOT see it — which is why Rule B has to', () => {
    // Stated rather than assumed: if Rule A ever grew to cover this, the test below would pass for
    // a reason that had nothing to do with the fix, and the hole would reopen unnoticed.
    expect(namesNothing(HOISTED)).toEqual([]);
  });

  it('Rule B resolves a message hoisted into a module-level constant', () => {
    const [raise] = raisesIn(HOISTED);
    expect(raise, 'the fixture raise was not parsed').toBeDefined();
    expect(standsInForItsSubject(raise!.body, constantsIn(HOISTED))).toEqual([
      { field: 'message', text: 'The file could not be renamed.' },
    ]);
  });

  it('a constant a raise does not use is not attributed to it', () => {
    // The resolver reads the whole module, so an unrelated constant is in the map. It may only be
    // reported where a raise actually NAMES it — otherwise the guard reports the file, not the
    // notice, and the failure message points at a line the reader cannot act on.
    const unused: Source = {
      name: 'fixture.ts',
      text: `const UNUSED = 'That folder could not be read.';\n${HOISTED.text.replace(
        'message: RENAME_FAILED,',
        "message: 'It could not be renamed.',",
      )}`,
    };
    const [raise] = raisesIn(unused);
    expect(standsInForItsSubject(raise!.body, constantsIn(unused))).toEqual([]);
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
    expect(standsInForItsSubject(raise!.body, constantsIn(excused))).toEqual([]);
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
    const offences = noticeSources.flatMap((f) => {
      // Resolved ONCE per file: the constants belong to the module, not to any one raise inside it.
      const constants = constantsIn(f);
      return raisesIn(f).flatMap((r) =>
        standsInForItsSubject(r.body, constants).map((o) => `${r.at}  ${o.field}: ${o.text}`),
      );
    });
    expect(
      offences,
      'This raise KNOWS what it is about — it states a subject — and its text refers to that ' +
        'subject generically anyway. The heading already presents the name (FR-020); the message ' +
        'should state only what went wrong (FR-023), which is what "It" is for.',
    ).toEqual([]);
  });
});
