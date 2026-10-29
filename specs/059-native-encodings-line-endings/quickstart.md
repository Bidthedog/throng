# Quickstart: validating native encodings and line-ending conversion

## Fixtures

Make them with Windows PowerShell 5.1, or byte-exactly in Node:

| File | How |
|---|---|
| `utf16le-bom.txt` | `powershell -NoProfile -Command '"héllo" > utf16le-bom.txt'` (PowerShell 5.1) |
| `utf16be-bom.txt` | bytes `FE FF 00 68 00 E9 00 6C 00 6C 00 6F` |
| `utf16le-nobom.txt` | `Buffer.from('hello world\r\n', 'utf16le')` |
| `cp1252.txt` | bytes `63 61 66 E9 20 A3 35 20 80 0D 0A` (`café £5 €`, CRLF) |
| `mixed.txt` | `a\r\nb\nc\r\n` |
| `utf32.txt` | bytes `FF FE 00 00 68 00 00 00` |

## Automated

```bash
npx vitest run packages/core/tests/unit/text-fidelity.test.ts packages/core/tests/unit/text-format-fixtures.test.ts
npx vitest run packages/ui/tests/unit/document-authority-line-format.test.ts
npx vitest run --project integration packages/ui/tests/integration/editor-encoding.integration.test.ts
npx vitest run --project component packages/ui/tests/component/status-strip-encoding.test.ts
```

Each scenario's expected outcome is the acceptance scenario of the same number in
[spec.md](./spec.md) (US1–US5).

## By hand

1. Open `cp1252.txt`: the characters display, and the status bar reads `Windows-1252` · `CRLF`.
2. Edit the first word and save. A hex diff shows only those bytes changed.
3. Type an emoji and save: one inline notice names it and offers Save as UTF-8, and the file is untouched.
4. Open `utf16le-bom.txt`: it reads `héllo` and the indicator shows `UTF-16 LE`. Edit, save, and the
   BOM is still `FF FE`.
5. Open `mixed.txt`: the indicator reads `Mixed (CRLF)`. Click it → Convert to LF, and the document is
   dirty. Undo, and it is clean again with the indicator back to `Mixed (CRLF)`.
6. Open `utf32.txt`: it is refused with a message naming UTF-32.
7. Narrow the panel until the readouts are gone. The line-ending indicator hides, then the encoding
   indicator. The language label and wrap toggle stay.
