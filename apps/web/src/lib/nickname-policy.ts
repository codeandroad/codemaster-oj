// Browser mirror of packages/domain/src/nickname-policy.mjs; contract-tested together.
export const NICKNAME_MAX_UNITS = 20;
const segments = new Intl.Segmenter("en", { granularity: "grapheme" });
const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
export const normalizeNickname = (value: string) => value.trim().normalize("NFC");
export function nicknameUnits(value: string) {
  return Array.from(segments.segment(normalizeNickname(value)), ({ segment }) => wide.test(segment) ? 2 : 1)
    .reduce((total, units) => total + units, 0);
}
export const nicknameTooLong = (value: string) => nicknameUnits(value) > NICKNAME_MAX_UNITS;
