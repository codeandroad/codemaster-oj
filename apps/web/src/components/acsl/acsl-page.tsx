"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Code2, XCircle } from "lucide-react";
import { AppLink, useNavigationBlocker } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { Loading } from "@/components/admin/common";
import { useData } from "@/components/student/shared";
import { useWorkspaceData } from "@/components/workspace-data";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ApiError,
  apiMessage,
  productionApi,
  type CampusUser,
} from "@/lib/production-api";
import type { School } from "@/components/schools/school-ui";
import { preserveAcslLearningContext } from "@/components/course-acsl-navigation";
import { AcslLearningLinks } from "./learning-links";
import { AcslQuestionView } from "./question-view";
import { AcslProgramming } from "./programming";
import { AcslCatalogView } from "./catalog-view";
import { AcslStageResultDialog } from "./stage-components";
import { AcslReviewPanel } from "./review-panel";
import {
  acslReviewHref,
  acslStageSummary,
  type AcslReviewMode,
} from "./stage-model";
import { useWrittenReadyNotice } from "./use-written-ready";
import { AcslWrittenTimer } from "./written-timer";
import {
  acslCatalogHref,
  acslHref,
  type AcslCatalog,
  type AcslLanguage,
  type AcslPaper,
} from "./model";

export { useAcslEnabled } from "./use-acsl-enabled";

export function LegacyAcslPage({ user }: { user: CampusUser }) {
  const schools = useWorkspaceData<{ items: School[] }>("schools");
  const school = schools.data?.items.find((item) => item.legacy);
  return (
    <Loading resource={schools}>
      {school && (
        <AcslPage
          key={school.id}
          schoolId={school.id}
          user={user}
          baseHref="/student/acsl"
          legacySchool={school.legacy}
        />
      )}
    </Loading>
  );
}

export function AcslPage({
  schoolId,
  user,
  baseHref,
  legacySchool = false,
}: {
  schoolId: string;
  user: CampusUser;
  baseHref: string;
  legacySchool?: boolean;
}) {
  const params = useSearchParams();
  const { locale } = useLocale();
  const language: AcslLanguage =
    params.get("contentLanguage") === "zh" ? "zh" : "en";
  const paperId = params.get("paperId");
  const catalogHref = preserveAcslLearningContext(acslCatalogHref(baseHref, params), params, schoolId) ?? acslCatalogHref(baseHref, params);
  const catalog = useWorkspaceData<AcslCatalog>(
    paperId ? "" : `schools/${schoolId}/acsl`,
  );
  if (paperId)
    return (
      <PaperLoader
        key={`${schoolId}:${paperId}`}
        schoolId={schoolId}
        paperId={paperId}
        user={user}
        baseHref={catalogHref}
        language={language}
        legacySchool={legacySchool}
      />
    );
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  return (
    <Loading resource={catalog}>
      {catalog.data?.enabled ? (
        <AcslCatalogView
          catalog={catalog.data}
          baseHref={catalogHref}
          accountId={user.id}
          schoolId={schoolId}
        />
      ) : (
        <p className="py-8 text-sm text-muted-foreground">
          {tx(
            "ACSL practice is not available in this school.",
            "本校暂未开放 ACSL 练习。",
          )}
        </p>
      )}
    </Loading>
  );
}

function PaperLoader({
  schoolId,
  paperId,
  user,
  baseHref,
  language,
  legacySchool,
}: {
  schoolId: string;
  paperId: string;
  user: CampusUser;
  baseHref: string;
  language: AcslLanguage;
  legacySchool: boolean;
}) {
  const params = useSearchParams(), { locale } = useLocale();
  const requestedVersion = params.get("paperVersionId");
  const paper = useData<AcslPaper>(
    `schools/${schoolId}/acsl/${encodeURIComponent(paperId)}${requestedVersion ? `?${new URLSearchParams({ paperVersionId: requestedVersion })}` : ""}`,
  );
  if (paper.data && requestedVersion && requestedVersion !== paper.data.versionId) return <div className="space-y-3" role="alert"><p className="text-sm text-muted-foreground">{locale === "en" ? "This linked edition is no longer available. Return to the course and ask your teacher to update its practice link." : "关联的试卷版本已不可用，请返回课程并请老师更新练习关联。"}</p><AppLink href={baseHref} className="text-sm text-primary hover:underline">{locale === "en" ? "ACSL papers" : "ACSL 试卷"}</AppLink></div>;
  const [paperPathname, paperQuery = ""] = baseHref.split("?");
  const paperParams = new URLSearchParams(paperQuery);
  if (requestedVersion) paperParams.set("paperVersionId", requestedVersion);
  const paperBaseHref = `${paperPathname}${paperParams.size ? `?${paperParams}` : ""}`;
  return (
    <Loading resource={paper}>
      {paper.data && (
        <PaperView
          schoolId={schoolId}
          initialPaper={paper.data}
          user={user}
          baseHref={paperBaseHref}
          language={language}
          legacySchool={legacySchool}
        />
      )}
    </Loading>
  );
}

function PaperView({
  schoolId,
  initialPaper,
  user,
  baseHref,
  language,
  legacySchool,
}: {
  schoolId: string;
  initialPaper: AcslPaper;
  user: CampusUser;
  baseHref: string;
  language: AcslLanguage;
  legacySchool: boolean;
}) {
  const [paper, setPaper] = useState(initialPaper);
  const [questionRevision, setQuestionRevision] = useState(0);
  const [editingBlocked, setEditingBlocked] = useState(false);
  const editingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [savedAnswers, setSavedAnswers] = useState(0);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(true);
  const resultRef = useRef<HTMLDivElement>(null);
  const params = useSearchParams();
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onEditingChange = useCallback((blocked: boolean) => {
    editingRef.current = blocked;
    setEditingBlocked(blocked);
  }, []);
  useNavigationBlocker(pending);
  useEffect(() => {
    if (!pending) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [pending]);
  const question =
    paper.questions.find((item) => item.id === params.get("questionId")) ??
    paper.questions[0];
  const codingHref = acslHref(baseHref, paper.id, question?.id, true, language);
  useEffect(() => {
    if (params.get("coding") === "1" && !paper.programming) {
      window.history.replaceState(
        null,
        "",
        acslHref(baseHref, paper.id, question?.id, false, language),
      );
    }
  }, [baseHref, language, paper.id, paper.programming, params, question?.id]);
  const answeredCount = paper.questions.filter(
    (item) => item.draft.selectedOptionIds.length > 0,
  ).length;
  const reviewQuestions = paper.graded
    ? []
    : paper.questions.filter((item) => item.requiresReview);
  const paperPath = `schools/${schoolId}/acsl/${encodeURIComponent(paper.id)}`;
  const canSubmit =
    !paper.graded &&
    answeredCount === paper.questions.length &&
    reviewQuestions.length === 0 &&
    !editingBlocked &&
    !pending &&
    !conflict;
  const openReadyNotice = useCallback(() => {
    setAutoPrompt(true);
    setConfirmOpen(true);
  }, []);
  const acknowledgeWrittenReady = useWrittenReadyNotice({
    key: `acsl-ready:${user.id}:${schoolId}:${paper.id}:${paper.writtenRevision}`,
    ready:
      canSubmit && !confirmOpen && !resultOpen && params.get("coding") !== "1",
    saved: savedAnswers,
    onReady: openReadyNotice,
  });
  const reviewing = paper.graded && params.get("review") === "1";
  function navigate(href: string) {
    if (
      !window.dispatchEvent(
        new Event("campus-judge:before-navigate", { cancelable: true }),
      ) &&
      !window.confirm(
        tx(
          "This page has unsaved changes. Leave anyway?",
          "当前页面有未保存的修改，确认离开？",
        ),
      )
    )
      return false;
    window.history.pushState(null, "", href);
    return true;
  }
  function openReview(mode: AcslReviewMode) {
    return navigate(acslReviewHref(baseHref, paper.id, mode, language));
  }
  function selectReviewQuestion(id: string, explanation: boolean) {
    const href = acslHref(baseHref, paper.id, id, false, language);
    navigate(`${href}${explanation ? "&explanation=1" : ""}`);
  }
  function acceptPaper(updated: AcslPaper) {
    setPaper(updated);
    setQuestionRevision((revision) => revision + 1);
    onEditingChange(false);
    setConflict(false);
    setError("");
    setConfirmOpen(false);
  }
  async function reloadPaper() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const updated = await productionApi<AcslPaper>(paperPath);
      if (!mounted.current) return;
      if (updated.versionId !== paper.versionId)
        throw new Error(
          tx(
            "This paper has changed. Return to the list and open its current version.",
            "试卷版本已变更，请返回列表重新打开。",
          ),
        );
      acceptPaper(updated);
    } catch (reason) {
      if (mounted.current) setError(apiMessage(reason));
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function submitPaper() {
    if (pendingRef.current || editingRef.current || !canSubmit) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const updated = await productionApi<AcslPaper>(`${paperPath}/submit`, {
        method: "POST",
        body: {
          versionId: paper.versionId,
          writtenRevision: paper.writtenRevision,
          revisions: Object.fromEntries(
            paper.questions.map((item) => [item.id, item.draft.revision]),
          ),
        },
      });
      if (mounted.current) {
        acceptPaper(updated);
        setResultOpen(true);
      }
    } catch (reason) {
      if (mounted.current) {
        setError(apiMessage(reason));
        setConflict(reason instanceof ApiError && reason.status === 409);
      }
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const errorFeedback = error && (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
    >
      <p>{error}</p>
      {conflict && (
        <>
          <p className="mt-2">
            {tx(
              "The paper or its answers have changed. Load the saved paper and review it before submitting.",
              "题目或答案已更新，请加载已保存试卷并核对后再交卷。",
            )}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={pending}
            onClick={() => void reloadPaper()}
          >
            {tx("Load saved paper", "加载已保存试卷")}
          </Button>
        </>
      )}
    </div>
  );
  const stageDialog = (
    <AcslStageResultDialog
      paper={paper}
      open={resultOpen}
      onOpenChange={setResultOpen}
      onReview={(mode) => {
        if (!openReview(mode)) setResultOpen(true);
      }}
      onProgramming={() => {
        if (!navigate(codingHref)) setResultOpen(true);
      }}
      onWritten={() => {
        if (!navigate(acslHref(baseHref, paper.id, question?.id, false, language)))
          setResultOpen(true);
      }}
      onClose={() =>
        requestAnimationFrame(() => {
          if (params.get("coding") === "1") {
            document
              .querySelector<HTMLButtonElement>(
                '[data-od-id="acsl-programming-stage"] [data-od-id="acsl-show-results"]',
              )
              ?.focus();
          } else resultRef.current?.focus();
        })
      }
    />
  );
  if (params.get("coding") === "1" && paper.programming)
    return (
      <>
        <AcslProgramming
          legacySchool={legacySchool}
          schoolId={schoolId}
          paper={paper}
          user={user}
          baseHref={baseHref}
          language={language}
          returnQuestionId={question?.id}
          onStageCompleted={(updated) => {
            setPaper(updated);
            setResultOpen(true);
          }}
          onShowResults={() => setResultOpen(true)}
          stageDialog={stageDialog}
        />
      </>
    );
  return (
    <div className="space-y-4" data-od-id="acsl-paper">
      <AcslLearningLinks links={paper.learningLinks ?? []} schoolId={schoolId} language={language} questionIds={reviewing ? paper.questions.filter(item => params.get("reviewMode") !== "wrong" || item.lastSubmission?.correct === false).map(item => item.id) : question ? [question.id] : []}/>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <AppLink
            href={acslCatalogHref(baseHref, params)}
            className="text-xs text-primary hover:underline"
          >
            {tx("Back to ACSL papers", "返回 ACSL 试卷")}
          </AppLink>
          <h2 className="mt-2 text-lg font-semibold">
            {paper.title[language]}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span>{tx("Problem language", "题面语言")}</span>
          {(["en", "zh"] as const).map((value) => (
            <AppLink
              key={value}
              href={
                reviewing
                  ? acslReviewHref(
                      baseHref,
                      paper.id,
                      params.get("reviewMode") === "wrong" ? "wrong" : "all",
                      value,
                    )
                  : acslHref(baseHref, paper.id, question?.id, false, value)
              }
              aria-current={language === value ? "true" : undefined}
              className={buttonVariants({
                variant: language === value ? "primary" : "secondary",
                size: "sm",
              })}
            >
              {value === "en" ? "English" : "中文"}
            </AppLink>
          ))}
        </div>
      </div>
      <AcslWrittenTimer
        key={`${user.id}:${schoolId}:${paper.id}:${paper.versionId}`}
        accountId={user.id}
        schoolId={schoolId}
        paperId={paper.id}
        versionId={paper.versionId}
        graded={paper.graded}
        gradedAt={paper.gradedAt}
      />
      <section
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
        aria-label={tx("Written section", "笔试部分")}
      >
        {paper.graded ? (
          <div
            ref={resultRef}
            tabIndex={-1}
            role="status"
            data-od-id="acsl-written-result"
          >
            <h3 className="font-semibold">
              {acslStageSummary(paper).complete
                ? tx("Paper completed", "整卷已完成")
                : tx("Written section submitted", "笔试已交卷")}
            </h3>
            <p className="mt-1 text-sm">
              {tx("Written score", "笔试成绩")} {paper.score}/{paper.maxScore}
            </p>
            {typeof paper.writtenPointsAwarded === "number" &&
              Number.isFinite(paper.writtenPointsAwarded) &&
              paper.writtenPointsAwarded > 0 && (
                <p
                  className="mt-1 text-sm font-medium text-success"
                  data-od-id="acsl-written-points"
                >
                  {tx("Written points earned", "获得笔试积分")} +
                  {new Intl.NumberFormat(locale).format(
                    paper.writtenPointsAwarded,
                  )}
                </p>
              )}
            <p className="mt-1 text-xs text-muted-foreground">
              {tx(
                "Your submitted answers are saved. Open any question to review its result and explanation.",
                "已保存交卷答案，可选择各题查看判分结果并展开解析。",
              )}
            </p>
            {paper.historicalWrittenVersion && (
              <p
                className="mt-2 text-sm text-muted-foreground"
                data-od-id="acsl-historical-written-notice"
              >
                {tx(
                  "This is the paper as it was when you submitted it. Your score and earned points are unchanged.",
                  "此处保留你交卷时的题目版本，成绩和已获积分保持不变。",
                )}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                data-od-id="acsl-show-results"
                onClick={() => setResultOpen(true)}
              >
                {tx("View results", "查看阶段成绩")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                data-od-id="acsl-open-review"
                onClick={() => openReview("all")}
              >
                {tx("Results and review", "成绩与复盘")}
              </Button>
              {paper.programming && !paper.programmingSolved && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(codingHref)}
                >
                  {tx("Continue programming", "继续编程")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div data-od-id="acsl-written-progress">
              <h3 className="font-semibold">
                {tx("Answers saved", "已保存答案")} {answeredCount}/
                {paper.questions.length}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {tx(
                  "Finish every written question, then submit the section for grading.",
                  "完成全部笔试题后统一交卷判分。",
                )}
              </p>
              {paper.pointRules && (
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  data-od-id="acsl-point-rules"
                >
                  {tx(
                    `Points · Each correct written answer +${new Intl.NumberFormat(locale).format(paper.pointRules.writtenPerCorrect)}${paper.programming ? ` · First accepted programming submission +${new Intl.NumberFormat(locale).format(paper.pointRules.programming)}` : ""}`,
                    `积分 · 笔试每答对一题 +${new Intl.NumberFormat(locale).format(paper.pointRules.writtenPerCorrect)}${paper.programming ? ` · 编程首次正式提交通过 +${new Intl.NumberFormat(locale).format(paper.pointRules.programming)}` : ""}`,
                  )}
                </p>
              )}
            </div>
            <Button
              data-od-id="acsl-submit-paper"
              aria-describedby={
                reviewQuestions.length > 0 ? "acsl-review-summary" : undefined
              }
              disabled={!canSubmit}
              onClick={() => {
                if (!editingRef.current && !pendingRef.current) {
                  acknowledgeWrittenReady();
                  setAutoPrompt(false);
                  setConfirmOpen(true);
                }
              }}
            >
              {tx("Submit written section", "提交整份笔试")}
            </Button>
          </>
        )}
      </section>
      {reviewQuestions.length > 0 && (
        <section
          className="rounded-lg border border-border bg-surface-subtle p-4 text-sm"
          aria-labelledby="acsl-review-summary"
          data-od-id="acsl-review-summary"
        >
          <p id="acsl-review-summary" role="status">
            {tx(
              "Review the corrected questions and confirm your saved answers before submitting.",
              "以下题目已校订，请核对并确认已保存答案后再交卷。",
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {reviewQuestions.map((item) => (
              <AppLink
                key={item.id}
                href={acslHref(baseHref, paper.id, item.id, false, language)}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
                data-od-id="acsl-review-question-link"
              >
                {tx(`Question ${item.number}`, `第 ${item.number} 题`)}
              </AppLink>
            ))}
          </div>
        </section>
      )}
      {!confirmOpen && errorFeedback}
      {reviewing ? (
        <AcslReviewPanel
          paper={paper}
          language={language}
          baseHref={baseHref}
          initialMode={params.get("reviewMode") === "wrong" ? "wrong" : "all"}
          onSelect={selectReviewQuestion}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav
            aria-label={tx("Paper questions", "试卷题目")}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-3 lg:grid-cols-1"
          >
            <p className="col-span-full text-xs font-semibold text-muted-foreground">
              {tx("Short problems", "笔试题")}
            </p>
            {paper.questions.map((item) => (
              <AppLink
                key={item.id}
                href={acslHref(baseHref, paper.id, item.id, false, language)}
                aria-current={item.id === question?.id ? "step" : undefined}
                className={`flex min-h-10 min-w-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm ${item.id === question?.id ? "bg-accent font-semibold" : "hover:bg-muted"}`}
              >
                <span className="shrink-0">
                  {tx("Question", "第")} {item.number}
                  {locale === "zh" ? " 题" : ""}
                </span>
                {paper.graded && item.lastSubmission ? (
                  item.lastSubmission.correct ? (
                    <CheckCircle2
                      size={15}
                      className="text-success"
                      aria-label={tx("Correct", "正确")}
                    />
                  ) : (
                    <XCircle
                      size={15}
                      className="text-destructive"
                      aria-label={tx("Incorrect", "错误")}
                    />
                  )
                ) : item.requiresReview ? (
                  <span className="ms-auto min-w-0 truncate text-end text-xs text-muted-foreground">
                    {tx("Needs review", "待复核")}
                  </span>
                ) : item.draft.selectedOptionIds.length > 0 ? (
                  <span
                    className="ms-auto min-w-0 truncate text-end text-xs font-semibold text-success"
                    title={item.draft.selectedOptionIds.join(", ")}
                  >
                    <span className="sr-only">
                      {tx(" Saved answer ", " 已保存答案 ")}
                    </span>
                    {item.draft.selectedOptionIds.join(", ")}
                  </span>
                ) : null}
              </AppLink>
            ))}
            {paper.programming && (
              <AppLink
                href={codingHref}
                className="col-span-full flex min-h-10 items-center gap-2 rounded-md border-t border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <Code2 size={16} aria-hidden="true" />
                {tx("Programming", "编程题")}
                {paper.programming.solved && (
                  <CheckCircle2
                    size={15}
                    className="text-success"
                    aria-label={tx("Solved", "已通过")}
                  />
                )}
              </AppLink>
            )}
          </nav>
          {question && (
            <AcslQuestionView
              key={`${question.id}:${paper.writtenRevision}:${paper.graded}:${questionRevision}`}
              schoolId={schoolId}
              paperId={paper.id}
              versionId={paper.versionId}
              writtenRevision={paper.writtenRevision}
              question={question}
              language={language}
              graded={paper.graded}
              locked={pending || confirmOpen || resultOpen}
              autoExpandExplanation={params.get("explanation") === "1"}
              onEditingChange={onEditingChange}
              onReload={() => void reloadPaper()}
              onChanged={(updated) => {
                setPaper((current) => ({
                  ...current,
                  questions: current.questions.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                }));
                setSavedAnswers((count) => count + 1);
              }}
            />
          )}
        </div>
      )}
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!pending) setConfirmOpen(open);
        }}
      >
        <DialogContent
          data-od-id={
            autoPrompt
              ? "acsl-written-ready-dialog"
              : "acsl-written-confirm-dialog"
          }
          onCloseAutoFocus={(event) => {
            if (paper.graded) {
              event.preventDefault();
              if (!resultOpen) resultRef.current?.focus();
            }
          }}
        >
          <DialogTitle>
            {autoPrompt
              ? tx("All written answers are saved", "笔试答案已全部保存")
              : tx("Submit the written section?", "确认提交整份笔试？")}
          </DialogTitle>
          <DialogDescription>
            {tx(
              `All ${paper.questions.length} written answers will be graded together. After submission, these answers are locked and you can review the score and explanations.`,
              `将统一批改全部 ${paper.questions.length} 道笔试题。交卷后答案锁定，可查看成绩与解析。`,
            )}
          </DialogDescription>
          {paper.programming && (
            <p className="text-sm text-muted-foreground">
              {tx(
                "The programming problem is submitted separately in its workspace.",
                "编程题在答题工作区独立提交。",
              )}
            </p>
          )}
          {errorFeedback}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              autoFocus
              data-od-id="acsl-keep-reviewing"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
            >
              {tx("Keep reviewing", "继续检查")}
            </Button>
            <Button
              data-od-id="acsl-confirm-submit"
              disabled={!canSubmit}
              onClick={() => void submitPaper()}
            >
              {tx("Confirm submission", "确认交卷")}
            </Button>
          </div>
          {pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {tx("Submitting written section…", "正在提交整份笔试…")}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {stageDialog}
    </div>
  );
}
