"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { Feedback, State, useData, useMutation } from "./shared";

export type PracticeProfileSharing = { profile: { isSelf: boolean; profileEnabled?: boolean } };

export function ProfileSharingControls({ accountId, resource, showLink = false }: {
  accountId: string;
  resource: ReturnType<typeof useData<PracticeProfileSharing>>;
  showLink?: boolean;
}) {
  const { locale } = useLocale();
  const action = useMutation();
  const descriptionId = useId();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const id = encodeURIComponent(accountId);
  const person = resource.data?.profile;
  const enabled = Boolean(person?.profileEnabled);

  return <State data={resource}>{person?.isSelf && <div className="mt-2 space-y-2">
    <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">{enabled
      ? tx("登录用户可通过公开练习主页链接查看和发布留言。", "Signed-in users with your public practice profile link can read and leave messages there.")
      : tx("开启后，持有公开练习主页链接的登录用户可以看到你的榜单显示名并在该主页留言。", "Enable sharing to let signed-in users with your public practice profile link see your leaderboard name and leave messages there.")}</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" aria-describedby={descriptionId} disabled={action.busy || resource.loading} onClick={() => void action.run(async () => {
        await productionApi(`practice/profiles/${id}`, { method: "PATCH", body: { profileEnabled: !enabled } });
        resource.reload();
      })}>{enabled ? tx("关闭公开主页", "Turn off profile sharing") : tx("开启公开主页和留言", "Enable profile sharing and messages")}</Button>
      {enabled && showLink && <AppLink href={`/practice/people/${id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
        {tx("查看公开练习主页", "View public practice profile")}
      </AppLink>}
    </div>
    <Feedback action={action}/>
  </div>}</State>;
}

export function PublicPracticeProfileSharing({ accountId }: { accountId: string }) {
  const resource = useData<PracticeProfileSharing>(`practice/profiles/${encodeURIComponent(accountId)}`);
  return <ProfileSharingControls accountId={accountId} resource={resource} showLink/>;
}
