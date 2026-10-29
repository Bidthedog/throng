/**
 * 059 FR-069 — the misread warning for a file read in a code page: when it is raised, and which code page
 * it suggests. The samples are written with throng's encoder and read back with its decoder, as a file opened
 * in the wrong code page would be; jschardet runs for real, since the suggestion IS its answer.
 */
import { describe, expect, it } from 'vitest';
import { encode, looksMisreadAs, readText, type CodePageId } from '@throng/core';
import { codePageHint } from '../../src/main/code-page-guess.js';

const SAMPLES: Record<string, [CodePageId, string]> = {
  greek: [
    'windows1253',
    'Καλημέρα σας. Αυτό είναι ένα δοκιμαστικό αρχείο.\nΗ γρήγορη καφέ αλεπού πηδάει πάνω από τον τεμπέλη σκύλο.\nΤρίτη γραμμή κειμένου στα ελληνικά.\n',
  ],
  russian: [
    'windows1251',
    'Привет, это тестовый файл.\nСъешь же ещё этих мягких французских булок, да выпей чаю.\nТретья строка текста на русском языке.\n',
  ],
  hebrew: ['windows1255', 'שלום, זהו קובץ בדיקה.\nדג סקרן שט בים מאוכזב ולפתע מצא חברה.\nשורה שלישית של טקסט בעברית.\n'],
  polish: ['windows1250', 'Zażółć gęślą jaźń. To jest plik testowy.\nPchnąć w tę łódź jeża lub ośm skrzyń fig.\nTrzecia linia.\n'],
  french: [
    'windows1252',
    'Bonjour, ceci est un fichier de test.\nVoix ambiguë d’un cœur qui au zéphyr préfère les jattes de kiwis.\nQuatrième ligne.\n',
  ],
  german: ['windows1252', 'Grüße aus Zürich. Über die Brücke.\nFalsches Üben von Xylophonmusik quält jeden größeren Zwerg.\n'],
  danish: ['windows1252', 'Høj bly gom vandt fræk sexquiz på wc.\nAnden linje.\nTredje linje.\n'],
  legacy: ['windows1252', 'café costs £5 or 5€\nüber\nthird line\n'],
};

function hintFor(name: string, readAs: CodePageId) {
  const [page, text] = SAMPLES[name] as [CodePageId, string];
  const bytes = encode(text, { encoding: page, hasBom: false, lineEnding: 'lf' });
  const r = readText(bytes, readAs);
  if (!r.ok) throw new Error(`${name} is not readable as ${readAs}`);
  return codePageHint(bytes, r.file.text, readAs);
}

describe('codePageHint (059 FR-069)', () => {
  it('raises nothing for a file read in its own code page', () => {
    for (const [name, [page]] of Object.entries(SAMPLES)) expect(hintFor(name, page), name).toBeNull();
  });

  it('names the code page for non-Latin text read as Western', () => {
    expect(hintFor('greek', 'windows1252')).toEqual({ likely: 'windows1253' });
    expect(hintFor('russian', 'windows1252')).toEqual({ likely: 'windows1251' });
    expect(hintFor('hebrew', 'windows1252')).toEqual({ likely: 'windows1255' });
  });

  it('names Central European for Polish read as Western', () => {
    expect(hintFor('polish', 'windows1252')).toEqual({ likely: 'windows1250' });
  });

  it('catches one non-Latin script read as another, which the text alone does not show', () => {
    expect(hintFor('greek', 'windows1251')).toEqual({ likely: 'windows1253' });
  });

  it('names Western for Western text read as Cyrillic', () => {
    expect(hintFor('french', 'windows1251')).toEqual({ likely: 'windows1252' });
    expect(hintFor('legacy', 'windows1251')).toEqual({ likely: 'windows1252' });
  });

  it('a Greek file with a byte 1253 leaves undefined is still named Greek, never Turkish (FR-072)', () => {
    const [, text] = SAMPLES.greek as [CodePageId, string];
    const greek = encode(text, { encoding: 'windows1253', hasBom: false, lineEnding: 'lf' });
    const bytes = Uint8Array.from([...greek.subarray(0, 20), 0xaa, ...greek.subarray(20)]);
    const r = readText(bytes, 'windows1252');
    if (!r.ok) throw new Error('unreadable');
    expect(codePageHint(bytes, r.file.text, 'windows1252')).toEqual({ likely: 'windows1253' });
  });

  it('never suggests a code page whose own reading looks misread', () => {
    // Every suggestion, for every sample read wrongly, reads cleanly in what it suggests.
    for (const [name, [page]] of Object.entries(SAMPLES)) {
      for (const readAs of ['windows1252', 'windows1251', 'windows1253'] as const) {
        if (readAs === page) continue;
        const likely = hintFor(name, readAs)?.likely;
        if (!likely) continue;
        const [, text] = SAMPLES[name] as [CodePageId, string];
        const bytes = encode(text, { encoding: page, hasBom: false, lineEnding: 'lf' });
        const again = readText(bytes, likely);
        expect(again.ok && looksMisreadAs(again.file.text, likely), `${name} as ${readAs} → ${likely}`).toBe(false);
      }
    }
  });

  it('offers no code page when its best guess is the one already read', () => {
    // The text is flagged (a word mixes scripts), but the bytes are Russian, so jschardet's best IS 1251.
    const [, text] = SAMPLES.russian as [CodePageId, string];
    const bytes = encode(text, { encoding: 'windows1251', hasBom: false, lineEnding: 'lf' });
    expect(codePageHint(bytes, 'caf\u{439} costs', 'windows1251')).toEqual({ likely: null });
  });
});
