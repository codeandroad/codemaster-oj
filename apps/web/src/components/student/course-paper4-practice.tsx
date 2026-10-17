"use client";

import { CheckCircle2, FileCode2, Loader2 } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { buttonVariants } from "@/components/ui/button";
import { coursePaper4LinkKey, type CoursePaper4Link } from "@/components/course-paper4";
import { coursePaper4Href, coursePaper4Progress } from "@/components/paper4/paper4-learning-navigation";

export function CoursePaper4Practice({ links, pathId, chapterId }: { links: CoursePaper4Link[]; pathId: string; chapterId: string }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const context = { learningPathId: pathId, chapterId };
  function rememberScroll() { try { sessionStorage.setItem(`learning-scroll:${pathId}:${chapterId}`, String(window.scrollY)); } catch {} }
  return <>{links.map(link => {
    const progress = coursePaper4Progress(link), href = coursePaper4Href(link, context);
    const title = link.questionKey ? link.questionTitle || link.questions[0]?.title || link.title : link.title;
    return <div key={coursePaper4LinkKey(link)} className="mt-4 border-t border-border pt-4" data-od-id="course-paper4-practice">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1"><h3 className="flex items-start gap-2 font-semibold"><FileCode2 size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-primary"/>{progress.available ? <AppLink href={href} className="text-primary hover:underline focus-visible:underline" onClick={rememberScroll}>{title}</AppLink> : <span>{title}</span>}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{link.shortTitle || "Paper 4"}{link.versionNumber ? ` · v${link.versionNumber}` : ""} · {link.questionKey ? tx(`大题 ${link.questionKey}`, `Question ${link.questionKey}`) : tx(`整套试卷 · ${progress.total} 道大题`, `Whole paper · ${progress.total} questions`)}</p>
          {!progress.available ? <p className="mt-2 text-sm text-muted-foreground">{tx("练习暂不可用，请联系老师。", "This practice is unavailable. Contact your teacher.")}</p> : progress.done ? <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-sm font-semibold text-success"><CheckCircle2 size={15} aria-hidden="true"/>{tx("已通过正式判题", "Accepted in formal judging")}</p> : <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{progress.completed} / {progress.total} {tx("道大题已 AC", "questions accepted")}</span>{progress.pending > 0 && <span role="status" className="inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>{tx("正式判题中…", "Formal judging…")}</span>}</p>}
        </div>
        {progress.available && <AppLink className={buttonVariants({ variant: "secondary" })} href={href} onClick={rememberScroll}>{progress.done ? tx("查看或再次练习", "Review or practice again") : tx("进入练习", "Open practice")}</AppLink>}
      </div>
      {!link.questionKey && link.questions.length > 1 && <ul className="mt-3 grid gap-2 sm:grid-cols-2">{link.questions.map(question => <li key={question.key}>{progress.available ? <AppLink href={coursePaper4Href(link, context, question.key)} onClick={rememberScroll} className={`flex min-h-10 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary ${question.completed ? "text-success" : "text-primary"}`}>{question.completed && <CheckCircle2 size={14} aria-label={tx("已通过正式判题", "Accepted in formal judging")}/>}<span>{question.key} · {question.title}</span></AppLink> : <span className="block px-3 py-2 text-sm text-muted-foreground">{question.key} · {question.title}</span>}</li>)}</ul>}
    </div>;
  })}</>;
}
