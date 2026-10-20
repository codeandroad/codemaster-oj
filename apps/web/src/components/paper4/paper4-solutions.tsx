"use client";

import { useState, type CSSProperties } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/student/shared";
import { MathContent } from "@/components/math-content";
import { LuqAssistance } from "@/components/luq/assistance";
import { editorTheme, editorThemes, type EditorTheme } from "@/components/student/editor-themes";

export function Paper4Solutions({ attemptId, questionKey, theme, onThemeChange }: {
  attemptId: string;
  questionKey: string;
  locked: boolean;
  theme: EditorTheme;
  onThemeChange: (theme: EditorTheme) => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [copiedCode, setCopiedCode] = useState<string | null>(null), [copyError, setCopyError] = useState("");
  const selectedTheme = editorTheme(theme);
  // The server checks current exam restrictions even for an existing entitlement.
  // Merely opening this tab never fetches reference code or records a delivery.
  return <LuqAssistance target={{ paper4AttemptId: attemptId, questionKey }} kind="FULL_SOLUTION" renderBody={body => <section aria-label={tx("本题参考答案", "Reference solution")} data-od-id="paper4-solution">
    <h2 className="mb-3 text-sm font-semibold">{tx("参考答案", "Reference solution")}</h2>
    <MathContent content={body} renderCode={(code, language) => <section className="my-3 min-w-0 overflow-hidden rounded-md border border-border" aria-label={tx("参考代码", "Reference code")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-3 py-2">
        <span className="text-xs font-semibold">{tx("参考代码", "Reference code")}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="shrink-0">{tx("代码主题", "Code theme")}</span><select value={theme} onChange={event => onThemeChange(editorTheme(event.target.value).id)} className="min-h-8 min-w-0 max-w-40 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary">{editorThemes.map(item => <option key={item.id} value={item.id}>{item.id === "github-dark" ? "GitHub Dark" : item.id === "github-light" ? "GitHub Light" : item.label}</option>)}</select></label>
        <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopiedCode(code); setCopyError(""); } catch { setCopyError(tx("暂时无法复制，请选中内容后手动复制。", "Copy is unavailable. Select the content and copy it manually.")); } }}>{copiedCode === code ? <Check size={14} aria-hidden="true"/> : <Copy size={14} aria-hidden="true"/>}{copiedCode === code ? tx("已复制", "Copied") : tx("复制代码", "Copy code")}</Button>
      </div>
      </div>
      <div style={{ ...selectedTheme.tokens, colorScheme: selectedTheme.type } as CSSProperties} data-solution-theme={theme}><CodeBlock code={code} language={language === "cpp" ? "cpp" : language === "javascript" || language === "js" ? "javascript" : "python"}/></div>
    </section>}/>
    {copyError && <p role="status" className="mb-3 text-xs text-muted-foreground">{copyError}</p>}
  </section>}/>;
}
