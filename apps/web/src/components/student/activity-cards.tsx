import { ArrowRight, CalendarClock, Check, ClipboardList, Clock3 } from "lucide-react";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { StatusPill } from "@/components/page-chrome";
import { buttonVariants } from "@/components/ui/button";
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

export function StudentAssignmentCard({
  title, href, status, audience, course, active, archived, dueAt, problemCount, score, maxScore, pending, attempted, solved,
}: ActivityCard & {
  dueAt: string | null;
  archived?: boolean;
  problemCount: number;
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
  return <section className="grid items-center gap-4 border border-border bg-surface p-5 panel-shadow md:grid-cols-[minmax(0,1fr)_200px_auto] md:gap-5">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 font-bold">
          <AppLink href={href} className="flex items-start gap-2 hover:text-primary hover:underline focus-visible:underline">
            <ClipboardList size={17} aria-hidden className="mt-0.5 shrink-0 text-primary" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
          </AppLink>
        </h2>
        {complete && <StatusPill status="Completed" icon={<Check size={13} />} />}
        {(!complete || archived) && <StatusPill status={status} />}
      </div>
      {audience && <p className="mt-1 text-sm text-muted-foreground">{audience}</p>}
      {course && <p className="mt-1 text-sm"><AppLink href={course.href} className="font-medium text-primary hover:underline focus-visible:underline">{text("关联课程：", "Course: ")}{course.title}</AppLink></p>}
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock size={14} aria-hidden className="shrink-0" />{text("截止", "Due")} {date(dueAt, locale)} · Asia/Shanghai</p>
    </div>
    <div className="min-w-0">
      <p className={`mb-1.5 text-sm font-semibold tabular-nums ${complete ? "text-success" : ""}`}>
        {text(`${solved}/${problemCount} 题已通过`, `${solved}/${problemCount} required problems passed`)}
      </p>
      <Progress percent={percent} complete={complete} label={text("必做题进度", "Required problem progress")} />
      <div className="mt-2 text-xs tabular-nums text-muted-foreground">
        <p>{text("成绩", "Score")} <span className="font-semibold text-foreground">{score == null && pending ? "—" : score ?? 0}/{maxScore}</span></p>
        <p className="mt-0.5">{text(`本作业已提交 ${attempted}/${problemCount} 题`, `${attempted}/${problemCount} problems submitted here`)}</p>
      </div>
    </div>
    <AppLink href={href} className={`${buttonVariants({ variant: active && !complete ? "primary" : "secondary" })} ${locale === "en" ? "md:w-40" : "md:w-28"}`}>
      {complete ? text("查看作业", "View assignment") : text("打开", "Open")} <ArrowRight size={15} aria-hidden />
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
