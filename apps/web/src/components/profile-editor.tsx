"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "./ui/button";
import { apiMessage, productionApi, type AuthResponse, type CampusUser } from "@/lib/production-api";

export function ProfileEditor({ user, onSaved }: { user: CampusUser; onSaved?: (next: CampusUser) => void }) {
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatar, setAvatar] = useState(user.avatar ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function loadAvatar(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("原图不能超过 5 MB。"); return; }
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (context) {
        const size = Math.min(image.width, image.height);
        context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256);
        setAvatar(canvas.toDataURL("image/jpeg", 0.8));
        setError("");
      }
      URL.revokeObjectURL(url);
    };
    image.onerror = () => { URL.revokeObjectURL(url); setError("无法读取图片。"); };
    image.src = url;
  }

  return <section className="rounded-lg border border-border bg-surface p-5">
    <h2 className="font-semibold">公开资料</h2>
    <p className="mt-1 text-sm text-muted-foreground">昵称、头像和个人介绍会显示在公开主页。实名身份由管理员维护。</p>
    <form className="mt-4 grid gap-4" onSubmit={event => {
      event.preventDefault(); setBusy(true); setMessage(""); setError("");
      void productionApi<AuthResponse>("auth/profile", { method: "PATCH", body: { nickname, bio, avatar } })
        .then(result => { onSaved?.(result.user); setMessage("公开资料已保存。"); })
        .catch(reason => setError(apiMessage(reason)))
        .finally(() => setBusy(false));
    }}>
      <div className="flex flex-wrap items-center gap-3">
        {avatar ? <Image src={avatar} unoptimized width={64} height={64} alt="头像预览" className="size-16 rounded-full object-cover"/> : <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-accent text-xl">{nickname.trim().slice(0, 1) || "学"}</span>}
        <label className="text-sm">上传头像<input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block" onChange={event => loadAvatar(event.target.files?.[0])}/></label>
        <Button type="button" variant="ghost" onClick={() => setAvatar("")}>恢复默认头像</Button>
      </div>
      <label className="text-sm">昵称<input value={nickname} maxLength={40} onChange={event => setNickname(event.target.value)} className="mt-1 block w-full rounded border border-border bg-surface p-2"/></label>
      <label className="text-sm">个人介绍<textarea value={bio} maxLength={500} rows={3} onChange={event => setBio(event.target.value)} className="mt-1 block w-full rounded border border-border bg-surface p-2"/></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-success">{message}</p>}
      <Button type="submit" disabled={busy}>{busy ? "正在保存…" : "保存资料"}</Button>
    </form>
  </section>;
}
