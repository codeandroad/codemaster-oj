"use client";

import Image from "next/image";
import type { ReactNode } from "react";

export function ProfileAvatar({ avatar, nickname, large = false }: { avatar?: string | null; nickname: string; large?: boolean }) {
  const size = large ? 112 : 36;
  const className = large
    ? "size-24 rounded-xl border-4 border-surface object-cover shadow-sm sm:size-28"
    : "size-9 rounded-full object-cover";
  if (avatar) return <Image src={avatar} unoptimized width={size} height={size} alt="" className={className}/>;
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center bg-accent font-semibold text-primary ${large ? "size-24 rounded-xl border-4 border-surface text-3xl shadow-sm sm:size-28" : "size-9 rounded-full text-sm"}`}>
    {nickname.trim().slice(0, 1) || "同"}
  </span>;
}

export function ProfileHero({ avatar, nickname, bio, actions, children, self = false, selfLabel = "我的主页" }: {
  avatar?: string | null;
  nickname: string;
  bio?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
  self?: boolean;
  selfLabel?: string;
}) {
  return <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-label={`${nickname}的个人资料`}>
    <div className="relative h-36 overflow-hidden bg-[#16355a] sm:h-40" aria-hidden="true">
      <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(90deg,transparent_23px,rgba(255,255,255,.09)_24px),linear-gradient(transparent_23px,rgba(255,255,255,.09)_24px)] [background-size:24px_24px]"/>
      <div className="absolute -right-12 -top-28 size-80 rounded-full border border-white/15 sm:right-10"/>
      <div className="absolute -right-20 -top-20 size-80 rounded-full border border-white/15 sm:right-0"/>
      <span className="absolute right-5 top-0 font-mono text-[110px] font-bold tracking-[-.16em] text-white/15 sm:right-16 sm:text-[145px]">{"</>"}</span>
      <span className="absolute left-5 top-4 text-xs font-semibold tracking-wide text-white/75 sm:left-7">CodeMaster OJ · 校内编程档案</span>
    </div>
    <div className="px-5 pb-5 sm:px-7 sm:pb-6">
      <div className="-mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
        <div className="relative z-10"><ProfileAvatar avatar={avatar} nickname={nickname} large/></div>
        {actions && <div className="flex flex-wrap gap-2 pb-1">{actions}</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h2 className="break-words text-2xl font-bold leading-tight sm:text-[28px]">{nickname}</h2>
        {self && <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-primary">{selfLabel}</span>}
      </div>
      <p className="mt-2 max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{bio?.trim() || (self ? "写一句介绍，让大家更了解你。" : "这位同学还没有填写个人介绍。")}</p>
      {children}
    </div>
  </section>;
}
