"use client";

import { Camera, Pencil, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { ProfileAvatar, ProfileHero } from "./profile-hero";
import { defaultAvatarPath, randomDefaultAvatarPath } from "@/lib/default-avatars";
import { genderLabel, genderOptions } from "@/lib/gender";
import { apiMessage, productionApi, type AuthResponse, type CampusGender, type CampusUser } from "@/lib/production-api";

const control = "min-h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25";
const editRow = "grid gap-2 border-b border-border py-4 sm:grid-cols-[135px_minmax(0,1fr)] sm:gap-5";

function currentGender(user: CampusUser): CampusGender | "" {
  return user.gender ?? "";
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-0.5 border-b border-border py-2.5 last:border-b-0 sm:grid-cols-[135px_minmax(0,1fr)] sm:gap-5">
    <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-sm font-medium">{children}</dd>
  </div>;
}

export function ProfileEditor({ user, onSaved }: { user: CampusUser; onSaved?: (next: CampusUser) => void }) {
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatar, setAvatar] = useState(user.avatar ?? "");
  const [gender, setGender] = useState<CampusGender | "">(currentGender(user));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const displayName = (editing ? nickname : user.nickname)?.trim() || (user.roles.includes("student") ? "同学" : "校内用户");
  const roleName = user.roles.includes("admin") ? "管理员" : user.roles.includes("teacher") ? "教师" : "学生";

  function resetDraft() {
    setNickname(user.nickname ?? "");
    setBio(user.bio ?? "");
    setAvatar(user.avatar ?? "");
    setGender(currentGender(user));
    setEditing(false);
    setError("");
  }

  function loadAvatar(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("图片不能超过 5 MB。"); return; }
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) { setError("当前浏览器无法处理图片，请换用其他浏览器。"); URL.revokeObjectURL(url); return; }
      const size = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256);
      setAvatar(canvas.toDataURL("image/jpeg", 0.8));
      setError("");
      URL.revokeObjectURL(url);
    };
    image.onerror = () => { URL.revokeObjectURL(url); setError("无法读取图片，请选择 JPEG、PNG 或 WebP 图片。"); };
    image.src = url;
  }

  function save() {
    setBusy(true); setMessage(""); setError("");
    void productionApi<AuthResponse>("auth/profile", { method: "PATCH", body: { nickname: nickname.trim(), bio: bio.trim(), avatar, gender: gender || null } })
      .then(result => {
        setNickname(result.user.nickname ?? "");
        setBio(result.user.bio ?? "");
        setAvatar(result.user.avatar ?? "");
        setGender(currentGender(result.user));
        setEditing(false);
        setMessage("个人资料已保存。");
        onSaved?.(result.user);
      })
      .catch(reason => setError(apiMessage(reason)))
      .finally(() => setBusy(false));
  }

  return <div className="mt-5 space-y-4">
    <h1 className="sr-only">个人资料</h1>
    <ProfileHero avatar={editing ? avatar : user.avatar} nickname={displayName} bio={editing ? bio : user.bio} self selfLabel="我的资料" actions={editing ? undefined : <Button type="button" variant="outline" onClick={() => { setMessage(""); setEditing(true); }}><Pencil size={15}/>编辑个人资料</Button>}>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">昵称、头像和介绍对校内用户可见。身份资料仅在你的账号页面显示。</p>
    </ProfileHero>

    {editing ? <form className="rounded-xl border border-border bg-surface px-5 py-5 sm:px-7" onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
        <div><h3 className="text-lg font-bold">编辑个人资料</h3><p className="mt-1 text-sm text-muted-foreground">选择头像，填写同学能看到的昵称和介绍。</p></div>
        <Button type="button" variant="ghost" size="sm" onClick={resetDraft} disabled={busy}><X size={15}/>取消</Button>
      </div>
      <div className={editRow}>
        <span className="pt-1 text-sm font-medium text-muted-foreground">头像</span>
        <div className="flex flex-wrap items-center gap-4">
          <ProfileAvatar avatar={avatar} nickname={displayName} large/>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 text-sm font-semibold hover:bg-muted focus-within:ring-2 focus-within:ring-ring"><Camera size={15}/>上传头像<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => { loadAvatar(event.target.files?.[0]); event.target.value = ""; }}/></label>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAvatar(randomDefaultAvatarPath(avatar))}>换一个预设头像</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAvatar(defaultAvatarPath(user.identityId))}>使用默认头像</Button>
          </div>
          <p className="w-full text-xs text-muted-foreground">支持 JPEG、PNG、WebP，最大 5 MB；图片会裁剪为正方形。</p>
        </div>
      </div>
      <label className={editRow + " sm:items-center"}><span className="text-sm font-medium text-muted-foreground">昵称</span><input className={control} value={nickname} maxLength={40} onChange={event => setNickname(event.target.value)} placeholder="填写公开昵称"/></label>
      <label className={editRow + " sm:items-center"}><span className="text-sm font-medium text-muted-foreground">性别</span><select className={control} value={gender} onChange={event => setGender(event.target.value as CampusGender | "")}><option value="">未填写</option>{genderOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className={editRow}><span className="pt-2 text-sm font-medium text-muted-foreground">个人介绍</span><span><textarea className={control} value={bio} maxLength={500} rows={4} onChange={event => setBio(event.target.value)} placeholder="介绍你的编程兴趣或正在学习的内容"/><span className="mt-1 block text-right text-xs text-muted-foreground">{bio.length} / 500</span></span></label>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">姓名和身份编号由管理员维护；性别仅显示在你的身份资料中。</p>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy}>{busy ? "正在保存…" : "保存修改"}</Button><Button type="button" variant="secondary" disabled={busy} onClick={resetDraft}>取消</Button></div>
    </form> : <section className="rounded-xl border border-border bg-surface px-5 py-4 sm:px-7" aria-labelledby="profile-details-heading">
      <div className="border-b border-border pb-3"><h3 id="profile-details-heading" className="text-lg font-bold">资料详情</h3><p className="mt-1 text-sm text-muted-foreground">账号与身份信息仅供本人查看。</p></div>
      <dl>
        <Detail label="真实姓名">{user.name}</Detail>
        <Detail label="身份">{roleName}</Detail>
        <Detail label="身份编号">{user.number || "—"}</Detail>
        <Detail label="用户名">{user.username}</Detail>
        <Detail label="性别">{genderLabel(user.gender)}</Detail>
        <Detail label="个人介绍">{user.bio?.trim() || "未填写"}</Detail>
      </dl>
      {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    </section>}
  </div>;
}
