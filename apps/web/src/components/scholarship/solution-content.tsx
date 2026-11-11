"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useLocale } from "@/components/locale-context";
import { MathContent } from "@/components/math-content";
import { CodeBlock } from "@/components/student/shared";
import { editorTheme, editorThemes, type EditorTheme } from "@/components/student/editor-themes";

export type SolutionArticle = { id: string; title: string; body: string };

export function SolutionBundle({ body, solutions, ...options }: Parameters<typeof SolutionContent>[0] & { solutions?: SolutionArticle[] }) {
  const { locale } = useLocale();
  const group = useId();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = solutions?.find(solution => solution.id === selectedId) ?? solutions?.[0];

  if (!selected) return <SolutionContent body={body} {...options} />;

  return <div className="min-w-0 space-y-4">
    {solutions && solutions.length > 1 && <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">{locale === "en" ? "Solution approaches" : "解法列表"}</legend>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {solutions.map(solution => <label key={solution.id}
          className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-subtle has-checked:bg-primary/5 has-checked:font-semibold">
          <input type="radio" name={group} checked={selected.id === solution.id}
            onChange={() => setSelectedId(solution.id)}
            className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{solution.title}</span>
        </label>)}
      </div>
    </fieldset>}
    <article aria-labelledby={`${group}-title`}>
      <h2 id={`${group}-title`} className="mb-3 text-base font-semibold [overflow-wrap:anywhere]">{selected.title}</h2>
      <SolutionContent body={selected.body} {...options} />
    </article>
  </div>;
}

/** Presentation only: callers must obtain the body through authorized delivery/preview. */
export function SolutionContent({ body, theme, onThemeChange, codeActions }: {
  body: string;
  theme?: EditorTheme;
  onThemeChange?: (theme: EditorTheme) => void;
  codeActions?: (code: string) => ReactNode;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [localTheme, setLocalTheme] = useState<EditorTheme>("github-dark");
  const value = theme ?? localTheme;
  const selected = editorTheme(value);
  return <MathContent content={body} renderCode={(code, language) => <section
    className="my-3 min-w-0 overflow-hidden rounded-md border border-border"
    aria-label={tx("参考代码", "Reference code")}>
    <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-surface-subtle px-3 py-2">
      <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">{tx("代码主题", "Code theme")}</span>
        <select value={value} aria-label={tx("参考代码主题", "Reference code theme")}
          onChange={event => (onThemeChange ?? setLocalTheme)(editorTheme(event.target.value).id)}
          className="min-h-8 min-w-0 max-w-48 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          {editorThemes.map(item => <option key={item.id} value={item.id}>{
            item.id === "github-dark" ? "GitHub Dark" : item.id === "github-light" ? "GitHub Light" : item.label
          }</option>)}
        </select>
      </label>
      {codeActions?.(code)}
    </div>
    <div style={{ ...selected.tokens, colorScheme: selected.type } as CSSProperties} data-solution-theme={value}>
      <CodeBlock code={code} language={language === "cpp" ? "cpp" : language === "javascript" || language === "js" ? "javascript" : "python"}/>
    </div>
  </section>}/>;
}
