"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/teacher/shared";
import { LessonContent } from "@/components/student/shared";
import { SolutionBundle, type SolutionArticle } from "@/components/scholarship/solution-content";
import { ApiError, apiMessage, productionApi, productionId, type SubmissionLanguage } from "@/lib/production-api";

export type AssistanceKind = "FULL_TRANSLATION" | "FULL_SOLUTION";
export type SchoolAssistanceTarget = {
  type: "problem" | "paper4";
  versionId: string;
  problemId?: string;
  paperId?: string;
  questionKey?: string;
  attemptId?: string;
  activityId?: string;
};
export type AssistanceTarget =
  | {
      problemId: string;
      versionId: string;
      assignmentId?: string;
      timedAttemptId?: string;
    }
  | { paper4AttemptId: string; questionKey: string }
  | { paperVersionId: string; contentLanguage?: "en" | "zh" }
  | SchoolAssistanceTarget;
interface Quote {
  available: boolean;
  mode: "disabled" | "paid" | "free";
  unlocked: boolean;
  price: number;
  basePrice?: number;
  translationCredit?: number;
  balance: number;
  balanceAfter: number;
  contentId?: string;
  contentRevision?: number;
  requiresConfirmation: boolean;
  reason?: string;
  affectsFirstAcScholarship?: boolean;
}
interface Provided {
  body: string;
  solutions?: SolutionArticle[];
  kind: AssistanceKind;
  language: string;
  providedAt?: string;
  contentId: string;
}

type AssistanceProps<Content extends Provided> = {
  target: AssistanceTarget;
  kind: AssistanceKind;
  renderBody?: (body: string, content: Content) => ReactNode;
  description?: string;
  preferredLanguage?: SubmissionLanguage;
  endpoint?: "scholarship/assistance" | "practice/scholarship/assistance" | `schools/${string}/scholarship/assistance` | `schools/${string}/acsl/${string}/programming/${"translation" | "solution"}`;
};

export function ScholarshipAssistance<Content extends Provided = Provided>(props: AssistanceProps<Content>) {
  return <AssistanceContents key={JSON.stringify([props.endpoint, props.target, props.kind])} {...props} />;
}

function AssistanceContents<Content extends Provided>({
  target,
  kind,
  renderBody,
  description,
  preferredLanguage,
  endpoint = "scholarship/assistance",
}: AssistanceProps<Content>) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "en" ? en : zh);
  const isSolution = kind === "FULL_SOLUTION";
  const [quote, setQuote] = useState<Quote | null>(null),
    [provided, setProvided] = useState<Content | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(isSolution),
    [error, setError] = useState("");
  const lock = useRef(false),
    requestKey = useRef<string | null>(null);
  const body = {
    ...target,
    kind,
    language: kind === "FULL_TRANSLATION" ? "zh-CN" : "",
  };
  const serializedBody = JSON.stringify(body);
  const schoolAssistance = "type" in target;
  const problemSolutions = isSolution && (schoolAssistance ? target.type === "problem" : "problemId" in target);
  const title =
    kind === "FULL_TRANSLATION"
      ? tx("中文题面", "Chinese translation")
      : problemSolutions
        ? tx("题解与参考代码", "Solutions and reference code")
        : tx("完整题解与参考代码", "Full solution and reference code");

  useEffect(() => {
    if (!isSolution) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const options = { method: "POST", body: JSON.parse(serializedBody), signal };
    async function load() {
      try {
        const next = await productionApi<Quote>(`${endpoint}/quote`, options);
        if (signal.aborted) return;
        setQuote(next);
        if (next.available && (next.mode === "free" || next.unlocked)) {
          const content = await productionApi<Content>(`${endpoint}/provide`, options);
          if (!signal.aborted) setProvided(content);
        }
      } catch (cause) {
        if (!signal.aborted) setError(apiMessage(cause));
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, isSolution, reload, serializedBody]);

  function reloadAccess() {
    setDialogOpen(false);
    setQuote(null);
    setError("");
    setBusy(true);
    setReload(previous => previous + 1);
  }
  async function prepare() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setQuote(
        await productionApi<Quote>(`${endpoint}/quote`, {
          method: "POST",
          body,
        }),
      );
      setDialogOpen(true);
    } catch (cause) {
      setError(apiMessage(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function provide() {
    if (lock.current || !quote?.available) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (quote.mode === "paid" && !quote.unlocked) {
        requestKey.current ??= productionId();
        const unlock = await productionApi<{ balance: number; unlocked: boolean }>(`${endpoint}/unlock`, {
          method: "POST",
          body: {
            ...body,
            requestKey: requestKey.current,
            confirmedPrice: quote.price,
            confirmedContentId: quote.contentId,
            confirmedRevision: quote.contentRevision,
          },
        });
        // An unlock can succeed even if delivery fails. Retry only delivery; entitlement remains permanent.
        setQuote({
          ...quote,
          unlocked: unlock.unlocked,
          mode: unlock.unlocked ? quote.mode : "free",
          price: 0,
          balance: unlock.balance,
          balanceAfter: unlock.balance,
          requiresConfirmation: false,
        });
        window.dispatchEvent(new Event(schoolAssistance ? "codemaster:school-scholarship-changed" : "campus-judge:scholarship-changed"));
      }
      setProvided(
        await productionApi<Content>(`${endpoint}/provide`, {
          method: "POST",
          body,
        }),
      );
      setDialogOpen(false);
      setQuote(null);
    } catch (cause) {
      if (isSolution && cause instanceof ApiError && cause.code === "QUOTE_CHANGED") {
        requestKey.current = null;
        reloadAccess();
        return;
      }
      setError(apiMessage(cause));
    } finally {
      lock.current = false;
    }
    setBusy(false);
  }
  return (
    <section className="space-y-3" aria-label={title}>
      {provided ? (
        <>
          {renderBody ? (
            renderBody(provided.body, provided)
          ) : kind === "FULL_SOLUTION" ? (
            <SolutionBundle body={provided.body} solutions={provided.solutions} preferredLanguage={preferredLanguage} />
          ) : (
            <LessonContent content={provided.body} />
          )}
          {!isSolution && <p className="text-xs text-muted-foreground">
            {provided.providedAt ? tx(
              "本次提供已记录；已解锁内容可免费重看，仍受活动开放规则约束。",
              "Delivery recorded. Unlocked content can be viewed again free, subject to activity access rules.",
            ) : tx("已解锁的内容可免费重看。", "Unlocked content can be viewed again free.")}
          </p>}
        </>
      ) : isSolution ? (
        <>
          {busy && !dialogOpen && <p role="status" className="text-sm text-muted-foreground">{tx("正在加载题解…", "Loading solutions…")}</p>}
          {!busy && quote && !quote.available && <p role="status" className="text-sm text-muted-foreground">
            {quote.reason || tx("当前暂无可查看的题解。", "No solution is available here yet.")}
          </p>}
          {!busy && !dialogOpen && quote?.available && quote.requiresConfirmation && <>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
            <Button size="sm" variant="secondary" onClick={() => { setError(""); setDialogOpen(true); }}>
              {tx(`解锁题解（${quote.price} 奖学金）`, `Unlock solution (${quote.price} scholarship)`)}
            </Button>
          </>}
          {!busy && !dialogOpen && error && !quote?.requiresConfirmation && <Button size="sm" variant="secondary" onClick={reloadAccess}>
            {tx("重新加载题解", "Retry loading solutions")}
          </Button>}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {description ?? tx(
              "查看已审核的中文题面。翻译不影响首次 AC 的奖学金奖励。",
              "Read the reviewed Chinese statement. Translation does not affect first-AC scholarship rewards.",
            )}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void prepare()}
          >
            <Languages size={15} />{" "}
            {busy
              ? tx("正在查询…", "Checking…")
              : tx("查看开放方式与价格", "Check access and price")}
          </Button>
        </>
      )}
      {error && !dialogOpen && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {quote && dialogOpen && (
        <Modal
          title={title}
          onClose={() => {
            if (!busy) {
              setDialogOpen(false);
            }
          }}
        >
          <div className="space-y-4 text-sm">
            {!quote.available ? (
              <p role="status">
                {quote.reason ||
                  tx(
                    "暂未发布内容，或当前活动尚未开放。不会扣除奖学金。",
                    "Content is unavailable or restricted by this activity. No scholarship will be deducted.",
                  )}
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-subtle p-3">
                  <dt>{tx("内容", "Content")}</dt>
                  <dd className="text-right font-semibold">{title}</dd>
                  {quote.mode === "paid" && !quote.unlocked && (quote.translationCredit ?? 0) > 0 && (
                    <>
                      <dt>{tx("题解原价", "Solution price")}</dt>
                      <dd className="text-right">{quote.basePrice} {tx("奖学金", "scholarship")}</dd>
                      <dt>{tx("已付翻译抵扣", "Translation credit")}</dt>
                      <dd className="text-right">−{quote.translationCredit} {tx("奖学金", "scholarship")}</dd>
                    </>
                  )}
                  <dt>{tx("本次费用", "Cost")}</dt>
                  <dd className="text-right font-semibold">
                    {quote.unlocked || quote.mode === "free" ? 0 : quote.price}{" "}
                    {tx("奖学金", "scholarship")}
                  </dd>
                  <dt>{tx("当前余额", "Balance")}</dt>
                  <dd className="text-right">{quote.balance} {tx("奖学金", "scholarship")}</dd>
                  <dt>{tx("扣后余额", "Balance after")}</dt>
                  <dd className="text-right">
                    {quote.unlocked || quote.mode === "free"
                      ? `${quote.balance} ${tx("奖学金", "scholarship")}`
                      : quote.balanceAfter < 0
                        ? tx("余额不足", "Insufficient")
                        : `${quote.balanceAfter} ${tx("奖学金", "scholarship")}`}
                  </dd>
                </dl>
                <p className="text-muted-foreground">
                  {quote.unlocked
                    ? tx(
                        "已经解锁，本次免费重看。",
                        "Already unlocked. This view is free.",
                      )
                    : quote.mode === "free"
                      ? tx(
                          "按当前规则免费提供；本次免费查看不建立永久付费权益。",
                          "Free under the current rules. This does not create a permanent purchased entitlement.",
                        )
                      : tx(
                          "同一题目及辅助类型只付费解锁一次，跨页面、活动和版本可重看已发布的对应版本内容。",
                          "Pay once per problem and assistance type. Revisit published content for the relevant version across pages and activities.",
                        )}
                </p>
                {kind === "FULL_SOLUTION" && quote.affectsFirstAcScholarship !== false && (
                  <p className="rounded-md border border-warning/30 bg-warning/5 p-3">
                    {tx(
                      "确认后本站会提供完整答案并记录提供时间。此后提交不领取本题首次 AC 奖学金；此前已提交、正在判题的答案及已经到账的奖励不受影响。挑战任务通常也不奖励看过答案后的提交。",
                      "Confirmation provides the full answer and records the delivery time. Later submissions do not earn first-AC scholarship for this problem. Already received submissions and awarded rewards are unaffected. Challenge activities normally exclude assisted submissions too.",
                    )}
                  </p>
                )}
                {quote.mode === "paid" &&
                  !quote.unlocked &&
                  quote.balance < quote.price && (
                    <p role="alert" className="text-destructive">
                      {tx(
                        "奖学金余额不足，无法解锁。",
                        "Insufficient scholarship to unlock this content.",
                      )}
                    </p>
                  )}
              </>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => setDialogOpen(false)}
              >
                {tx("取消", "Cancel")}
              </Button>
              {quote.available && (
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    (quote.mode === "paid" &&
                      !quote.unlocked &&
                      quote.balance < quote.price)
                  }
                  onClick={() => void provide()}
                >
                  {busy
                    ? tx("处理中…", "Processing…")
                    : quote.mode === "paid" && !quote.unlocked && quote.price > 0
                      ? tx(
                          `确认使用 ${quote.price} 奖学金并查看`,
                          `Use ${quote.price} scholarship and view`,
                        )
                      : tx("确认查看", "Confirm and view")}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
