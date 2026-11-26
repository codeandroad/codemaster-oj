"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { apiMessage, productionApi } from "@/lib/production-api";
import { useLocale } from "./locale-context";
import { ProfileCoverArtwork } from "./profile-hero";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "./ui/dialog";

async function prepareCover(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / image.naturalWidth, 900 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const prefix = "data:image/jpeg;base64,";
    const maxEncodedLength = prefix.length + 4 * Math.floor(512 * 1024 / 3);
    for (const quality of [0.85, 0.65, 0.45]) {
      const jpeg = canvas.toDataURL("image/jpeg", quality);
      if (jpeg.startsWith(prefix) && jpeg.length <= maxEncodedLength) return jpeg;
    }
    throw new Error("Cover exceeds the upload limit");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfileCoverEditor({ coverImage, onSaved }: { coverImage?: string; onSaved: () => void }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = zh ? "更换封面" : "Change cover";

  async function choose(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(zh ? "请选择 5 MB 以内的 JPEG、PNG 或 WebP 图片。" : "Choose a JPEG, PNG or WebP image up to 5 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setDraft(await prepareCover(file));
    } catch {
      setError(zh ? "无法处理这张图片，请换一张再试。" : "Could not process this image. Choose another file.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await productionApi("account/profile-cover", { method: "PATCH", body: { coverImage: draft } });
      onSaved();
      setOpen(false);
    } catch (reason) {
      setError(apiMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={next => {
    if (busy) return;
    if (next) { setDraft(coverImage ?? null); setError(""); }
    setOpen(next);
  }}>
    <DialogTrigger asChild><Button type="button" size="sm" className="bg-black/70 text-white hover:bg-black/85 focus-visible:ring-white">
      <Camera size={15} aria-hidden="true"/>{title}
    </Button></DialogTrigger>
    <DialogContent>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{zh ? "选择横向图片，最多 5 MB。封面在校内主页和公开练习主页共用。" : "Choose a landscape image up to 5 MB. Your school and practice profiles use the same cover."}</DialogDescription>
      <div className="relative aspect-[4/1] overflow-hidden rounded-md" role="img" aria-label={zh ? "封面预览" : "Cover preview"}>
        <ProfileCoverArtwork image={draft}/>
      </div>
      <label className="grid gap-2 text-sm font-medium">{zh ? "选择图片" : "Choose image"}
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="min-w-0 rounded-sm file:mr-2 file:rounded-md file:border file:border-border file:bg-surface-subtle file:px-3 file:py-2 focus-visible:outline-2 focus-visible:outline-primary"
          onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void choose(file); }}/>
      </label>
      {draft && <Button type="button" size="sm" variant="ghost" className="justify-self-start" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>{zh ? "恢复默认封面" : "Restore default cover"}</Button>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="secondary" disabled={busy}>{zh ? "取消" : "Cancel"}</Button></DialogClose>
        <Button type="button" disabled={busy || draft === (coverImage ?? null)} onClick={() => void save()}>{zh ? "保存封面" : "Save cover"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
