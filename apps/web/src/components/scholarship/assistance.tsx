"use client";

import { useRef, useState, type ReactNode } from "react";
import { BookOpen, Languages } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/teacher/shared";
import { LessonContent } from "@/components/student/shared";
import { SolutionContent } from "@/components/scholarship/solution-content";
import { apiMessage, productionApi, productionId } from "@/lib/production-api";

export type AssistanceKind = "FULL_TRANSLATION" | "FULL_SOLUTION";
export type AssistanceTarget =
  | {
      problemId: string;
      versionId: string;
      assignmentId?: string;
      timedAttemptId?: string;
    }
  | { paper4AttemptId: string; questionKey: string };
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
  requiresConfirmation: boolean;
  reason?: string;
}
interface Provided {
  body: string;
  kind: AssistanceKind;
  language: string;
  providedAt: string;
  contentId: string;
}

/** Metadata only until the student explicitly confirms. Bodies are never prefetched or persisted. */
export function ScholarshipAssistance({
  target,
  kind,
  renderBody,
  endpoint = "scholarship/assistance",
}: {
  target: AssistanceTarget;
  kind: AssistanceKind;
  renderBody?: (body: string) => ReactNode;
  endpoint?: "scholarship/assistance" | "practice/scholarship/assistance";
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "en" ? en : zh);
  const [quote, setQuote] = useState<Quote | null>(null),
    [provided, setProvided] = useState<Provided | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    requestKey = useRef<string | null>(null);
  const body = {
    ...target,
    kind,
    language: kind === "FULL_TRANSLATION" ? "zh-CN" : "",
  };
  const title =
    kind === "FULL_TRANSLATION"
      ? tx("中文题面", "Chinese translation")
      : tx("完整题解与参考代码", "Full solution and reference code");
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
        const unlock = await productionApi<{ balance: number }>(`${endpoint}/unlock`, {
          method: "POST",
          body: {
            ...body,
            requestKey: requestKey.current,
            confirmedPrice: quote.price,
            confirmedContentId: quote.contentId,
          },
        });
        // An unlock can succeed even if delivery fails. Retry only delivery; entitlement remains permanent.
        setQuote({
          ...quote,
          unlocked: true,
          price: 0,
          balance: unlock.balance,
          balanceAfter: unlock.balance,
          requiresConfirmation: false,
        });
        window.dispatchEvent(new Event("campus-judge:scholarship-changed"));
      }
      setProvided(
        await productionApi<Provided>(`${endpoint}/provide`, {
          method: "POST",
          body,
        }),
      );
      setQuote(null);
    } catch (cause) {
      setError(apiMessage(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label={title}>
      {provided ? (
        <>
          {renderBody ? (
            renderBody(provided.body)
          ) : kind === "FULL_SOLUTION" ? (
            <SolutionContent body={provided.body} />
          ) : (
            <LessonContent content={provided.body} />
          )}
          <p className="text-xs text-muted-foreground">
            {tx(
              "本次提供已记录；已解锁内容可免费重看，仍受活动开放规则约束。",
              "Delivery recorded. Unlocked content can be viewed again free, subject to activity access rules.",
            )}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {kind === "FULL_TRANSLATION"
              ? tx(
                  "查看已审核的中文题面。翻译不影响首次 AC 的奖学金奖励。",
                  "Read the reviewed Chinese statement. Translation does not affect first-AC scholarship rewards.",
                )
              : tx(
                  "查看已发布的题解。提交前查看完整答案会影响本题首次 AC 的奖学金奖励；成绩和排行榜积分不变。",
                  "Read the published solution. Viewing a full solution before submitting affects first-AC scholarship rewards for this problem; grades and leaderboard points are unchanged.",
                )}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {kind === "FULL_TRANSLATION" ? (
              <Languages size={15} />
            ) : (
              <BookOpen size={15} />
            )}{" "}
            {busy
              ? tx("正在查询…", "Checking…")
              : tx("查看开放方式与价格", "Check access and price")}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {quote && (
        <Modal
          title={title}
          onClose={() => {
            if (!busy) {
              setQuote(null);
              setError("");
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
                {kind === "FULL_SOLUTION" && (
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
                onClick={() => setQuote(null)}
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
