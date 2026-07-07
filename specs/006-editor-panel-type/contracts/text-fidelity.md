# Contract: Text fidelity — encoding & line endings (core — Phase A)

Pure `@throng/core/editor/text-fidelity.ts`. No OS/DOM (operates on `Uint8Array`/`string`). Implements
FR-025/026/026a and SC-005.

## Functions

```ts
function detectEncoding(bytes: Uint8Array): { encoding: 'utf8'; hasBom: boolean };
function decode(bytes: Uint8Array): { text: string; encoding: 'utf8'; hasBom: boolean; lineEnding: 'lf'|'crlf'|'cr' };
function detectLineEnding(text: string): 'lf' | 'crlf' | 'cr';
function encode(text: string, opts: { encoding: 'utf8'; hasBom: boolean; lineEnding: 'lf'|'crlf'|'cr' }): Uint8Array;
function newDocumentDefaults(defaultLineEnding: 'lf'|'crlf'|'cr'): { encoding: 'utf8'; hasBom: boolean; lineEnding: 'lf'|'crlf'|'cr' };
```

## Obligations
- **Encoding**: detect UTF-8 with/without **BOM** (`EF BB BF`); `encode` re-emits the BOM **iff** `hasBom`.
  New documents are **UTF-8, no BOM** (FR-025). (The signature is extensible to more encodings later; this
  pass ships UTF-8.)
- **Line endings**: `detectLineEnding` returns the **dominant** style; `encode` applies the recorded ending
  so **untouched lines keep their original breaks** (no whole-file churn). The editor supports **CRLF, LF,
  and CR** (FR-026). New docs use `editor.defaultLineEnding` (default **LF**, FR-026a).
- **Round-trip**: `encode(decode(bytes).text, decode(bytes))` reproduces the original bytes for a file that
  was not edited (BOM + endings preserved) — the basis of SC-005.
- Pure and deterministic; no I/O (the UI-main service supplies the bytes).

## Contract tests (unit)
UTF-8-with-BOM + CRLF round-trips byte-identical after a single-line edit (only that line changes);
UTF-8-no-BOM + LF likewise; mixed endings resolve to the dominant style; new-doc defaults = UTF-8/no-BOM/
`defaultLineEnding`; CR-only files detected and preserved.
