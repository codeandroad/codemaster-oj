import type { SubmissionLanguage } from "@/lib/production-api";
import styles from "./code-editor.module.css";

const keywords: Record<SubmissionLanguage, Set<string>> = {
  python: new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" ")),
  cpp: new Set("auto bool break case catch char class const constexpr continue default delete do double else enum explicit false float for if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while".split(" ")),
  javascript: new Set("async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof undefined var void while yield".split(" ")),
};
const builtin = new Set("print input range len list int str enumerate sum console Math JSON Array Object String Number Boolean std json cin cout vector string".split(" "));
const pythonBuiltins = new Set("abs all any bin bool bytes chr dict divmod filter float hex map max min ord pow reversed round set sorted tuple zip".split(" "));
const tokenPattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/gm;
const pythonTokenPattern = /(#[^\n]*|"""(?:[^\\]|\\[\s\S])*?"""|'''(?:[^\\]|\\[\s\S])*?'''|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;

export function CodeTokens({ code, language, matches }: { code: string; language: SubmissionLanguage; matches?: [number,number] | null }) {
  const python = language === "python";
  const elements=[];let offset=0;
  for(const token of code.split(python ? pythonTokenPattern : tokenPattern)){
    const isComment = token.startsWith("#") || (!python && (token.startsWith("//") || token.startsWith("/*")));
    const isString = token.startsWith('"') || token.startsWith("'") || (!python && token.startsWith("`"));
    const isBuiltin = builtin.has(token) || (python && pythonBuiltins.has(token));
    const color = isComment ? "text-[var(--syntax-comment)]"
      : isString ? "text-[var(--syntax-string)]"
      : keywords[language].has(token) ? "text-[var(--syntax-keyword)]"
      : /^\d/.test(token) ? "text-[var(--syntax-number)]"
      : isBuiltin ? "text-[var(--syntax-builtin)]" : undefined;
    const start=offset;offset+=token.length;const containsMatch=matches?.some(position=>position>=start&&position<offset);
    const decorated=[];let localOffset=0;
    if(containsMatch)for(const character of token){const position=start+localOffset;localOffset+=character.length;decorated.push(<span key={position} className={matches?.includes(position)?styles.matchedBracket:undefined}>{character}</span>);}
    elements.push(<span key={start+":"+elements.length} className={color}>{containsMatch?decorated:token}</span>);
  }
  return <>{elements}</>;
}

