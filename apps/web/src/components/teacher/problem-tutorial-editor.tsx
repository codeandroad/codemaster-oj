"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { useNavigationBlocker } from "@/components/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Feedback, State, input, useData, useMutation } from "@/components/student/shared";
import { ApiError, productionApi } from "@/lib/production-api";
import { MathEditor } from "./math-editor";

type Settings = { mode: "course" | "custom" | "none"; body: string; revision: number };

type ProblemTutorialEditorProps = Pick<ButtonProps, "disabled" | "size" | "variant"> & {
  endpoint: string;
  problemTitle?: string;
  inline?: boolean;
  onEditStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
};

export function ProblemTutorialEditor({ endpoint, disabled, size, variant = "secondary", problemTitle, inline = false, onEditStateChange }: ProblemTutorialEditorProps) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const label = tr("编辑教程", "Edit tutorial");
  const [open, setOpen] = useState(false);
  const pending = useRef(false);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [committed, setCommitted] = useState<Settings | null>(null);
  const resource = useData<Settings>(inline || open ? endpoint + "?manage=true" : "");
  const action = useMutation();
  const modeId = useId();
  const [conflict, setConflict] = useState(false);
  const saved = committed && committed.revision >= (resource.data?.revision ?? -1) ? committed : resource.data;
  const value = draft ?? saved;
  // A closed tutorial dialog drops its fetched resource while retaining the local draft.
  const dirty = !!draft && (!saved || saved.mode !== draft.mode || saved.body !== (draft.mode === "custom" ? draft.body : ""));
  const canSave = !disabled && !resource.loading && !resource.error && !action.busy && dirty && !conflict
    && (value?.mode !== "custom" || Boolean(value.body.trim()));
  const blockNavigation = inline && dirty;
  useNavigationBlocker(blockNavigation);
  useEffect(() => {
    onEditStateChange?.({ dirty, busy: action.busy });
  }, [onEditStateChange, dirty, action.busy]);
  useEffect(() => {
    if (!blockNavigation) return;
    const block = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", block);
    return () => window.removeEventListener("beforeunload", block);
  }, [blockNavigation]);

  function close(discard: boolean) {
    if (pending.current) return;
    if (discard || !dirty) setDraft(null);
    setOpen(false);
  }

  const description = tr("设置学生答题时可查看的教程。点击「保存教程」即可单独保存。", "Choose what students can read while solving this problem. Use Save tutorial to save these settings separately.");
  const form = (
    <State data={resource}>
      {value && <form id={modeId + "-form"} className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (!canSave || pending.current) return;
        pending.current = true;
        void action.run(async () => {
          try {
            const next = await productionApi<Settings>(endpoint, {
              method: "PATCH",
              body: { mode: value.mode, body: value.body, expectedRevision: value.revision },
            });
            setCommitted(next);
            setDraft(null);
            action.success(tr("教程已保存。", "Tutorial saved."));
          } catch (error) {
            if (error instanceof ApiError && error.code === "REVISION_CONFLICT") setConflict(true);
            throw error;
          }
        }).finally(() => { pending.current = false; });
      }}>
        <div className="space-y-2">
          <label htmlFor={modeId} className="block text-sm font-semibold">{tr("教程来源", "Tutorial source")}</label>
          <select id={modeId} className={`${input}${inline ? " max-w-sm" : ""}`} value={value.mode} disabled={disabled || action.busy}
            onChange={event => setDraft({ ...value, mode: event.target.value as Settings["mode"] })}>
            <option value="course">{tr("使用关联课程章节", "Use linked course chapter")}</option>
            <option value="custom">{tr("自编教程", "Custom tutorial")}</option>
            <option value="none">{tr("无教程", "No tutorial")}</option>
          </select>
          {value.mode === "course" && <p className="text-sm text-muted-foreground">
            {tr("学生可以查看自己有权阅读的已发布章节。有可用章节时，答题页会显示「教程」页签。", "Students can view published chapters they have access to. The Tutorial tab appears when a chapter is available.")}
          </p>}
        </div>
        {value.mode === "custom" && <MathEditor fieldName="problem-tutorial" label={tr("教程正文 · Markdown", "Tutorial content · Markdown")}
          value={value.body} disabled={disabled || action.busy} initialPreview={inline}
          onChange={body => setDraft({ ...value, body })} />}
      </form>}
    </State>
  );
  const actions = (
    <div className="shrink-0 space-y-2">
      <Feedback action={action} />
      <div className="flex flex-wrap justify-end gap-2">
        {conflict && <Button type="button" variant="secondary" onClick={() => {
          setDraft(null);
          setConflict(false);
          action.reset();
          resource.reload();
        }}>{tr("放弃修改并重新载入", "Discard edits and reload")}</Button>}
        {inline && dirty && !conflict && <Button type="button" variant="secondary" disabled={disabled || action.busy} onClick={() => {
          setDraft(null);
          action.reset();
        }}>{tr("放弃教程修改", "Discard tutorial edits")}</Button>}
        {!inline && <Button type="button" variant="secondary" disabled={action.busy} onClick={() => close(true)}>
          {dirty ? tr("取消", "Cancel") : tr("关闭", "Close")}
        </Button>}
        <Button type="submit" form={modeId + "-form"} disabled={!canSave}>
          {action.busy ? tr("保存中…", "Saving…") : tr("保存教程", "Save tutorial")}
        </Button>
      </div>
    </div>
  );

  if (inline) return <div className="space-y-4" data-od-id="teacher-problem-tutorial">
    <p className="text-sm text-muted-foreground">{description}</p>
    {form}
    {actions}
  </div>;

  return <Dialog open={open} onOpenChange={next => {
    if (next) {
      setConflict(false);
      action.reset();
      setOpen(true);
    } else close(false);
  }}>
    <DialogTrigger asChild>
      <Button type="button" variant={variant} size={size} disabled={disabled} className="cursor-pointer" data-od-id="edit-problem-tutorial"
        aria-label={problemTitle ? tr(`编辑教程 · ${problemTitle}`, `Edit tutorial for ${problemTitle}`) : undefined}>
        <BookOpen size={15} aria-hidden="true" />{label}
      </Button>
    </DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-4 overflow-hidden">
      <div className="shrink-0 space-y-2 pr-10">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>
          {problemTitle && <span className="mb-1 block font-medium text-foreground [overflow-wrap:anywhere]">{problemTitle}</span>}
          {description}
        </DialogDescription>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-1">{form}</div>
      {actions}
    </DialogContent>
  </Dialog>;
}
