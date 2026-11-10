"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { useLocale } from "@/components/locale-context";
import { Loading } from "@/components/admin/common";
import {
  ProblemWorkspace,
  type ProblemWorkspaceAdapter,
} from "@/components/student/workspace";
import { draftKey, readDraft, saveDraft } from "@/components/student/drafts";
import { useData, type DetailedSubmission } from "@/components/student/shared";
import type { ResultCase } from "@/components/student/result-feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  apiMessage,
  clearProductionSession,
  productionApi,
  type CampusUser,
  type ProductionProblem,
} from "@/lib/production-api";
import { acslHref, type AcslLanguage, type AcslPaper } from "./model";
import { AcslRichContent } from "./rich-content";
import type { AcslDiagram } from "./diagram-model";

type AcslProgrammingProblem = ProductionProblem & {
  paperVersionId: string;
  statementDiagrams?: AcslDiagram[];
};

export function AcslProgramming({
  schoolId,
  paper,
  user,
  baseHref,
  language,
  returnQuestionId,
  onStageCompleted,
  onShowResults,
  stageDialog,
}: {
  schoolId: string;
  paper: AcslPaper;
  user: CampusUser;
  baseHref: string;
  language: AcslLanguage;
  returnQuestionId?: string;
  onStageCompleted: (paper: AcslPaper) => void;
  onShowResults: () => void;
  stageDialog: ReactNode;
}) {
  const path = `schools/${schoolId}/acsl/${encodeURIComponent(paper.id)}/programming`;
  const problem = useData<AcslProgrammingProblem>(
    `${path}?${new URLSearchParams({ language, paperVersionId: paper.versionId })}`,
  );
  return (
    <Loading resource={problem}>
      {problem.data && (
        <ProgrammingWorkspace
          key={`${schoolId}:${paper.versionId}:${problem.data.versionId}`}
          user={user}
          problem={problem.data}
          paper={paper}
          path={path}
          baseHref={baseHref}
          language={language}
          returnQuestionId={returnQuestionId}
          onStageCompleted={onStageCompleted}
          onShowResults={onShowResults}
          stageDialog={stageDialog}
        />
      )}
    </Loading>
  );
}

function ProgrammingWorkspace({
  user,
  problem,
  paper,
  path,
  baseHref,
  language,
  returnQuestionId,
  onStageCompleted,
  onShowResults,
  stageDialog,
}: {
  user: CampusUser;
  problem: AcslProgrammingProblem;
  paper: AcslPaper;
  path: string;
  baseHref: string;
  language: AcslLanguage;
  returnQuestionId?: string;
  onStageCompleted: (paper: AcslPaper) => void;
  onShowResults: () => void;
  stageDialog: ReactNode;
}) {
  const { locale } = useLocale();
  const router = useRouter();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const progressBusy = useRef(false);
  const notified = useRef(paper.programmingSolved);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refreshCompletedPaper = useCallback(async () => {
    if (progressBusy.current || notified.current) return;
    progressBusy.current = true;
    setRefreshing(true);
    setProgressError("");
    try {
      const updated = await productionApi<AcslPaper>(
        path.replace(/\/programming$/, ""),
      );
      if (!mounted.current) return;
      if (!updated.programmingSolved)
        throw new Error(
          locale === "en"
            ? "The result is still updating. Retry to refresh your paper."
            : "判题结果仍在更新，请重试刷新试卷进度。",
        );
      notified.current = true;
      onStageCompleted(updated);
    } catch (reason) {
      if (mounted.current) setProgressError(apiMessage(reason));
    } finally {
      progressBusy.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [path, locale, onStageCompleted]);
  const onSubmissionCompleted = useCallback(
    (result: DetailedSubmission) => {
      if (result.kind === "submit" && result.status === "AC")
        void refreshCompletedPaper();
    },
    [refreshCompletedPaper],
  );
  const adapter = useMemo<ProblemWorkspaceAdapter>(() => {
    const context = `acsl:${path}:${paper.versionId}`;
    const query = new URLSearchParams({
      versionId: problem.versionId!,
      paperVersionId: paper.versionId,
    });
    return {
      context,
      returnTo: acslHref(baseHref, paper.id, returnQuestionId, false, language),
      returnLabel: locale === "en" ? "Back to ACSL paper" : "返回 ACSL 试卷",
      homeHref: baseHref,
      navigation: {
        items: [
          {
            problemId: problem.id,
            versionId: problem.versionId,
            title: problem.title,
          },
        ],
        loading: false,
        error: "",
        reload: () => undefined,
        href: () =>
          acslHref(baseHref, paper.id, returnQuestionId, true, language),
        title: paper.title[language],
      },
      submissionsPath: `${path}/submissions?${query}`,
      resumeSubmission: true,
      submissionsTitle: locale === "en" ? "My submissions" : "我的提交",
      renderStatement: () => (
        <AcslRichContent
          content={problem.statement}
          diagrams={problem.statementDiagrams}
          language={language}
        />
      ),
      submit: ({
        kind,
        code,
        language: codeLanguage,
        customInput,
        requestId,
      }) =>
        productionApi(`${path}/submissions`, {
          method: "POST",
          body: {
            kind,
            code,
            language: codeLanguage,
            input: customInput,
            requestId,
            versionId: problem.versionId,
            paperVersionId: paper.versionId,
          },
        }),
      submissionPath: (id) =>
        `${path}/submissions/${encodeURIComponent(id)}?${query}`,
      normalizeSubmission: (result: DetailedSubmission) => ({
        ...result,
        testResults:
          (result as DetailedSubmission & { caseFeedback?: ResultCase[] })
            .caseFeedback ?? [],
      }),
      onSubmissionCompleted,
      statusBanner: (
        <>
          {(paper.graded || paper.programmingSolved || progressError) && (
            <div
              className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2"
              data-od-id="acsl-programming-stage"
            >
              {progressError ? (
                <p role="alert" className="text-sm text-destructive">
                  {progressError}
                </p>
              ) : (
                <p className="text-sm">
                  {paper.programmingSolved
                    ? locale === "en"
                      ? "Programming passed"
                      : "编程题已通过"
                    : locale === "en"
                      ? "Written section submitted"
                      : "笔试已交卷"}
                </p>
              )}
              {progressError ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={refreshing}
                  onClick={() => void refreshCompletedPaper()}
                >
                  {locale === "en" ? "Refresh paper progress" : "刷新试卷进度"}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onShowResults}
                  data-od-id="acsl-show-results"
                >
                  {locale === "en" ? "View results" : "查看阶段成绩"}
                </Button>
              )}
            </div>
          )}
          {stageDialog}
        </>
      ),
      readDraft: (codeLanguage) =>
        readDraft(
          draftKey(
            user.id,
            problem.id,
            problem.versionId!,
            context,
            codeLanguage,
          ),
        ),
      saveDraft: (codeLanguage, draft) =>
        saveDraft(
          draftKey(
            user.id,
            problem.id,
            problem.versionId!,
            context,
            codeLanguage,
          ),
          draft,
        ),
      account: () => (
        <AccountMenu
          user={user}
          busy={loggingOut}
          onLogout={() => setLogoutOpen(true)}
        />
      ),
    };
  }, [
    user,
    problem,
    paper,
    path,
    baseHref,
    language,
    returnQuestionId,
    locale,
    loggingOut,
    onSubmissionCompleted,
    progressError,
    refreshing,
    refreshCompletedPaper,
    onShowResults,
    stageDialog,
  ]);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      try {
        await productionApi("auth/logout", { method: "POST" });
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      clearProductionSession();
      router.replace("/login");
    } catch (error) {
      setLogoutError(apiMessage(error));
      setLoggingOut(false);
    }
  }
  return (
    <>
      <ProblemWorkspace problem={problem} user={user} adapter={adapter} />
      <Dialog
        open={logoutOpen}
        onOpenChange={(open) => {
          if (!loggingOut) setLogoutOpen(open);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {locale === "en" ? "Sign out?" : "退出登录？"}
          </DialogTitle>
          <DialogDescription>
            {locale === "en"
              ? "Your code draft stays in this browser session. Signing out does not submit it."
              : "代码草稿保留在当前浏览器会话中，退出登录不会自动提交。"}
          </DialogDescription>
          {logoutError && (
            <p role="alert" className="text-sm text-destructive">
              {logoutError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              autoFocus
              variant="secondary"
              disabled={loggingOut}
              onClick={() => setLogoutOpen(false)}
            >
              {locale === "en" ? "Cancel" : "取消"}
            </Button>
            <Button disabled={loggingOut} onClick={() => void logout()}>
              {locale === "en" ? "Sign out" : "退出登录"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
