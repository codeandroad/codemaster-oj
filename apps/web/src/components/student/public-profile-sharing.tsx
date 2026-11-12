"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { Feedback, State, panel, useData, useMutation } from "./shared";

export function ProfileSharingControls({ endpoint, enabled, loading, reload }: {
  endpoint: string;
  enabled: boolean;
  loading: boolean;
  reload: () => void;
}) {
  const { locale } = useLocale();
  const action = useMutation();
  const descriptionId = useId();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;

  return <div className="mt-2 space-y-2">
    <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">{enabled
      ? tx("登录用户可通过公开主页链接查看和发布留言。", "Signed-in users with your public profile link can read and leave messages.")
      : tx("开启后，持有主页链接的登录用户可以看到你的榜单显示名并留言。", "Enable sharing to let signed-in users with your profile link see your leaderboard name and leave messages.")}</p>
    <Button size="sm" variant="secondary" aria-describedby={descriptionId} disabled={action.busy || loading} onClick={() => void action.run(async () => {
      await productionApi(endpoint, { method: "PATCH", body: { profileEnabled: !enabled } });
      reload();
    })}>{enabled ? tx("关闭公开主页", "Turn off profile sharing") : tx("开启公开主页和留言", "Enable profile sharing and messages")}</Button>
    <Feedback action={action}/>
  </div>;
}

export function PublicPracticeProfileSharing({ accountId }: { accountId: string }) {
  const { locale } = useLocale();
  const titleId = useId();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const id = encodeURIComponent(accountId);
  const endpoint = `practice/profiles/${id}`;
  const resource = useData<{ profile: { isSelf: boolean; profileEnabled: boolean } }>(endpoint);
  const person = resource.data?.profile;

  return <section className={`${panel} mt-5`} aria-labelledby={titleId}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={titleId} className="font-bold">{tx("公开练习主页", "Public practice profile")}</h2>
      {person?.profileEnabled && <AppLink href={`/practice/people/${id}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
        {tx("查看公开练习主页", "View public practice profile")}
      </AppLink>}
    </div>
    <State data={resource}>
      {person?.isSelf && <ProfileSharingControls endpoint={endpoint} enabled={person.profileEnabled} loading={resource.loading} reload={resource.reload}/>}
    </State>
  </section>;
}
