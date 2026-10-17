"use client";

import { useRef, useState, type FormEvent } from "react";
import { Camera, Loader2, Settings2 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { LearningCover, courseCovers, courseDifficulties } from "@/components/learning-course";
import type { CourseAccessMetadata } from "@/components/course-access";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi, type SchoolClass } from "@/lib/production-api";
import { useData } from "./shared";
import { CourseSettingsInputError, courseSettingsInput, courseCoverByteLength, courseCoverMaxBytes } from "./course-settings-input";

export interface CourseSettings extends CourseAccessMetadata {
  id: string; title: string; description: string; category: string; estimatedMinutes?: number;
  difficulty?: keyof typeof courseDifficulties; coverKey?: keyof typeof courseCovers;
}
const input = "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60";
function localTime(value?: string | null) { return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16) : ""; }

export function CourseSettingsDialog({ course, onClose, onSaved }: { course: CourseSettings; onClose: () => void; onSaved: (course: CourseSettings) => void }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const classes = useData<{ items: SchoolClass[] }>("classes");
  const [tab, setTab] = useState<"details" | "access">("details");
  const [title, setTitle] = useState(course.title), [description, setDescription] = useState(course.description), [category, setCategory] = useState(course.category);
  const [authorName, setAuthorName] = useState(course.authorName ?? ""), [authoredAt, setAuthoredAt] = useState(localTime(course.authoredAt || course.createdAt));
  const [minutes, setMinutes] = useState(course.estimatedMinutes ?? 60), [difficulty, setDifficulty] = useState(course.difficulty ?? "beginner"), [coverKey, setCoverKey] = useState(course.coverKey ?? "general");
  const [coverImage, setCoverImage] = useState(course.coverImage ?? ""), [scope, setScope] = useState(course.accessScope ?? "school"), [classIds, setClassIds] = useState(course.classIds ?? []);
  const [from, setFrom] = useState(localTime(course.availableFrom)), [until, setUntil] = useState(localTime(course.availableUntil)), [listed, setListed] = useState(course.listed !== false);
  const [busy, setBusy] = useState(false), [imageBusy, setImageBusy] = useState(false), [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const options = [...(classes.data?.items ?? []), ...(course.classes ?? []).filter(item => !classes.data?.items.some(current => current.id === item.id))];
  function fail(message: string) { setError(message); requestAnimationFrame(() => errorRef.current?.focus()); }
  async function image(file?: File) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { fail(tx("请选择 5 MB 以内的 PNG、JPEG 或 WebP 图片。", "Choose a PNG, JPEG or WebP image smaller than 5 MB.")); return; }
    setImageBusy(true); setError("");
    const url = URL.createObjectURL(file), bitmap = new window.Image();
    bitmap.onload = () => {
      try {
        const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
        const context = canvas.getContext("2d"); if (!context) throw new Error();
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, 1280, 720);
        const ratio = Math.max(1280 / bitmap.width, 720 / bitmap.height), width = bitmap.width * ratio, height = bitmap.height * ratio;
        context.drawImage(bitmap, (1280 - width) / 2, (720 - height) / 2, width, height);
        const data = canvas.toDataURL("image/jpeg", 0.82);
        if (courseCoverByteLength(data) > courseCoverMaxBytes) { fail(tx("图片压缩后仍过大，请选择较简单的图片。", "The compressed image is too large. Choose a simpler image.")); return; }
        setCoverImage(data);
      } catch { fail(tx("无法处理图片，请换一张图片。", "Could not process this image. Choose another file.")); }
      finally { URL.revokeObjectURL(url); setImageBusy(false); }
    };
    bitmap.onerror = () => { URL.revokeObjectURL(url); setImageBusy(false); fail(tx("图片读取失败。", "Could not read the image.")); };
    bitmap.src = url;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || imageBusy) return;
    setError("");
    const messages: Record<string, string> = {
      TITLE: tx("请填写不超过 200 字的课程名称。", "Enter a course title of up to 200 characters."),
      CATEGORY: tx("请填写不超过 100 字的课程标签。", "Enter a category of up to 100 characters."),
      MINUTES: tx("预计分钟数须为 1–10080 之间的整数。", "Estimated minutes must be an integer from 1 to 10080."),
      AUTHOR: tx("显示的创建者不能超过 120 字。", "The displayed author must be at most 120 characters."),
      DESCRIPTION: tx("课程简介不能超过 4000 字。", "The description must be at most 4000 characters."),
      AUTHORED_AT: tx("请填写有效的显示创建时间。", "Enter a valid displayed creation time."),
      AVAILABLE_FROM: tx("请填写有效的开放时间，或留空。", "Enter a valid opening time, or leave it blank."),
      AVAILABLE_UNTIL: tx("请填写有效的关闭时间，或留空。", "Enter a valid closing time, or leave it blank."),
      WINDOW: tx("关闭时间须晚于开放时间。", "The closing time must be later than the opening time."),
      CLASSES: tx("请选择 1–50 个班级。", "Select 1–50 classes."),
      COVER: tx("封面须为有效的 PNG、JPEG 或 WebP 图片。", "The cover must be a valid PNG, JPEG or WebP image."),
      COVER_LIMIT: tx("压缩后的封面不能超过 512 KB，请选择较简单的图片。", "The compressed cover must be at most 512 KB. Choose a simpler image."),
    };
    try {
      const body = courseSettingsInput({ title, description, category, estimatedMinutes: minutes, difficulty, coverKey, coverImage, authorName, authoredAt, accessScope: scope, classIds, availableFrom: from, availableUntil: until, listed });
      setBusy(true);
      const saved = await productionApi<CourseSettings>(`learning-paths/${course.id}`, { method: "PATCH", body });
      onSaved(saved); onClose();
    } catch (reason) {
      if (reason instanceof CourseSettingsInputError) { setTab(reason.section); fail(messages[reason.code] ?? apiMessage(reason)); }
      else fail(apiMessage(reason));
    } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy && !imageBusy) onClose(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl" onEscapeKeyDown={event => { if (busy || imageBusy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy || imageBusy) event.preventDefault(); }}>
    <DialogTitle className="flex items-center gap-2"><Settings2 size={18} aria-hidden="true"/>{tx("课程属性与开放设置", "Course properties and access")}</DialogTitle>
    <DialogDescription>{course.title}</DialogDescription>
    <nav className="flex border-b border-border" aria-label={tx("课程设置分区", "Course settings sections")}>{(["details", "access"] as const).map(value => <button key={value} type="button" onClick={() => setTab(value)} aria-pressed={value === tab} className={`min-h-11 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${value === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{value === "details" ? tx("基本属性", "Properties") : tx("准入与开放", "Access and availability")}</button>)}</nav>
    <form noValidate onSubmit={event => void save(event)} className="space-y-4" aria-busy={busy || imageBusy}>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {tab === "details" ? <fieldset disabled={busy || imageBusy} className="space-y-4">
        <label className="grid gap-1 text-sm font-semibold">{tx("课程名称", "Course title")}<input className={input} maxLength={200} required value={title} onChange={event => setTitle(event.target.value)}/></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">{tx("显示的创建者", "Displayed author")}<input className={input} maxLength={120} value={authorName} onChange={event => setAuthorName(event.target.value)}/></label><label className="grid gap-1 text-sm font-semibold">{tx("显示的创建时间", "Displayed creation time")}<input className={input} type="datetime-local" required value={authoredAt} onChange={event => setAuthoredAt(event.target.value)}/></label></div>
        <p className="text-xs text-muted-foreground">{tx("此处修改课程展示信息；实际管理权限与系统创建记录单独保存。时间均为北京时间（UTC+8）。", "These fields describe the course. Management permissions and system creation records are stored separately. Times use Asia/Shanghai (UTC+8).")}</p>
        <div className="grid gap-4 sm:grid-cols-3"><label className="grid gap-1 text-sm font-semibold">{tx("课程标签", "Category")}<input className={input} maxLength={100} required value={category} onChange={event => setCategory(event.target.value)}/></label><label className="grid gap-1 text-sm font-semibold">{tx("课程难度", "Level")}<select className={input} value={difficulty} onChange={event => setDifficulty(event.target.value as typeof difficulty)}>{Object.entries(courseDifficulties).map(([key, label]) => <option key={key} value={key}>{locale === "en" ? ({ beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" })[key as typeof difficulty] : label}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">{tx("预计分钟数", "Estimated minutes")}<input className={input} type="number" min={1} max={10080} required value={minutes} onChange={event => setMinutes(Number(event.target.value))}/></label></div>
        <label className="grid gap-1 text-sm font-semibold">{tx("简介", "Description")}<textarea className={`${input} min-h-24 py-2 leading-6`} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)}/></label>
        <div className="grid items-start gap-4 sm:grid-cols-[180px_minmax(0,1fr)]"><div className="overflow-hidden rounded-md border border-border"><LearningCover coverKey={coverKey} coverImage={coverImage}/></div><div className="space-y-3"><label className="grid gap-1 text-sm font-semibold">{tx("预设封面", "Preset cover")}<select className={input} value={coverKey} onChange={event => { setCoverKey(event.target.value as typeof coverKey); setCoverImage(""); }}>{Object.entries(courseCovers).map(([key, label]) => <option key={key} value={key}>{locale === "en" ? ({ python: "Python", algorithms: "Algorithms", general: "General learning" })[key as typeof coverKey] : label}</option>)}</select></label><div className="flex flex-wrap items-center gap-2"><label className="relative inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold focus-within:outline-2 focus-within:outline-primary"><Camera size={16} aria-hidden="true"/>{tx("上传预览图", "Upload cover")}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || imageBusy} className="sr-only" onChange={event => { void image(event.target.files?.[0]); event.target.value = ""; }}/></label>{coverImage && <Button type="button" variant="ghost" size="sm" onClick={() => setCoverImage("")}>{tx("移除自定义图片", "Remove image")}</Button>}</div><p className="text-xs text-muted-foreground">{tx("PNG、JPEG、WebP，原图最大 5 MB；裁切为 16:9，压缩后不超过 512 KB。", "PNG, JPEG or WebP, up to 5 MB; cropped to 16:9 and compressed to at most 512 KB.")}</p>{imageBusy && <p role="status" className="text-sm text-muted-foreground">{tx("正在处理图片…", "Processing image…")}</p>}</div></div>
      </fieldset> : <fieldset disabled={busy || imageBusy} className="space-y-4">
        <label className="grid gap-1 text-sm font-semibold">{tx("准入范围", "Eligible students")}<select className={input} value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="school">{tx("全校学生（含未分班）", "All school students (including no class)")}</option><option value="classes">{tx("指定班级（可多选）", "Selected classes (multiple allowed)")}</option></select></label>
        {scope === "classes" && <section className="rounded-md border border-border" aria-label={tx("课程班级", "Course classes")}><div className="border-b border-border bg-surface-subtle px-3 py-2 text-sm font-semibold">{tx(`已选择 ${classIds.length} 个班级`, `${classIds.length} classes selected`)}</div>{classes.loading && <p role="status" className="p-3 text-sm text-muted-foreground">{tx("正在加载班级…", "Loading classes…")}</p>}{classes.error && <p role="alert" className="p-3 text-sm text-destructive">{classes.error}<Button type="button" variant="ghost" size="sm" onClick={classes.reload}>{tx("重试", "Retry")}</Button></p>}<div className="max-h-56 overflow-y-auto">{options.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0"><input className="size-4 accent-primary" type="checkbox" checked={classIds.includes(item.id)} onChange={event => setClassIds(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))}/><span>{item.name}</span>{"archived" in item && item.archived && <span className="text-xs text-muted-foreground">{tx("已归档", "Archived")}</span>}</label>)}</div>{!classes.loading && !options.length && <p className="p-3 text-sm text-muted-foreground">{tx("暂无可关联班级，请先新建班级。", "Create a class before restricting course access.")}</p>}</section>}
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">{tx("开放时间（可选）", "Opens at (optional)")}<input className={input} type="datetime-local" value={from} onChange={event => setFrom(event.target.value)}/></label><label className="grid gap-1 text-sm font-semibold">{tx("关闭时间（可选）", "Closes at (optional)")}<input className={input} type="datetime-local" min={from || undefined} value={until} onChange={event => setUntil(event.target.value)}/></label></div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={listed} onChange={event => setListed(event.target.checked)}/><span className="font-semibold">{tx("在学生课程目录中显示", "Show in the student course catalog")}</span></label>
        <p className="rounded-md bg-surface-subtle p-3 text-xs leading-6 text-muted-foreground">{tx("隐藏目录后，符合班级与时间条件的学生仍可通过链接进入。下架会暂停学生访问，保留章节、学习进度和历史成绩。", "An unlisted course remains accessible by link to eligible students during its availability window. Withdrawal pauses access and preserves chapters, progress and past results.")}</p>
      </fieldset>}
      <DialogFooter><Button type="button" variant="secondary" disabled={busy || imageBusy} onClick={onClose}>{tx("取消", "Cancel")}</Button><Button type="submit" disabled={busy || imageBusy || scope === "classes" && (classes.loading || Boolean(classes.error))}>{busy && <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>}{tx("保存课程设置", "Save course settings")}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
