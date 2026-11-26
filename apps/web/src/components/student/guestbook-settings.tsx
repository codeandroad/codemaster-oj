"use client";
import { accountHomepageHref } from "@/lib/campus-routes";

import { useId } from "react";
import { AppLink } from "../navigation";
import { useSchoolText } from "../schools/school-ui";
import { productionApi } from "@/lib/production-api";
import { Feedback, State, panel, useData, useMutation } from "./data-state";

type Settings = { schoolOpen: boolean; practiceOpen: boolean; profileEnabled: boolean };
const endpoint = "account/guestbook-settings";

export function GuestbookSettings({accountId}: {accountId: string}) {
  const text = useSchoolText();
  const resource = useData<Settings>(endpoint);
  const action = useMutation();
  const description = useId();
  const settings = resource.data;
  const rows = [
    {key:"schoolOpen", label:text("Allow school-only messages and replies", "接受校内留言和回复")},
    {key:"practiceOpen", label:text("Allow public messages and replies", "接受公开留言和回复")},
    {key:"profileEnabled", label:text("Share my homepage with signed-in visitors outside my school", "允许校外登录用户通过链接访问我的主页")},
  ] as const;
  return <section className={panel} aria-labelledby={description + "-heading"}>
    <h2 id={description + "-heading"} className="font-semibold">{text("Profile messages", "主页留言")}</h2>
    <p id={description} className="mt-1 text-sm text-muted-foreground">{text("Closing new messages keeps existing messages and replies visible to the same audience.", "关闭新留言后，原先能查看主页的人仍可阅读已有留言和回复。")}</p>
    <State data={resource}>{settings && <fieldset disabled={action.busy || resource.loading} className="mt-3 space-y-2">
      {rows.map(({key,label}) => <label key={key} className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" checked={settings[key]} aria-describedby={description} className="size-4 accent-primary" onChange={event => {
          const enabled = event.currentTarget.checked;
          void action.run(async () => {
            if (key === "profileEnabled") {
              await productionApi(`practice/profiles/${encodeURIComponent(accountId)}`, {method:"PATCH",body:{profileEnabled:enabled}});
            } else {
              await productionApi(endpoint, {method:"PATCH",body:{scope:key === "schoolOpen" ? "school" : "practice",open:enabled}});
            }
            resource.reload();
            action.success(text("Saved.", "已保存。"));
          });
        }}/>
        {label}
      </label>)}
      {settings.profileEnabled && <AppLink className="inline-block text-sm font-semibold text-primary hover:underline" href={accountHomepageHref(accountId)}>{text("Homepage link", "个人主页链接")}</AppLink>}
    </fieldset>}</State>
    <Feedback action={action}/>
  </section>;
}
