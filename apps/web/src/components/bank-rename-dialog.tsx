import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-context";
import { Feedback, Field, input, Modal, useAction } from "@/components/teacher/shared";
import { productionApi } from "@/lib/production-api";

export function BankRenameDialog({
  bank,
  onClose,
  onRenamed,
}: {
  bank: { id: string; name: string };
  onClose: () => void;
  onRenamed: () => void;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [name, setName] = useState(bank.name);
  const action = useAction();
  const nextName = name.trim();
  const canSave = !action.busy && nextName.length > 0 && nextName !== bank.name;

  return (
    <Modal title={tr("重命名题库", "Rename bank")} onClose={() => { if (!action.busy) onClose(); }}>
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (!canSave) return;
          void action.run(async () => {
            await productionApi(`problem-banks/${encodeURIComponent(bank.id)}`, {
              method: "PATCH",
              body: { name: nextName },
            });
            onRenamed();
          });
        }}
      >
        <Field label={tr("题库名称", "Bank name")}>
          <input autoFocus required maxLength={200} className={input}
            value={name} onChange={event => setName(event.target.value)} disabled={action.busy} />
        </Field>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={action.busy} onClick={onClose}>
            {tr("取消", "Cancel")}
          </Button>
          <Button type="submit" disabled={!canSave}>{tr("保存名称", "Save name")}</Button>
        </div>
      </form>
    </Modal>
  );
}
