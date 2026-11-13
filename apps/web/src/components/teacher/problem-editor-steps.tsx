"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { ProblemEditorNavigation, ProblemEditorTarget } from "./problem-editor-navigation";

export function ProblemEditorSteps({ navigation, dirty, disabled, onSelect }: {
  navigation?: ProblemEditorNavigation;
  dirty: boolean;
  disabled: boolean;
  onSelect: (target: ProblemEditorTarget) => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [target, setTarget] = useState<ProblemEditorTarget | null>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!navigation) return null;

  function requestSwitch(next: ProblemEditorTarget | undefined, button: HTMLButtonElement) {
    if (!next || disabled) return;
    if (dirty) {
      trigger.current = button;
      setTarget(next);
    } else onSelect(next);
  }

  return <>
    <div role="group" aria-label={zh ? "切换编辑题目" : "Switch problem"} className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" className="cursor-pointer"
        title={navigation.previous?.title ?? (zh ? "没有上一题" : "No previous problem")}
        disabled={disabled || !navigation.previous} onClick={event => requestSwitch(navigation.previous, event.currentTarget)}>
        <ChevronLeft size={16} aria-hidden="true" />{zh ? "上一题" : "Previous problem"}
      </Button>
      <Button type="button" variant="secondary" className="cursor-pointer"
        title={navigation.next?.title ?? (zh ? "没有下一题" : "No next problem")}
        disabled={disabled || !navigation.next} onClick={event => requestSwitch(navigation.next, event.currentTarget)}>
        {zh ? "下一题" : "Next problem"}<ChevronRight size={16} aria-hidden="true" />
      </Button>
    </div>
    <Dialog open={!!target} onOpenChange={open => { if (!open) setTarget(null); }}>
      <DialogContent onOpenAutoFocus={event => { event.preventDefault(); keepEditing.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogTitle>{zh ? "离开当前题目？" : "Leave this problem?"}</DialogTitle>
        <DialogDescription className="break-words">
          {zh ? `切换到「${target?.title}」会放弃当前题目的未保存修改。` : `Switching to “${target?.title}” discards the unsaved changes to this problem.`}
        </DialogDescription>
        <DialogFooter className="gap-2">
          <Button ref={keepEditing} type="button" variant="secondary" onClick={() => setTarget(null)}>{zh ? "继续编辑" : "Keep editing"}</Button>
          <Button type="button" variant="danger" disabled={disabled} onClick={() => {
            if (!target) return;
            setTarget(null);
            onSelect(target);
          }}>{zh ? "切换题目" : "Switch problem"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

export function SaveAndEditNext({ target, disabled, onClick }: {
  target: ProblemEditorTarget;
  disabled: boolean;
  onClick: () => void;
}) {
  const { locale } = useLocale();
  return <Button type="button" variant="secondary" className="cursor-pointer" title={target.title} disabled={disabled} onClick={onClick}>
    {locale === "zh" ? "保存并编辑下一题" : "Save and edit next"}<ChevronRight size={16} aria-hidden="true" />
  </Button>;
}
