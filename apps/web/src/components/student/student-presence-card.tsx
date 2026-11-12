"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, X } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { ScholarshipIcon } from "@/components/scholarship/scholarship-icon";
import { AppLink } from "@/components/navigation";
import { ProfileAvatar } from "@/components/profile-hero";
import { ApiError, productionApi } from "@/lib/production-api";
import styles from "./student-presence.module.css";

type PresencePreview = {
  student: { identityId: string; displayName: string; avatar?: string | null; isSelf: boolean };
  stats: { points?: number; solvedProblems?: number; acRate?: number | null; scholarship?: number };
  activity: { id: string; problemTitle: string; createdAt: string }[];
};

/** Fetch only the server-filtered preview; never prefetch full profiles or submissions. */
export function StudentPresenceCard({ identityId, onBack, onMinimize, endpoint = "presence", backLabel, profileHref, variant = "panel" }: {
  identityId: string;
  onBack: () => void;
  onMinimize?: () => void;
  endpoint?: "presence" | "practice/presence";
  backLabel?: string;
  profileHref?: string;
  variant?: "panel" | "disclosure";
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const back = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<PresencePreview | null>(null);
  const [error, setError] = useState<"unavailable" | "failed" | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => { if (variant === "panel") back.current?.focus(); }, [variant]);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const next = await productionApi<PresencePreview>(`${endpoint}/students/${encodeURIComponent(identityId)}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setResult(next); setError(null); }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(caught instanceof ApiError && [401, 403, 404].includes(caught.status) ? "unavailable" : "failed");
        }
      } finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [identityId, retry, endpoint]);
  const formatDate = (date: string, compact: boolean) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "short", day: "numeric", ...(compact ? {} : { year: "numeric", hour: "2-digit", minute: "2-digit" } as const),
  }).format(new Date(date));
  const avatar = result && <ProfileAvatar avatar={result.student.avatar} nickname={result.student.displayName}/>;
  const backText = backLabel ?? tx("返回在线列表", "Back to online students");
  return <>
    <div className={styles.toolbar}>
      {variant === "panel" && <button ref={back} type="button" className={styles.minimize} onClick={onBack} aria-label={backText} title={backLabel ?? tx("返回", "Back")}><ArrowLeft size={15}/></button>}
      <span className={styles.cardTitle}>{tx("学习近况", "Recent activity")}</span>
      {variant === "disclosure" && <button type="button" className={styles.minimize} onClick={onBack} aria-label={backLabel ?? tx("收起学习近况", "Close recent activity")} title={backLabel ?? tx("收起学习近况", "Close recent activity")}><X size={15}/></button>}
      {onMinimize && <button type="button" className={styles.minimize} onClick={onMinimize} aria-label={tx("最小化在线列表", "Minimize online list")} title={tx("最小化", "Minimize")}><ChevronDown size={16}/></button>}
    </div>
    <div className={styles.cardBody} aria-busy={!result && !error}>
      {error ? <p role="status" className={styles.message}>{error === "unavailable" ? tx("无法查看这位学生的近况。", "This student's activity is unavailable.") : tx("暂时无法获取近况。", "Activity is unavailable right now.")} {error === "failed" && <button type="button" onClick={() => { setError(null); setRetry(value => value + 1); }}>{tx("重试", "Retry")}</button>}</p> : !result ? <p role="status" className={styles.message}>{tx("加载中…", "Loading…")}</p> : <>
        <div className={styles.cardPerson}>
          {profileHref ? <AppLink
            href={profileHref}
            prefetch={false}
            className={styles.profileLink}
            aria-label={tx(`打开 ${result.student.displayName} 的个人主页`, `Open ${result.student.displayName}'s profile`)}
            title={tx("打开个人主页", "Open profile")}
          >{avatar}</AppLink> : avatar}
          <span className={styles.name} title={result.student.displayName}>{result.student.displayName}</span>
          {result.student.isSelf && <span className={styles.you}>{tx("我", "You")}</span>}
        </div>
        {(result.stats.points !== undefined || result.stats.solvedProblems !== undefined || result.stats.scholarship !== undefined || result.stats.acRate !== undefined) && <dl className={styles.stats}>
          {result.stats.points !== undefined && <div><dt>{tx("积分", "Points")}</dt><dd>{result.stats.points.toLocaleString(locale)}</dd></div>}
          {result.stats.solvedProblems !== undefined && <div><dt>{tx("解题数", "Solved")}</dt><dd>{result.stats.solvedProblems.toLocaleString(locale)}</dd></div>}
          {result.stats.acRate !== undefined && <div><dt>{tx("AC 率", "AC rate")}</dt><dd>{result.stats.acRate === null ? "—" : `${result.stats.acRate.toLocaleString(locale, { maximumFractionDigits: 1 })}%`}</dd></div>}
          {result.stats.scholarship !== undefined && <div><dt>{tx("奖学金", "Scholarship")}</dt><dd><ScholarshipIcon size={13}/>{result.stats.scholarship.toLocaleString(locale)}</dd></div>}
        </dl>}
        <div className={styles.activityHeading}>{tx("近期公开 AC", "Recent public AC")}</div>
        {result.activity.length ? <ul className={styles.activities}>{result.activity.map(item => <li key={item.id}>
          <Check size={13} className={styles.accepted} aria-label={tx("已通过", "Accepted")}/><span className={styles.activityName} title={item.problemTitle}>{item.problemTitle}</span><time dateTime={item.createdAt} title={formatDate(item.createdAt, false)}>{formatDate(item.createdAt, true)}</time>
        </li>)}</ul> : <p className={styles.emptyActivity}>{tx("暂无公开解题动态", "No public solving activity yet")}</p>}
      </>}
    </div>
  </>;
}
