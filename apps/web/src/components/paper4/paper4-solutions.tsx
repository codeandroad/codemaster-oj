"use client";

import { useState, type CSSProperties } from "react";
import { Check, Copy, LockKeyhole } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { CodeBlock, State, useData } from "@/components/student/shared";
import { editorTheme, editorThemes, type EditorTheme } from "@/components/student/editor-themes";

interface Paper4Solution {
  questionKey: string;
  language: "python";
  code: string;
}

export function Paper4Solutions({ attemptId, questionKey, locked, theme, onThemeChange }: {
  attemptId: string;
  questionKey: string;
  locked: boolean;
  theme: EditorTheme;
  onThemeChange: (theme: EditorTheme) => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  // The parent keys this view by attempt and question. A late response from
  // another question cannot appear under the newly selected question's title.
  const solution = useData<Paper4Solution>(locked ? "" : `paper4/attempts/${encodeURIComponent(attemptId)}/solutions/${encodeURIComponent(questionKey)}`);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const selectedTheme = editorTheme(theme);

  if (locked) return <section className="rounded-md border border-border bg-surface-subtle p-4" aria-labelledby="paper4-solutions-locked">
    <h2 id="paper4-solutions-locked" className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole size={16} aria-hidden="true"/>{tx("成绩公布后开放参考答案", "Solution opens after results are released")}</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{tx("教师公布本次模拟考试成绩后，可在这里查看当前大题的参考答案。", "Your reference solution will be available here after your teacher releases the results for this mock exam.")}</p>
  </section>;

  return <State data={solution}>{solution.data?.questionKey === questionKey && <section aria-label={tx("本题参考答案", "Reference solution")} data-od-id="paper4-solution">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-semibold">{tx("参考答案", "Reference solution")}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{questionKey}.py · Python 3</p></div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">{tx("代码主题", "Code theme")}</span>
        <select value={theme} onChange={event => onThemeChange(editorTheme(event.target.value).id)} className="min-h-8 min-w-0 max-w-40 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          {editorThemes.map(item => <option key={item.id} value={item.id}>{item.id === "github-dark" ? "GitHub Dark" : item.id === "github-light" ? "GitHub Light" : item.label}</option>)}
        </select>
      </label>
      <Button size="sm" variant="secondary" onClick={async () => {
        try {
          await navigator.clipboard.writeText(solution.data!.code);
          setCopied(true);
          setCopyError("");
        } catch {
          setCopyError(tx("暂时无法复制，请选中代码后手动复制。", "Copy is unavailable. Select the code and copy it manually."));
        }
      }}>{copied ? <Check size={14} aria-hidden="true"/> : <Copy size={14} aria-hidden="true"/>}{copied ? tx("已复制", "Copied") : tx("复制代码", "Copy code")}</Button>
      </div>
    </div>
    {copyError && <p role="status" className="mb-3 text-xs text-muted-foreground">{copyError}</p>}
    <div className="overflow-hidden rounded-md border border-border" style={{ ...selectedTheme.tokens, colorScheme: selectedTheme.type } as CSSProperties} data-solution-theme={theme}><CodeBlock code={solution.data.code} language="python"/></div>
  </section>}</State>;
}
