import { ArrowRight, CalendarClock, CheckCircle2, Check, ClipboardList, Clock3 } from "lucide-react";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { StatusPill } from "@/components/page-chrome";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "./dashboard-view";
import { date, Tabs } from "./shared";

export type TimingCategory = "Upcoming" | "Available" | "Completed" | "Archived";

export function timedPracticeCategoryLabel(locale: AppLocale, category: TimingCategory) {
  return locale === "zh"
    ? { Upcoming: "即将开始", Available: "可参加", Completed: "已结束", Archived: "历史归档" }[category]
    : category;
}

export function StudentTimedPracticeTabs({
  categories, value, onChange,
}: {
  categories: readonly TimingCategory[];
  value: TimingCategory;
  onChange: (category: TimingCategory) => void;
}) {
  const { locale } = useLocale();
  const label = (category: TimingCategory) => timedPracticeCategoryLabel(locale, category);
  return <Tabs
    items={categories.map(label)}
    value={label(value)}
    onChange={name => { const category = categories.find(item => label(item) === name); if (category) onChange(category); }}
    label={locale === "zh" ? "训练状态" : "Timed practice status"}
  />;
}

type ActivityCard = {
  title: string;
  href: string;
  status: string;
  audience?: string;
  course?: { title: string; href: string };
  active: boolean;
};

export function AssignmentCompletedStatus({ late }: { late?: boolean }) {
  const { locale } = useLocale();
  return <>
    <StatusPill status="Completed" icon={<Check size={13} />} />
    {late && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">
      {locale === "zh" ? "逾期完成" : "Completed late"}
    </span>}
  </>;
}

export function StudentAssignmentCard({
  title, href, status, audience, course, active, archived, overdue, dueAt, problemCount, completedLate, score, maxScore, pending, attempted, solved,
}: ActivityCard & {
  dueAt: string | null;
  archived?: boolean;
  overdue?: { canSubmit: boolean };
  problemCount: number;
  completedLate?: boolean;
  score: number | null;
  maxScore: number;
  pending?: boolean;
  attempted: number;
  solved: number;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const complete = problemCount > 0 && solved === problemCount;
  const percent = problemCount ? solved / problemCount * 100 : 0;
  let overdueStatus: string | undefined;
  if (overdue && !archived && !complete) {
    if (pending) overdueStatus = overdue.canSubmit ? "已截止，可补交" : "已截止";
    else overdueStatus = overdue.canSubmit ? "已截止，未完成 · 可补交" : "已截止，未完成";
  }
  const progressStatus = complete ? undefined
    : pending ? text("评测中", "Judging")
    : solved > 0 || attempted > 0 ? text("进行中", "In progress")
    : text("未开始", "Not started");
  const progressTone = pending || solved > 0 || attempted > 0 ? "info" : undefined;
  return <section className="grid items-center gap-4 border border-border bg-surface p-5 panel-shadow md:grid-cols-[minmax(0,1fr)_200px_auto] md:gap-5">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 text-lg font-bold">
          <AppLink href={href} className="flex items-start gap-2 hover:text-primary hover:underline focus-visible:underline">
            <ClipboardList size={17} aria-hidden className="mt-0.5 shrink-0 text-primary" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
          </AppLink>
        </h2>
        {complete && <AssignmentCompletedStatus late={completedLate} />}
        {(!complete || archived) && <StatusPill status={overdueStatus ?? progressStatus ?? status} tone={overdueStatus ? "warning" : progressTone} />}
        {overdueStatus && pending && <StatusPill status="Judging" />}
      </div>
      {audience && <p className="mt-1 text-sm text-muted-foreground">{audience}</p>}
      {course && <p className="mt-1 text-xs text-muted-foreground"><AppLink href={course.href} className="text-muted-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:underline">{text("关联课程：", "Course: ")}{course.title}</AppLink></p>}
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock size={14} aria-hidden className="shrink-0" />{text("截止", "Due")} {date(dueAt, locale)} · Asia/Shanghai</p>
    </div>
    <div className="min-w-0">
      <p className={`mb-1.5 text-sm font-semibold tabular-nums ${complete ? "text-success" : ""}`}>
        {text(`${solved}/${problemCount} 题已通过`, `${solved}/${problemCount} required problems passed`)}
      </p>
      <Progress percent={percent} complete={complete} label={text("必做题进度", "Required problem progress")} />
      <div className="mt-2 text-xs tabular-nums text-muted-foreground">
        <p>{text("截止成绩", "Deadline score")} <span className="font-semibold text-foreground">{score == null && pending ? "—" : score ?? 0}/{maxScore}</span></p>
        <p className="mt-0.5">{text(`本作业已提交 ${attempted}/${problemCount} 题`, `${attempted}/${problemCount} problems submitted here`)}</p>
      </div>
    </div>
    <AppLink href={href} className={`${buttonVariants({ variant: active && !complete ? "primary" : "secondary" })} whitespace-nowrap md:w-28`}>
      {complete ? text("查看作业", "View") : text("打开", "Open")} <ArrowRight size={15} aria-hidden />
    </AppLink>
  </section>;
}

export function StudentTimedPracticeCard({
  title, href, status, audience, course, active, startsAt, endsAt, durationMinutes, problemCount,
}: ActivityCard & {
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  problemCount: number;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  return <section className="grid items-center gap-4 border border-border bg-surface p-5 panel-shadow md:grid-cols-[minmax(0,1fr)_220px_auto]">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Clock3 size={18} className="text-primary" />
        <h2 className="font-bold"><AppLink href={href} className="hover:text-primary hover:underline focus-visible:underline">{title}</AppLink></h2>
        <StatusPill status={status} />
      </div>
      {audience && <p className="mt-2 text-sm text-muted-foreground">{audience}</p>}
      {course && <AppLink href={course.href} className="mt-1 inline-block text-xs font-semibold text-primary hover:underline focus-visible:underline">{text("课程：", "Course: ")}{course.title}</AppLink>}
    </div>
    <div className="text-sm">
      <p>{date(startsAt, locale)}–{date(endsAt, locale)}</p>
      <p className="text-xs text-muted-foreground">Asia/Shanghai · {durationMinutes} {text("分钟", "min")} · {problemCount} {text("题", "problems")}</p>
    </div>
    <AppLink href={href} className={buttonVariants({ variant: active ? "primary" : "secondary" })}>{text("查看", "View")} <ArrowRight size={15} /></AppLink>
  </section>;
}

export function AssignmentArchiveTabs({ archived, onChange }: { archived: boolean; onChange: (value: boolean) => void }) {
  const {locale} = useLocale();
  return <div className="mt-5 flex gap-2" role="group" aria-label={locale === "zh" ? "作业状态" : "Assignment status"}>
    <Button variant={archived ? "secondary" : "primary"} aria-pressed={!archived} onClick={() => onChange(false)}>{locale === "zh" ? "当前作业" : "Current"}</Button>
    <Button variant={archived ? "primary" : "secondary"} aria-pressed={archived} onClick={() => onChange(true)}>{locale === "zh" ? "历史归档" : "Archived"}</Button>
  </div>;
}

export function AssignmentScoreRule() {
  const {locale} = useLocale();
  return <section className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-surface p-5">
    <CheckCircle2 className="mt-0.5 text-success" size={18}/>
    <div><h2 className="font-bold">{locale === "zh" ? "成绩计算规则" : "Score display rule"}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{locale === "zh" ? "订正提交单独显示，不会覆盖原作业成绩。" : "Correction submissions are displayed separately. Later corrections do not overwrite the original assignment score."}</p></div>
  </section>;
}
