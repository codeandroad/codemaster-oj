"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Pencil } from "lucide-react";
import { Loading, useData } from "@/components/admin/common";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import type { CampusUser } from "@/lib/production-api";
import { AcslCatalogFilters, useAcslCatalogState } from "./catalog-filters";
import { acslCatalogHref, acslRoundLabel, type AcslLanguage } from "./model";
import { AcslTeacherEditor } from "./teacher-editor";
import {
  AcslTeacherExportDialog,
  AcslTeacherPrintPage,
} from "./teacher-export";
import {
  acslTeacherHref,
  type AcslTeacherPaper,
  type AcslTeacherSummary,
} from "./teacher-model";
import {
  AcslTeacherProgrammingPreview,
  AcslTeacherQuestionPreview,
} from "./teacher-preview";

export function AcslTeacherPage({
  schoolId,
  user,
  baseHref,
}: {
  schoolId: string;
  user: CampusUser;
  baseHref: string;
}) {
  const params = useSearchParams();
  const language: AcslLanguage =
    params.get("contentLanguage") === "zh" ? "zh" : "en";
  const paperId = params.get("paperId");
  const kind = params.get("export");
  const catalogHref = acslTeacherHref(acslCatalogHref(baseHref, params));
  // Print views mount only the safe export loader, never the teacher answer loader.
  if (paperId && (kind === "questions" || kind === "answers"))
    return (
      <AcslTeacherPrintPage
        key={`${schoolId}:${paperId}:${kind}:${language}`}
        schoolId={schoolId}
        paperId={paperId}
        baseHref={catalogHref}
        kind={kind}
        language={language}
      />
    );
  if (paperId)
    return (
      <TeacherPaperLoader
        key={`${schoolId}:${paperId}`}
        schoolId={schoolId}
        paperId={paperId}
        baseHref={catalogHref}
        language={language}
        editing={params.get("edit") === "1"}
      />
    );
  return (
    <TeacherCatalogLoader
      key={schoolId}
      schoolId={schoolId}
      accountId={user.id}
      baseHref={catalogHref}
      language={language}
    />
  );
}

function TeacherCatalogLoader(props: {
  schoolId: string;
  accountId: string;
  baseHref: string;
  language: AcslLanguage;
}) {
  const resource = useData<{ items: AcslTeacherSummary[] }>(
    `schools/${props.schoolId}/acsl/manage`,
  );
  return (
    <Loading resource={resource}>
      {resource.data && (
        <TeacherCatalog {...props} papers={resource.data.items} />
      )}
    </Loading>
  );
}

function TeacherCatalog({
  schoolId,
  accountId,
  baseHref,
  language,
  papers,
}: {
  schoolId: string;
  accountId: string;
  baseHref: string;
  language: AcslLanguage;
  papers: AcslTeacherSummary[];
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const {
    filters,
    seasons,
    items,
    matchingSeasons,
    visibleSeasons,
    visibleCount,
    catalogHref,
    changeFilters,
  } = useAcslCatalogState({ items: papers, schoolId, accountId, baseHref });
  const [exportPaper, setExportPaper] = useState<AcslTeacherSummary | null>(
    null,
  );
  return (
    <div className="space-y-4" data-od-id="acsl-teacher-catalog">
      <AcslCatalogFilters
        filters={filters}
        seasons={seasons}
        onChange={changeFilters}
      />
      <p className="text-sm text-muted-foreground">
        {tx(
          "Browse questions and answers, publish revisions, or export teaching materials.",
          "查看题目与解析、发布内容修订，或导出教学资料。",
        )}
      </p>
      <p role="status" className="text-xs text-muted-foreground">
        {tx(
          `${items.length} papers · ${matchingSeasons.length} seasons`,
          `${items.length} 份试卷 · ${matchingSeasons.length} 个学年`,
        )}
        {visibleCount < items.length &&
          tx(` · ${visibleCount} shown`, ` · 已显示 ${visibleCount} 份`)}
      </p>
      {visibleSeasons.map((season) => (
        <section key={season} aria-labelledby={`acsl-teacher-season-${season}`}>
          <h2
            id={`acsl-teacher-season-${season}`}
            className="mb-2 font-semibold"
          >
            {season}
          </h2>
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {items
              .filter((item) => item.season === season)
              .map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                  data-od-id="acsl-teacher-paper-row"
                  data-paper-id={item.id}
                >
                  <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                    <h3 className="font-semibold">{item.title[locale]}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.division} · {acslRoundLabel(item, locale)} ·{" "}
                      {tx(
                        `${item.questionCount} written questions`,
                        `${item.questionCount} 道笔试题`,
                      )}{" "}
                      ·{" "}
                      {item.hasProgramming
                        ? tx("With programming", "含编程题")
                        : tx("Written only", "仅笔试")}
                    </p>
                    {!item.enabled && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tx("Not available to students", "暂未向学生开放")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AppLink
                      href={acslTeacherHref(
                        catalogHref,
                        item.id,
                        false,
                        language,
                      )}
                      className={buttonVariants({
                        variant: "secondary",
                        size: "sm",
                      })}
                      data-od-id="acsl-teacher-view"
                    >
                      {tx("View", "查看")}
                    </AppLink>
                    {item.canEdit && (
                      <AppLink
                        href={acslTeacherHref(
                          catalogHref,
                          item.id,
                          true,
                          language,
                        )}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                        data-od-id="acsl-teacher-edit"
                      >
                        <Pencil size={14} aria-hidden="true" />
                        {tx("Edit", "编辑")}
                      </AppLink>
                    )}
                    {item.canExport && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExportPaper(item)}
                        data-od-id="acsl-teacher-export"
                      >
                        <Download size={14} aria-hidden="true" />
                        {tx("Export", "导出")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
      {!items.length && (
        <p className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
          {papers.length
            ? tx(
                "No papers match these filters. Reset the filters to see all papers.",
                "没有符合筛选条件的试卷，可重置筛选查看全部试卷。",
              )
            : tx(
                "No ACSL papers are available in this school.",
                "本校暂无 ACSL 试卷。",
              )}
        </p>
      )}
      {visibleSeasons.length < matchingSeasons.length && (
        <Button
          variant="secondary"
          onClick={() =>
            changeFilters({ seasonsShown: String(filters.seasonsShown + 1) })
          }
        >
          {tx("Show earlier season", "显示更早学年")}
        </Button>
      )}
      {exportPaper && (
        <AcslTeacherExportDialog
          schoolId={schoolId}
          paperId={exportPaper.id}
          title={exportPaper.title[locale]}
          baseHref={catalogHref}
          language={language}
          onClose={() => setExportPaper(null)}
        />
      )}
    </div>
  );
}

function TeacherPaperLoader(props: {
  schoolId: string;
  paperId: string;
  baseHref: string;
  language: AcslLanguage;
  editing: boolean;
}) {
  const resource = useData<AcslTeacherPaper>(
    `schools/${props.schoolId}/acsl/manage/${encodeURIComponent(props.paperId)}`,
  );
  return (
    <Loading resource={resource}>
      {resource.data && (
        <TeacherPaper
          key={resource.data.contentHash}
          {...props}
          initialPaper={resource.data}
        />
      )}
    </Loading>
  );
}

function TeacherPaper({
  schoolId,
  baseHref,
  language,
  editing,
  initialPaper,
}: {
  schoolId: string;
  baseHref: string;
  language: AcslLanguage;
  editing: boolean;
  initialPaper: AcslTeacherPaper;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [paper, setPaper] = useState(initialPaper);
  const [selected, setSelected] = useState(
    initialPaper.questions[0]?.id ?? "programming",
  );
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  const question = paper.questions.find((item) => item.id === selected);
  const closeEditor = () =>
    window.history.replaceState(
      null,
      "",
      acslTeacherHref(baseHref, paper.id, false, language),
    );
  if (editing && paper.canEdit)
    return (
      <AcslTeacherEditor
        key={paper.contentHash}
        schoolId={schoolId}
        initialPaper={paper}
        initialLanguage={language}
        onCancel={closeEditor}
        onSaved={(updated) => {
          setPaper(updated);
          setSaved(true);
          closeEditor();
        }}
      />
    );
  return (
    <div className="space-y-4" data-od-id="acsl-teacher-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AppLink
          href={acslTeacherHref(baseHref)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {tx("All papers", "全部试卷")}
        </AppLink>
        <div className="flex flex-wrap gap-2">
          {paper.canEdit && (
            <AppLink
              href={acslTeacherHref(baseHref, paper.id, true, language)}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
              data-od-id="acsl-teacher-edit"
            >
              <Pencil size={14} aria-hidden="true" />
              {tx("Edit paper", "编辑试卷")}
            </AppLink>
          )}
          {paper.canExport && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExporting(true)}
              data-od-id="acsl-teacher-export"
            >
              <Download size={14} aria-hidden="true" />
              {tx("Export", "导出")}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{paper.title[language]}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {paper.division} · {paper.season} · {acslRoundLabel(paper, locale)}{" "}
            ·{" "}
            {tx(
              `${paper.questionCount} written questions`,
              `${paper.questionCount} 道笔试题`,
            )}
          </p>
        </div>
        <div
          className="flex gap-1"
          aria-label={tx("Content language", "内容语言")}
        >
          {(["en", "zh"] as const).map((value) => (
            <AppLink
              key={value}
              href={acslTeacherHref(baseHref, paper.id, false, value)}
              aria-current={language === value ? "true" : undefined}
              className={buttonVariants({
                variant: language === value ? "secondary" : "ghost",
                size: "sm",
              })}
            >
              {value === "en" ? "English" : "中文"}
            </AppLink>
          ))}
        </div>
      </div>
      {saved && (
        <p
          role="status"
          className="text-sm text-success"
          data-od-id="acsl-teacher-saved"
        >
          {tx(
            "Revision published. Submitted papers, grades and points are preserved.",
            "修订已发布，既有答卷、成绩与积分保持不变。",
          )}
        </p>
      )}
      <div className="grid items-start gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label={tx("Paper sections", "试卷题目")}
          className="flex flex-wrap gap-2 md:flex-col"
        >
          {paper.questions.map((item) => (
            <Button
              key={item.id}
              variant={selected === item.id ? "secondary" : "ghost"}
              className="justify-start whitespace-nowrap"
              aria-current={selected === item.id ? "true" : undefined}
              onClick={() => setSelected(item.id)}
              data-od-id={`acsl-teacher-question-${item.id}`}
            >
              {tx(`Question ${item.number}`, `第 ${item.number} 题`)}
            </Button>
          ))}
          {paper.programming && (
            <Button
              variant={selected === "programming" ? "secondary" : "ghost"}
              className="justify-start"
              aria-current={selected === "programming" ? "true" : undefined}
              onClick={() => setSelected("programming")}
              data-od-id="acsl-teacher-programming-tab"
            >
              {tx("Programming", "编程题")}
            </Button>
          )}
        </nav>
        <div className="min-w-0">
          {question && (
            <AcslTeacherQuestionPreview
              question={question}
              language={language}
            />
          )}{" "}
          {selected === "programming" && paper.programming && (
            <AcslTeacherProgrammingPreview
              programming={paper.programming}
              language={language}
            />
          )}
        </div>
      </div>
      {exporting && (
        <AcslTeacherExportDialog
          schoolId={schoolId}
          paperId={paper.id}
          title={paper.title[language]}
          baseHref={baseHref}
          language={language}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}
