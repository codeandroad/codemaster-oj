"use client";
import Image from "next/image";
import {productionApi} from "@/lib/production-api";
import {useEffect,useRef,useState} from "react";
import {Settings,LogOut,ChevronDown} from "lucide-react";
import {AppLink} from "@/components/navigation";
import type {CampusUser,CampusRole} from "@/lib/production-api";

export function AccountMenu({user,role,busy,onLogout}:{user:CampusUser;role:CampusRole;busy:boolean;onLogout:()=>void}) {
 const [open,setOpen]=useState(false),[points,setPoints]=useState<number|null>(null);
 useEffect(()=>{if(!open||role!=="student")return;let active=true;void productionApi<{points:number}>("points/me").then(r=>{if(active)setPoints(r.points);}).catch(()=>{if(active)setPoints(null);});return()=>{active=false;};},[open,role]);const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);
 const close=()=>{setOpen(false);trigger.current?.focus();};
 useEffect(()=>{if(!open)return;const dismiss=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener("pointerdown",dismiss);return()=>document.removeEventListener("pointerdown",dismiss);},[open]);
 useEffect(()=>{if(open)root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();},[open]);
 const roles=[...new Set([...user.roles,...(user.roles.includes("admin")?["teacher" as CampusRole]:[])])].filter(r=>r!==role);
 const item="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50";
 return <div ref={root} className="relative shrink-0" data-od-id="account-menu" onKeyDown={e=>{
  if(e.key==="Escape"&&open){e.preventDefault();close();}if(!open)return;
  const items=Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')??[]);const i=items.indexOf(document.activeElement as HTMLElement);
  if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();items[e.key==="Home"?0:e.key==="End"?items.length-1:(i+(e.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();}
 }}>
 <button ref={trigger} type="button" aria-label="用户账户菜单" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);}}} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
 <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-muted font-semibold">{user.avatar?<Image src={user.avatar} unoptimized width={36} height={36} alt="" className="rounded-full"/>:Array.from((user.nickname||user.name).trim()||user.username).slice(0,1).join("").toUpperCase()}</span><ChevronDown size={14}/></button>
 {open&&<div role="menu" aria-label="账户选项" className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-32px)] rounded-lg border border-border bg-surface p-2 text-foreground shadow-xl" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)&&e.relatedTarget!==trigger.current)setOpen(false);}}>
 <div className="border-b border-border px-3 py-3"><p className="break-words font-semibold">{user.nickname||user.name}</p><p className="break-all text-xs text-muted-foreground">{user.username}</p>{role==="student"&&<p className="mt-2 text-sm">积分：{points??"暂不可用"}</p>}</div><AppLink role="menuitem" href={`/${role}/profile`} className={item} onNavigate={()=>setOpen(false)}>个人资料</AppLink><AppLink role="menuitem" href={`/${role}/points`} className={item} onNavigate={()=>setOpen(false)}>{role==="student"?"积分排行榜":"排行榜与任务奖励"}</AppLink>
 <AppLink role="menuitem" href={role==="admin"?"/admin/settings":`/${role}/settings`} className={item} onNavigate={()=>setOpen(false)}><Settings size={16}/>设置</AppLink>
 {roles.map(r=><AppLink role="menuitem" key={r} href={r==="student"?"/":`/${r}`} className={item} onNavigate={()=>setOpen(false)}>{r==="admin"?"管理工作区":r==="teacher"?"教学工作区":"学生工作区"}</AppLink>)}
 <button role="menuitem" type="button" className={item} disabled={busy} onClick={onLogout}><LogOut size={16}/>{busy?"正在退出…":"退出登录"}</button>
 </div>}
 </div>;
}
