"use client";

import { useState } from "react";
import { Feedback, Loading, panelClass, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

type Preferences = { scholarshipEnabled: boolean; rankingEnabled: boolean };
const endpoint = "practice/preferences";

export function PublicPracticePreferences() {
  const text = useSchoolText();
  const preferences = useData<Preferences>(endpoint);
  const mutation = useMutation();
  const [saved, setSaved] = useState<Preferences | null>(null);
  const rows = [
    {
      key: "scholarshipEnabled",
      title: text("Public practice scholarship", "公开练习奖学金"),
      detail: text(
        "Enable to receive the one-time allowance and earn eligible first-AC rewards. Turning it off keeps your balance and unlocked content.",
        "开启后可领取一次性初始额度，并获得符合条件的首个 AC 奖励。关闭后保留余额和已解锁内容。",
      ),
    },
    {
      key: "rankingEnabled",
      title: text("Public practice ranking", "公开练习排名"),
      detail: text(
        "Eligible submissions made while ranking is on can count. Turning it off hides your entry without changing your practice history.",
        "开启期间符合条件的提交可计入排名。关闭后隐藏榜单条目，保留个人练习记录。",
      ),
    },
  ] as const;

  return (
    <section id="public-practice" aria-labelledby="public-practice-title" className={`${panelClass} scroll-mt-4 p-4`}>
      <h2 id="public-practice-title" className="font-semibold">{text("Public practice", "公开练习")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {text("You can solve problems and keep your progress with both options off.", "两项都关闭时，你仍可做题、查看判题结果并保留个人进度。")}
      </p>
      <Loading resource={preferences}>
        <div className="mt-2 divide-y divide-border">
          {rows.map(({ key, title, detail }) => {
            const enabled = (saved ?? preferences.data)?.[key] ?? false;
            const label = enabled ? text("Turn off", "关闭") : text("Enable", "开启");
            return (
              <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-[1_1_15rem]">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p id={key} className="mt-1 text-sm text-muted-foreground">{detail}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{enabled ? text("On", "已开启") : text("Off", "已关闭")}</span>
                  <Button type="button" size="sm" variant="secondary"
                    disabled={mutation.busy || preferences.loading}
                    aria-label={enabled ? text(`Turn off ${title.toLowerCase()}`, `关闭${title}`) : text(`Enable ${title.toLowerCase()}`, `开启${title}`)}
                    aria-describedby={key}
                    onClick={() => void mutation.run(async () => {
                      const next = await productionApi<Preferences>(endpoint, { method: "PATCH", body: { [key]: !enabled } });
                      setSaved(next);
                      window.dispatchEvent(new Event("campus-judge:scholarship-changed"));
                      mutation.success(text("Public practice preferences saved.", "公开练习设置已保存。"));
                    })}>
                    {label}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Loading>
      <Feedback action={mutation}/>
    </section>
  );
}
