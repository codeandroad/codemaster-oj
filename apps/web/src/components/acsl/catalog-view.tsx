"use client";

import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { AcslCatalogFilters, useAcslCatalogState } from "./catalog-filters";
import { AcslCatalogLearningCourses } from "./catalog-learning-courses";
import { acslHref, acslRoundLabel, type AcslCatalog } from "./model";
import { acslReviewHref, acslStageSummary } from "./stage-model";

export function AcslCatalogView({
  catalog,
  baseHref,
  accountId,
  schoolId,
}: {
  catalog: AcslCatalog;
  baseHref: string;
  accountId: string;
  schoolId: string;
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
    changeFilters,
    catalogHref,
  } = useAcslCatalogState({
    items: catalog.items,
    baseHref,
    accountId,
    schoolId,
  });
  const formatCount = (value: number) =>
    new Intl.NumberFormat(locale).format(value);

  return (
    <div className="space-y-4" data-od-id="acsl-catalog">
      <AcslCatalogLearningCourses courses={catalog.learningCourses ?? []} catalogHref={catalogHref} schoolId={schoolId}/>
      <AcslCatalogFilters
        filters={filters}
        seasons={seasons}
        onChange={changeFilters}
      />
      <p className="text-sm text-muted-foreground">
        {tx(
          "Save your answers as you go. Submit the complete written section to see your score and explanations.",
          "作答时自动保存答案，完成整份笔试后统一交卷，查看成绩与解析。",
        )}
      </p>
      <p
        role="status"
        className="text-xs text-muted-foreground"
        data-od-id="acsl-catalog-count"
      >
        {tx(
          `${formatCount(items.length)} papers · ${formatCount(matchingSeasons.length)} seasons`,
          `${formatCount(items.length)} 份试卷 · ${formatCount(matchingSeasons.length)} 个学年`,
        )}
        {visibleCount < items.length && (
          <>
            {" "}
            ·{" "}
            {tx(
              `${formatCount(visibleCount)} shown`,
              `已显示 ${formatCount(visibleCount)} 份`,
            )}
          </>
        )}
      </p>
      {visibleSeasons.map((season) => {
        const papers = items.filter((item) => item.season === season);
        const graded = papers.filter((item) => item.graded).length;
        return (
          <section
            key={season}
            aria-labelledby={`acsl-season-${season}`}
            data-od-id="acsl-season"
            data-season={season}
          >
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id={`acsl-season-${season}`} className="font-semibold">
                {season}
              </h2>
              <p className="text-xs text-muted-foreground">
                {tx(
                  `${formatCount(papers.length)} papers · Written sections submitted ${formatCount(graded)}/${formatCount(papers.length)}`,
                  `${formatCount(papers.length)} 份试卷 · 笔试已交卷 ${formatCount(graded)}/${formatCount(papers.length)}`,
                )}
              </p>
            </div>
            <div className="divide-y divide-border rounded-lg border border-border bg-surface">
              {papers.map((item) => (
                <div
                  key={item.id}
                  data-od-id="acsl-paper-row"
                  data-paper-id={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{item.title[locale]}</h3>
                      {acslStageSummary(item).complete && (
                        <span
                          className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success"
                          data-od-id="acsl-paper-complete"
                        >
                          {tx("Paper completed", "整卷已完成")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.division} · {acslRoundLabel(item, locale)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        {item.graded
                          ? tx("Written score", "笔试成绩")
                          : tx("Answers saved", "已保存答案")}{" "}
                        {item.graded
                          ? `${item.score}/${item.maxScore}`
                          : `${item.answeredCount}/${item.questionCount}`}
                      </span>
                      {item.hasProgramming !== false ? (
                        <span>
                          {tx("Programming", "编程题")}{" "}
                          <span
                            className={
                              item.programmingSolved
                                ? "text-success"
                                : "text-muted-foreground"
                            }
                          >
                            {item.programmingSolved
                              ? tx("Solved", "已通过")
                              : tx("Not solved", "未通过")}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {tx("Written only", "仅笔试")}
                        </span>
                      )}
                    </div>
                  </div>
                  <AppLink
                    href={
                      item.graded
                        ? acslReviewHref(baseHref, item.id)
                        : acslHref(baseHref, item.id)
                    }
                    className={buttonVariants({
                      variant: "secondary",
                      size: "sm",
                    })}
                  >
                    {item.graded
                      ? tx("Results and review", "成绩与复盘")
                      : item.answeredCount
                        ? tx("Continue", "继续练习")
                        : tx("Start practice", "开始练习")}
                  </AppLink>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {!items.length && (
        <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
          {catalog.items.length
            ? tx(
                "No papers match these filters. Reset the filters to see all available papers.",
                "没有符合筛选条件的试卷，可重置筛选查看全部试卷。",
              )
            : tx(
                "No ACSL papers are available yet.",
                "暂无可练习的 ACSL 试卷。",
              )}
        </div>
      )}
      {visibleSeasons.length < matchingSeasons.length && (
        <Button
          variant="secondary"
          data-od-id="acsl-more-seasons"
          onClick={() =>
            changeFilters({ seasonsShown: String(visibleSeasons.length + 1) })
          }
        >
          {tx("Show older seasons", "显示更早学年")}
        </Button>
      )}
    </div>
  );
}
