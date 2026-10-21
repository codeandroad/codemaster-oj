"use client";

import { Camera, Pencil, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { ProfileAvatar, ProfileHero } from "./profile-hero";
import { defaultAvatarPath, randomDefaultAvatarPath } from "@/lib/default-avatars";
import { genderLabel, genderOptions } from "@/lib/gender";
import { apiMessage, productionApi, type AuthResponse, type CampusGender, type CampusUser } from "@/lib/production-api";
import { useLocale, type AppLocale } from "./locale-context";

const control = "min-h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25";
const editRow = "grid gap-2 border-b border-border py-4 sm:grid-cols-[135px_minmax(0,1fr)] sm:gap-5";
const ui = (locale: AppLocale, zh: string, en: string) => locale === "en" ? en : zh;
const englishGender: Record<CampusGender, string> = { male: "Male", female: "Female", other: "Other", undisclosed: "Prefer not to say" };

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
  const { locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [showNicknameOnLeaderboard, setShowNicknameOnLeaderboard] = useState(user.showNicknameOnLeaderboard ?? false);
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatar, setAvatar] = useState(user.avatar ?? "");
  const [gender, setGender] = useState<CampusGender | "">(currentGender(user));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const displayName = (editing ? nickname : user.nickname)?.trim() || (user.roles.includes("student") ? ui(locale, "同学", "Student") : ui(locale, "校内用户", "School user"));
  const roleName = user.roles.includes("admin") ? ui(locale, "管理员", "Administrator") : user.roles.includes("teacher") ? ui(locale, "教师", "Teacher") : ui(locale, "学生", "Student");

  function resetDraft() {
    setNickname(user.nickname ?? "");
    setShowNicknameOnLeaderboard(user.showNicknameOnLeaderboard ?? false);
    setBio(user.bio ?? "");
    setAvatar(user.avatar ?? "");
    setGender(currentGender(user));
    setEditing(false);
    setError("");
  }

  function loadAvatar(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError(ui(locale, "图片不能超过 5 MB。", "Image must be 5 MB or smaller.")); return; }
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) { setError(ui(locale, "当前浏览器无法处理图片，请换用其他浏览器。", "This browser cannot process the image. Try another browser.")); URL.revokeObjectURL(url); return; }
      const size = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256);
      setAvatar(canvas.toDataURL("image/jpeg", 0.8));
      setError("");
      URL.revokeObjectURL(url);
    };
    image.onerror = () => { URL.revokeObjectURL(url); setError(ui(locale, "无法读取图片，请选择 JPEG、PNG 或 WebP 图片。", "Could not read the image. Choose a JPEG, PNG, or WebP file.")); };
    image.src = url;
  }

  function save() {
    setBusy(true); setMessage(""); setError("");
    void productionApi<AuthResponse>("auth/profile", { method: "PATCH", body: { showNicknameOnLeaderboard: showNicknameOnLeaderboard && !!nickname.trim(), nickname: nickname.trim(), bio: bio.trim(), avatar, gender: gender || null } })
      .then(result => {
        setNickname(result.user.nickname ?? "");
        setShowNicknameOnLeaderboard(result.user.showNicknameOnLeaderboard ?? false);
        setBio(result.user.bio ?? "");
        setAvatar(result.user.avatar ?? "");
        setGender(currentGender(result.user));
        setEditing(false);
        setMessage("saved");
        onSaved?.(result.user);
      })
      .catch(reason => setError(apiMessage(reason)))
      .finally(() => setBusy(false));
  }

  return <div className="mt-5 space-y-4">
    <h1 className="sr-only">{ui(locale, "个人资料", "Profile")}</h1>
    <ProfileHero avatar={editing ? avatar : user.avatar} nickname={displayName} bio={editing ? bio : user.bio} self selfLabel={ui(locale, "我的资料", "My profile")} actions={editing ? undefined : <Button type="button" variant="outline" onClick={() => { setMessage(""); setEditing(true); }}><Pencil size={15}/>{ui(locale, "编辑个人资料", "Edit profile")}</Button>}>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{ui(locale, "昵称、头像和介绍对校内用户可见。排行榜默认显示姓名，可在下方编辑资料时改为显示昵称。", "Your nickname, avatar, and bio are visible to school users. The leaderboard uses your full name unless you enable nickname display below.")}</p>
    </ProfileHero>

    {editing ? <form className="rounded-xl border border-border bg-surface px-5 py-5 sm:px-7" onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
        <div><h3 className="text-lg font-bold">{ui(locale, "编辑个人资料", "Edit profile")}</h3><p className="mt-1 text-sm text-muted-foreground">{ui(locale, "选择头像，填写同学能看到的昵称和介绍。", "Choose an avatar and enter the nickname and bio your classmates will see.")}</p></div>
        <Button type="button" variant="ghost" size="sm" onClick={resetDraft} disabled={busy}><X size={15}/>{ui(locale, "取消", "Cancel")}</Button>
      </div>
      <div className={editRow}>
        <span className="pt-1 text-sm font-medium text-muted-foreground">{ui(locale, "头像", "Avatar")}</span>
        <div className="flex flex-wrap items-center gap-4">
          <ProfileAvatar avatar={avatar} nickname={displayName} large/>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 text-sm font-semibold hover:bg-muted focus-within:ring-2 focus-within:ring-ring"><Camera size={15}/>{ui(locale, "上传头像", "Upload avatar")}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => { loadAvatar(event.target.files?.[0]); event.target.value = ""; }}/></label>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAvatar(randomDefaultAvatarPath(avatar))}>{ui(locale, "换一个预设头像", "Try another preset")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAvatar(defaultAvatarPath(user.identityId))}>{ui(locale, "使用默认头像", "Use default avatar")}</Button>
          </div>
          <p className="w-full text-xs text-muted-foreground">{ui(locale, "支持 JPEG、PNG、WebP，最大 5 MB；图片会裁剪为正方形。", "JPEG, PNG, and WebP up to 5 MB. Images are cropped to a square.")}</p>
        </div>
      </div>
      <label className={editRow + " sm:items-center"}><span className="text-sm font-medium text-muted-foreground">{ui(locale, "昵称", "Nickname")}</span><input className={control} value={nickname} maxLength={40} onChange={event => { setNickname(event.target.value); if (!event.target.value.trim()) setShowNicknameOnLeaderboard(false); }} placeholder={ui(locale, "填写公开昵称", "Enter a public nickname")}/></label>
      {user.roles.includes("student") && <div className={editRow}><span className="text-sm font-medium text-muted-foreground">{ui(locale, "排行榜姓名", "Leaderboard name")}</span><div><label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={showNicknameOnLeaderboard} disabled={!nickname.trim()} onChange={event => setShowNicknameOnLeaderboard(event.target.checked)} className="h-4 w-4 accent-primary"/>{ui(locale, "在排行榜中显示昵称", "Show my nickname on the leaderboard")}</label><p className="text-xs text-muted-foreground">{ui(locale, "默认显示学生姓名；填写昵称并开启后使用昵称。", "Your full name is shown by default. Enter a nickname and enable this option to use it instead.")}</p></div></div>}
      <label className={editRow + " sm:items-center"}><span className="text-sm font-medium text-muted-foreground">{ui(locale, "性别", "Gender")}</span><select className={control} value={gender} onChange={event => setGender(event.target.value as CampusGender | "")}><option value="">{ui(locale, "未填写", "Not provided")}</option>{genderOptions.map(option => <option key={option.value} value={option.value}>{ui(locale, option.label, englishGender[option.value])}</option>)}</select></label>
      <label className={editRow}><span className="pt-2 text-sm font-medium text-muted-foreground">{ui(locale, "个人介绍", "Bio")}</span><span><textarea className={control} value={bio} maxLength={500} rows={4} onChange={event => setBio(event.target.value)} placeholder={ui(locale, "介绍你的编程兴趣或正在学习的内容", "Tell others about your coding interests or what you're learning")}/><span className="mt-1 block text-right text-xs text-muted-foreground">{bio.length} / 500</span></span></label>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{ui(locale, "姓名和身份编号由管理员维护；性别仅显示在你的身份资料中。", "Your name and school ID are maintained by an administrator. Gender is only shown in your private identity details.")}</p>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy}>{busy ? ui(locale, "正在保存…", "Saving…") : ui(locale, "保存修改", "Save changes")}</Button><Button type="button" variant="secondary" disabled={busy} onClick={resetDraft}>{ui(locale, "取消", "Cancel")}</Button></div>
    </form> : <section className="rounded-xl border border-border bg-surface px-5 py-4 sm:px-7" aria-labelledby="profile-details-heading">
      <div className="border-b border-border pb-3"><h3 id="profile-details-heading" className="text-lg font-bold">{ui(locale, "资料详情", "Profile details")}</h3><p className="mt-1 text-sm text-muted-foreground">{ui(locale, "账号与身份信息仅供本人查看。", "Account and identity details are visible only to you.")}</p></div>
      <dl>
        <Detail label={ui(locale, "真实姓名", "Full name")}>{user.name}</Detail>
        {user.roles.includes("student") && <Detail label={ui(locale, "排行榜姓名", "Leaderboard name")}>{user.showNicknameOnLeaderboard && user.nickname?.trim() ? user.nickname : user.name}</Detail>}
        <Detail label={ui(locale, "身份", "Role")}>{roleName}</Detail>
        <Detail label={ui(locale, "身份编号", "School ID")}>{user.number || "—"}</Detail>
        <Detail label={ui(locale, "用户名", "Username")}>{user.username}</Detail>
        <Detail label={ui(locale, "性别", "Gender")}>{user.gender ? ui(locale, genderLabel(user.gender), englishGender[user.gender]) : ui(locale, "未填写", "Not provided")}</Detail>
        <Detail label={ui(locale, "个人介绍", "Bio")}>{user.bio?.trim() || ui(locale, "未填写", "Not provided")}</Detail>
      </dl>
      {message && <p role="status" className="mt-3 text-sm text-success">{message === "saved" ? ui(locale, "个人资料已保存。", "Profile saved.") : message}</p>}
    </section>}
  </div>;
}
