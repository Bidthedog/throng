/**
 * 059 FR-069 — does text read in a code page look wrong for it?
 *
 * Each sample is written in its own code page with throng's encoder, then read back in another with throng's
 * decoder, exactly as a file opened in the wrong code page would be. The check is on the decoded text alone.
 */
import { describe, expect, it } from 'vitest';
import { looksMisreadAs } from '../../src/editor/misread-hint.js';
import { encode, readText } from '../../src/editor/text-fidelity.js';
import type { CodePageId } from '../../src/workspace/model.js';

const SAMPLES: Record<string, [CodePageId, string]> = {
  greek: ['windows1253', 'Καλημέρα σας. Αυτό είναι ένα δοκιμαστικό αρχείο.\nΗ γρήγορη καφέ αλεπού πηδάει.\n'],
  russian: ['windows1251', 'Привет, это тестовый файл.\nСъешь же ещё этих мягких французских булок.\n'],
  hebrew: ['windows1255', 'שלום, זהו קובץ בדיקה.\nדג סקרן שט בים מאוכזב ולפתע מצא חברה.\n'],
  arabic: ['windows1256', 'مرحبا، هذا ملف اختبار.\nنص حكيم له سر قاطع وذو شأن عظيم.\n'],
  polish: ['windows1250', 'Zażółć gęślą jaźń. To jest plik testowy.\nPchnąć w tę łódź jeża lub ośm skrzyń fig.\n'],
  czech: ['windows1250', 'Příliš žluťoučký kůň úpěl ďábelské ódy.\nDruhý řádek.\n'],
  french: ['windows1252', 'Voix ambiguë d’un cœur qui au zéphyr préfère les jattes de kiwis.\nQuatrième ligne, 5€.\n'],
  german: ['windows1252', 'Grüße aus Zürich. Über die Brücke.\nFalsches Üben von Xylophonmusik quält jeden größeren Zwerg.\n'],
  spanish: ['windows1252', 'El pingüino Wenceslao hizo kilómetros bajo exhaustiva lluvia y frío.\n¿Qué tal?\n'],
  portuguese: ['windows1252', 'À noite, vovô Kowalsky vê o ímã cair no pé do pinguim queixoso.\n'],
  danish: ['windows1252', 'Høj bly gom vandt fræk sexquiz på wc.\n'],
  catalan: ['windows1252', 'Col·lecció d’il·lustracions.\n'],
  prices: ['windows1252', 'Tea costs £2.50, coffee 3€ — “cheap” at ±5 °C, 3×4, ½ off.\n'],
  legacy: ['windows1252', 'café costs £5 or 5€\nüber\n'],
};

/** The text a sample shows when its bytes are read in `readAs`. */
function readIn(name: string, readAs: CodePageId): string {
  const [page, text] = SAMPLES[name] as [CodePageId, string];
  const bytes = encode(text, { encoding: page, hasBom: false, lineEnding: 'lf' });
  const r = readText(bytes, readAs);
  if (!r.ok) throw new Error(`${name} is not readable as ${readAs}`);
  return r.file.text;
}

describe('looksMisreadAs (059 FR-069)', () => {
  it('never flags a file read in its own code page', () => {
    for (const [name, [page]] of Object.entries(SAMPLES)) {
      expect(looksMisreadAs(readIn(name, page), page), name).toBe(false);
    }
  });

  it('flags non-Latin text read as a Latin code page: its letters are mostly accented', () => {
    for (const name of ['greek', 'russian', 'hebrew', 'arabic']) {
      expect(looksMisreadAs(readIn(name, 'windows1252'), 'windows1252'), name).toBe(true);
    }
  });

  it('flags Central European text read as Western: a symbol sits inside a word', () => {
    expect(looksMisreadAs(readIn('polish', 'windows1252'), 'windows1252')).toBe(true);
    expect(looksMisreadAs(readIn('czech', 'windows1252'), 'windows1252')).toBe(true);
  });

  it('flags Western text read as Greek or Cyrillic: a word mixes scripts', () => {
    for (const name of ['french', 'german', 'spanish', 'danish', 'legacy']) {
      expect(looksMisreadAs(readIn(name, 'windows1251'), 'windows1251'), name).toBe(true);
      expect(looksMisreadAs(readIn(name, 'windows1253'), 'windows1253'), name).toBe(true);
    }
  });

  it('a placeholder for an undefined byte is not a symbol inside a word (FR-072)', () => {
    const [, text] = SAMPLES.greek as [CodePageId, string];
    const greek = encode(text, { encoding: 'windows1253', hasBom: false, lineEnding: 'lf' });
    const r = readText(Uint8Array.from([...greek.subarray(0, 3), 0xaa, ...greek.subarray(3)]), 'windows1253');
    expect(r.ok && looksMisreadAs(r.file.text, 'windows1253')).toBe(false);
  });

  it('plain ASCII is never suspect, whatever it was read as', () => {
    expect(looksMisreadAs('Just ASCII text.\nSecond line.\n', 'windows1251')).toBe(false);
  });
});
