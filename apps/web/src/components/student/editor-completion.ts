import type { SubmissionLanguage } from "@/lib/production-api";

export interface EditorCompletionCandidate {
  label: string;
  kind: "identifier" | "keyword" | "builtin";
}

export interface EditorCompletion {
  from: number;
  to: number;
  prefix: string;
  candidates: EditorCompletionCandidate[];
}

const keywords: Record<SubmissionLanguage, string[]> = {
  python: ("False None True and as assert async await break case class continue def del elif else except " +
    "finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield").split(" "),
  cpp: ("alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t " +
    "class compl concept const const_cast consteval constexpr constinit continue co_await co_return co_yield " +
    "decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if " +
    "inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public " +
    "register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch " +
    "template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile " +
    "wchar_t while xor xor_eq").split(" "),
  javascript: ("async await break case catch class const continue debugger default delete do else export extends " +
    "false finally for function if import in instanceof let new null of return static super switch this throw " +
    "true try typeof var void while with yield").split(" "),
};

const builtins: Record<SubmissionLanguage, string[]> = {
  python: ("abs all any bin bool bytearray bytes callable chr dict divmod enumerate filter float format frozenset " +
    "getattr hasattr hash hex input int isinstance issubclass iter len list map max min next oct open ord pow " +
    "print range repr reversed round set setattr slice sorted str sum super tuple type zip").split(" "),
  cpp: ("abs accumulate array binary_search cerr cin clamp copy cout deque endl fill find getline ios iota list " +
    "lower_bound make_pair make_tuple map max min move nth_element pair pow printf priority_queue push_back queue " +
    "reverse scanf set sort sqrt stack std string swap tuple unique unordered_map unordered_set upper_bound vector").split(" "),
  javascript: ("Array BigInt Boolean Buffer Date Error Infinity Intl JSON Map Math NaN Number Object Promise RegExp " +
    "Set String Symbol Uint8Array WeakMap WeakSet console decodeURI decodeURIComponent encodeURI encodeURIComponent " +
    "globalThis isFinite isNaN parseFloat parseInt process require setInterval setTimeout undefined").split(" "),
};

const languageCandidates = Object.fromEntries((Object.keys(keywords) as SubmissionLanguage[]).map(language => {
  const words = new Map<string, EditorCompletionCandidate["kind"]>();
  for (const keyword of keywords[language]) words.set(keyword, "keyword");
  for (const builtin of builtins[language]) if (!words.has(builtin)) words.set(builtin, "builtin");
  return [language, words];
})) as Record<SubmissionLanguage, Map<string, EditorCompletionCandidate["kind"]>>;

const singleLineStrings = /"(?:\\(?:[\s\S]|$)|[^"\\\r\n])*"?|'(?:\\(?:[\s\S]|$)|[^'\\\r\n])*'?/;
const slashComments = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/;
const pythonStrings = /"""(?:\\(?:[\s\S]|$)|(?!""")[^\\])*(?:"""|$)|'''(?:\\(?:[\s\S]|$)|(?!''')[^\\])*(?:'''|$)/;
const templateString = /\x60(?:\\(?:[\s\S]|$)|[^\x60\\])*\x60?/;
const identifierStart = /[_\p{ID_Start}]/u;
const identifierRest = /[_\p{ID_Continue}]/u;
const javascriptStart = /[_$\p{ID_Start}]/u;
const javascriptRest = /[_$\p{ID_Continue}\u200C\u200D]/u;

function tokenPattern(ignored: RegExp[], start: RegExp, rest: RegExp, number: RegExp) {
  return new RegExp(
    [...ignored, singleLineStrings, number].map(pattern => pattern.source).join("|") +
      "|(" + start.source + rest.source + "*)",
    "gu",
  );
}

const tokens = {
  python: tokenPattern([pythonStrings, /#[^\r\n]*/], identifierStart, identifierRest, /[0-9]\w*/),
  cpp: tokenPattern([slashComments], identifierStart, identifierRest, /[0-9]\w*(?:'\w+)*/),
  javascript: tokenPattern([slashComments, templateString], javascriptStart, javascriptRest, /[0-9]\w*/),
};

const maxCandidates = 8;

export function getEditorCompletion(code: string, cursor: number, language: SubmissionLanguage): EditorCompletion | null {
  if (cursor < 1 || cursor > code.length) return null;

  const documentWords = new Set<string>();
  let active: { from: number; to: number; prefix: string; word: string } | undefined;
  for (const token of code.matchAll(tokens[language])) {
    const from = token.index;
    if (from >= cursor && !active) return null;

    const to = from + token[0].length;
    const word = token[1];
    if (from < cursor && cursor <= to) {
      if (!word) return null;
      active = { from, to, prefix: code.slice(from, cursor), word };
    } else if (word) {
      documentWords.add(word);
    }
  }
  if (!active) return null;

  const { from, to, prefix, word } = active;
  const languageWords = languageCandidates[language];
  const candidates: EditorCompletionCandidate[] = [];
  for (const label of documentWords) {
    if (label === word || !label.startsWith(prefix) || languageWords.has(label)) continue;
    candidates.push({ label, kind: "identifier" });
    if (candidates.length === maxCandidates) break;
  }
  for (const [label, kind] of languageWords) {
    if (candidates.length === maxCandidates) break;
    if (label !== word && label.startsWith(prefix)) candidates.push({ label, kind });
  }
  return candidates.length ? { from, to, prefix, candidates } : null;
}
