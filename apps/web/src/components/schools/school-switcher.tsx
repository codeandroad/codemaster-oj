"use client";

import { useLocale } from "@/components/locale-context";
import { useRef, useState, type Ref } from "react";
import { Building2, Check, ChevronDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  RoleLabel,
  schoolDisplayName,
  useSchoolText,
  type School,
} from "./school-ui";

export function SchoolSwitcher({
  schools,
  current,
  disabled = false,
  onSelect,
  onJoin,
  triggerRef,
}: {
  schools: School[];
  current?: School;
  disabled?: boolean;
  onSelect: (schoolId: string) => void;
  onJoin: () => void;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const joinRequested = useRef(false);
  const currentChoice = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next || !disabled) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className="w-11 gap-0.5"
          disabled={disabled}
          aria-label={text("Switch school", "切换学校")}
          title={text("Switch school", "切换学校")}
        >
          <Building2 size={16} aria-hidden="true" />
          <ChevronDown size={12} aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-sm gap-3 p-4"
        onOpenAutoFocus={(event) => {
          if (currentChoice.current) {
            event.preventDefault();
            currentChoice.current.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (joinRequested.current) {
            event.preventDefault();
            joinRequested.current = false;
            onJoin();
          }
        }}
      >
        <DialogTitle className="pr-9 text-base">
          {text("Switch school", "切换学校")}
        </DialogTitle>
        <DialogDescription className="pr-5">
          {text("Choose the school you want to work in.", "选择要进入的学校。")}
        </DialogDescription>
        <ul className="max-h-[min(55vh,24rem)] space-y-1 overflow-y-auto p-1">
          {schools.map((school) => {
            const selected = school.id === current?.id;
            return (
              <li key={school.id}>
                <Button
                  ref={selected ? currentChoice : undefined}
                  type="button"
                  variant="ghost"
                  aria-current={selected ? "true" : undefined}
                  disabled={disabled}
                  className={`h-auto min-h-12 w-full justify-start px-2 py-2 text-left ${selected ? "bg-primary/10 text-primary" : "text-foreground"}`}
                  onClick={() => {
                    setOpen(false);
                    onSelect(school.id);
                  }}
                >
                  <span className="min-w-0 flex-1 break-words">
                    <span className="block">
                      {schoolDisplayName(school, locale)}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {school.roles.map((role, index) => (
                        <span key={role}>
                          {index > 0 && " · "}
                          <RoleLabel role={role} />
                        </span>
                      ))}
                    </span>
                  </span>
                  {selected && (
                    <>
                      <Check
                        size={16}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {text("Current school", "当前学校")}
                      </span>
                    </>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start px-2"
            disabled={disabled}
            onClick={() => {
              joinRequested.current = true;
              setOpen(false);
            }}
          >
            <UserPlus size={16} aria-hidden="true" />
            {text("Join another school", "加入其他学校")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
