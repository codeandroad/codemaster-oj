"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { Feedback, inputClass, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useSchoolError, useSchoolText } from "./school-ui";

export function JoinSchoolForm({
  action,
  onCancel,
  onJoined,
}: {
  action: ReturnType<typeof useMutation>;
  onCancel?: () => void;
  onJoined: (schoolId: string) => void;
}) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const isDisclosure = Boolean(onCancel);
  useEffect(() => {
    if (isDisclosure) input.current?.focus();
  }, [isDisclosure]);

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending.current) return;
        if (token.trim().length !== 32) {
          setInvalid(true);
          input.current?.focus();
          return;
        }
        setInvalid(false);
        pending.current = true;
        void action
          .run(async () => {
            try {
              const result = await productionApi<{ schoolId: string }>(
                "school-invitations/accept",
                { method: "POST", body: { token: token.trim() } },
              );
              setToken("");
              setVisible(false);
              action.success(text("School joined.", "已加入学校。"));
              onJoined(result.schoolId);
            } catch (error) {
              throw localError(error);
            }
          })
          .finally(() => {
            pending.current = false;
          });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label
          className="min-w-0 flex-1 text-sm font-semibold"
          htmlFor="school-invitation"
        >
          {text("Join with an invitation", "使用邀请加入学校")}
          <span className="mt-2 flex items-center gap-2">
            <input
              id="school-invitation"
              ref={input}
              type={visible ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setInvalid(false);
              }}
              aria-invalid={invalid}
              aria-describedby={invalid ? "invitation-error" : undefined}
              className={inputClass}
              disabled={action.busy}
            />
          </span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={text(
            visible ? "Hide invitation code" : "Show invitation code",
            visible ? "隐藏邀请码" : "显示邀请码",
          )}
          aria-pressed={visible}
          disabled={action.busy}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </Button>
        <Button
          type="submit"
          disabled={action.busy}
          aria-busy={action.busy}
          className="min-w-28"
        >
          <UserPlus size={15} />
          {text("Join school", "加入学校")}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            disabled={action.busy}
            onClick={onCancel}
          >
            {text("Cancel", "取消")}
          </Button>
        )}
      </div>
      {invalid && (
        <p
          id="invitation-error"
          role="alert"
          className="mt-2 text-sm text-destructive"
        >
          {text(
            "Enter the 32-character invitation code from your school administrator.",
            "请输入学校管理员提供的 32 位邀请码。",
          )}
        </p>
      )}
      <Feedback action={{ error: action.error, message: "" }} />
    </form>
  );
}
