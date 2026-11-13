"use client";
import Image from "next/image";
import {usePathname} from "next/navigation";
import {productionApi} from "@/lib/production-api";
import {useEffect,useRef,useState} from "react";
import {Settings,LogOut,ChevronDown,UserRound,Trophy,GraduationCap,ShieldCheck,BookOpen} from "lucide-react";
import {AppLink} from "@/components/navigation";
import type {CampusUser,CampusRole} from "@/lib/production-api";
import {useLocale} from "@/components/locale-context";

const legacyWorkspaces = {
 admin: {href:"/admin", label:"管理工作区", Icon:ShieldCheck},
 teacher: {href:"/teacher", label:"教学工作区", Icon:GraduationCap},
 student: {href:"/", label:"学生工作区", Icon:BookOpen},
} as const;

export function AccountMenu({user,role,busy,onLogout,settingsHref,profileHref,leaderboardHref}:{user:CampusUser;role?:CampusRole;busy:boolean;onLogout:()=>void;settingsHref?:string;profileHref?:string;leaderboardHref?:string}) {
 const {t}=useLocale();
 const pathname=usePathname();
 const settingsPath=settingsHref??(pathname.startsWith("/platform")?"/platform?section=settings":pathname.startsWith("/schools")?"/schools?section=personal-settings":role==="admin"?"/admin/personal-settings":role?`/${role}/settings`:"/practice/settings");
 const profilePath=profileHref??(pathname.startsWith("/platform")?"/platform?section=profile":pathname.startsWith("/schools")?"/schools?section=profile":role?`/${role}/profile`:"/practice/profile");
 const workspaceRoles = role || pathname === "/platform" ? (Object.keys(legacyWorkspaces) as CampusRole[]).filter(candidate =>
  candidate !== role && (user.roles.includes(candidate) || candidate === "teacher" && user.roles.includes("admin"))) : [];
 const [open,setOpen]=useState(false);
 const [points,setPoints]=useState<{accountId:string;value:number}|null>(null);
 const showPoints = role !== "admin" && role !== "teacher" && (role === "student" || !!leaderboardHref);
 useEffect(() => {
  if (!open || !showPoints) return;
  let active = true;
  void productionApi<{points:number}>("points/me")
   .then(({points}) => { if (active) setPoints({accountId:user.id,value:points}); })
   .catch(() => { if (active) setPoints(null); });
  return () => { active = false; };
 }, [open,showPoints,user.id]);
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 useEffect(()=>{if(!open)return;const dismiss=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener("pointerdown",dismiss);return()=>document.removeEventListener("pointerdown",dismiss);},[open]);
 useEffect(()=>{if(open)root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();},[open]);
 const item="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50";
 return <div ref={root} className="relative shrink-0" data-od-id="account-menu" onKeyDown={e=>{
  if(e.key==="Escape"&&open){e.preventDefault();close();}if(!open)return;
  const items=Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')??[]);const i=items.indexOf(document.activeElement as HTMLElement);
  if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();items[e.key==="Home"?0:e.key==="End"?items.length-1:(i+(e.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();}
 }}>
 <button ref={trigger} type="button" aria-label={t("用户账户菜单")} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);}}} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
 <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-muted font-semibold">{user.avatar?<Image src={user.avatar} unoptimized width={36} height={36} alt="" className="rounded-full"/>:Array.from((user.nickname||user.name).trim()||user.username).slice(0,1).join("").toUpperCase()}</span><ChevronDown size={14}/></button>
 {open&&<div role="menu" aria-label={t("账户选项")} className="absolute right-0 top-full z-50 mt-2 w-44 max-w-[calc(100vw-32px)] rounded-lg border border-border bg-surface p-1.5 text-foreground shadow-xl" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)&&e.relatedTarget!==trigger.current)setOpen(false);}}>
 <div className="border-b border-border px-2.5 py-2.5"><p className="break-words font-semibold">{user.nickname||user.name}</p><p className="break-all text-xs text-muted-foreground">{user.username}</p>{showPoints&&<p className="mt-2 text-sm">{t("平台积分")}：{points?.accountId===user.id?points.value:t("暂不可用")}</p>}</div><AppLink role="menuitem" href={profilePath} className={item} onNavigate={()=>setOpen(false)}><UserRound size={16} aria-hidden="true"/>{t("个人资料")}</AppLink>
 <AppLink role="menuitem" href={settingsPath} className={item} onNavigate={()=>setOpen(false)}><Settings size={16} aria-hidden="true"/>{t("个人设置")}</AppLink>
 {(role||leaderboardHref)&&<AppLink role="menuitem" href={leaderboardHref??`/${role}/points`} className={item} onNavigate={()=>setOpen(false)}><Trophy size={16} aria-hidden="true"/>{t("积分排行榜")}</AppLink>}
 {workspaceRoles.map(candidate=>{const {href,label,Icon}=legacyWorkspaces[candidate];return <AppLink role="menuitem" key={candidate} href={href} className={item} onNavigate={()=>setOpen(false)}><Icon size={16} aria-hidden="true"/>{t(label)}</AppLink>;})}
 <button role="menuitem" type="button" className={item} disabled={busy} onClick={onLogout}><LogOut size={16}/>{t(busy?"正在退出…":"退出登录")}</button>
 </div>}
 </div>;
}
