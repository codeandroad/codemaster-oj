// Display-width budget: keep this pure policy aligned with web/src/lib/nickname-policy.ts.
export const NICKNAME_MAX_UNITS = 20;
const segments = new Intl.Segmenter('en', { granularity: 'grapheme' });
const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
export const normalizeNickname = value => value.trim().normalize('NFC');
export function nicknameUnits(value) {
  return Array.from(segments.segment(normalizeNickname(value)), ({ segment }) => wide.test(segment) ? 2 : 1)
    .reduce((total, units) => total + units, 0);
}
export const nicknameTooLong = value => nicknameUnits(value) > NICKNAME_MAX_UNITS;
