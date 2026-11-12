"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useLocale } from "@/components/locale-context";
import { MathContent } from "@/components/math-content";
import { CodeBlock } from "@/components/student/shared";
import { editorTheme, editorThemes, type EditorTheme } from "@/components/student/editor-themes";
import { languageInfo, supportedLanguages } from "@/components/student/languages";
import type { SubmissionLanguage } from "@/lib/production-api";
import { selectSolution, solutionsForLanguage, type SolutionArticle, type SolutionLanguageFilter } from "./solution-model";
export type { SolutionArticle } from "./solution-model";

export function SolutionBundle(props: Parameters<typeof SolutionContent>[0] & { solutions?: SolutionArticle[]; preferredLanguage?: SubmissionLanguage }) {
  // Changing the editor language resets only this view, retaining the authorized delivery.
  return <SolutionBundleView key={props.preferredLanguage ?? "all"} {...props} />;
}

function SolutionBundleView({ body, solutions, preferredLanguage, ...options }: Parameters<typeof SolutionBundle>[0]) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const group = useId();
  const [language, setLanguage] = useState<SolutionLanguageFilter>(preferredLanguage ?? "all");
  const [selectedId, setSelectedId] = useState<string>();
  const selected = selectSolution(solutions ?? [], language, selectedId);
  const visible = solutionsForLanguage(solutions ?? [], language);
  const languageName = (value: SolutionLanguageFilter) => value === "all" ? tx("全部语言", "All languages")
    : value === "general" ? tx("通用 / 未标注", "General / unspecified") : languageInfo[value].name;
  const hasLanguages = solutions?.some(solution => solution.programmingLanguage);
  const missingLanguage = hasLanguages && language !== "all" && language !== "general"
    && !solutions?.some(solution => solution.programmingLanguage === language);

  if (!solutions?.length) return <SolutionContent body={body} {...options} />;

  return <div className="min-w-0 space-y-4">
    {hasLanguages && <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      <span>{tx("题解语言", "Solution language")}</span>
      <select className="min-h-9 max-w-full rounded-md border border-border bg-surface px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={tx("题解语言", "Solution language")} value={language}
        onChange={event => { setLanguage(event.target.value as SolutionLanguageFilter); setSelectedId(undefined); }}>
        {(["all", ...supportedLanguages.filter(value => value === preferredLanguage || solutions.some(solution => solution.programmingLanguage === value)),
          ...(solutions.some(solution => !solution.programmingLanguage) ? ["general"] : [])] as SolutionLanguageFilter[])
          .map(value => <option key={value} value={value}>{languageName(value)}</option>)}
      </select>
    </label>}
    {missingLanguage && <p role="status" className="text-sm text-muted-foreground">{tx(
      `暂未发布 ${languageName(language)} 题解。${visible.length ? "下方提供通用或未标注语言的解法，也可切换查看其他语言。" : "可切换查看其他已发布语言。"}`,
      `No ${languageName(language)} solution is published yet. ${visible.length ? "General or unspecified approaches are shown below. You can also select another language." : "Select another published language to read its solutions."}`,
    )}</p>}
    {visible.length > 1 && <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold">{locale === "en" ? "Solution approaches" : "解法列表"}</legend>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {visible.map(solution => <label key={solution.id}
          className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-subtle has-checked:bg-primary/5 has-checked:font-semibold">
          <input type="radio" name={group} checked={selected?.id === solution.id}
            onChange={() => setSelectedId(solution.id)}
            className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{solution.title}</span>
          {hasLanguages && <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{languageName(solution.programmingLanguage ?? "general")}</span>}
        </label>)}
      </div>
    </fieldset>}
    {selected && <article aria-labelledby={`${group}-title`}>
      <h2 id={`${group}-title`} className="mb-3 text-base font-semibold [overflow-wrap:anywhere]">{selected.title}
        {hasLanguages && <span className="ml-2 text-xs font-normal text-muted-foreground">{languageName(selected.programmingLanguage ?? "general")}</span>}
      </h2>
      <SolutionContent body={selected.body} {...options} />
    </article>}
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
      {language && <span className="mr-auto text-xs font-semibold">{language === "python" || language === "py" ? "Python 3" : language === "cpp" || language === "c++" ? "C++" : language === "javascript" || language === "js" ? "JavaScript" : language}</span>}
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
      <CodeBlock code={code} language={language === "cpp" || language === "c++" ? "cpp" : language === "javascript" || language === "js" ? "javascript" : "python"}/>
    </div>
  </section>}/>;
}
