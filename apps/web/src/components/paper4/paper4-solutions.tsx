"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { SolutionContent } from "@/components/luq/solution-content";
import { LuqAssistance } from "@/components/luq/assistance";
import { type EditorTheme } from "@/components/student/editor-themes";

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
  // The server checks current exam restrictions even for an existing entitlement.
  // Merely opening this tab never fetches reference code or records a delivery.
  return <LuqAssistance target={{ paper4AttemptId: attemptId, questionKey }} kind="FULL_SOLUTION" renderBody={body => <section aria-label={tx("本题参考答案", "Reference solution")} data-od-id="paper4-solution">
    <h2 className="mb-3 text-sm font-semibold">{tx("参考答案", "Reference solution")}</h2>
    <SolutionContent body={body} theme={theme} onThemeChange={onThemeChange} codeActions={code => <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopiedCode(code); setCopyError(""); } catch { setCopyError(tx("暂时无法复制，请选中内容后手动复制。", "Copy is unavailable. Select the content and copy it manually.")); } }}>{copiedCode === code ? <Check size={14} aria-hidden="true"/> : <Copy size={14} aria-hidden="true"/>}{copiedCode === code ? tx("已复制", "Copied") : tx("复制代码", "Copy code")}</Button>}/>
    {copyError && <p role="status" className="mb-3 text-xs text-muted-foreground">{copyError}</p>}
  </section>}/>;
}
