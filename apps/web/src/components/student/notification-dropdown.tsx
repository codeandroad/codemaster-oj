"use client";
import {useEffect,useRef,useState} from "react";
import {Bell,Inbox} from "lucide-react";
import {AppLink} from "@/components/navigation";
import {useData} from "./shared";
import type {Assignment} from "@/lib/production-api";

export function NotificationDropdown(){
 const [open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0,width:360});const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const assignments=useData<{items:Assignment[]}>("assignments"),site=useData<{announcement:string}>("site-info");
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};document.addEventListener("pointerdown",outside);return()=>document.removeEventListener("pointerdown",outside);},[open]);
 return <div ref={root} className="relative shrink-0" data-od-id="notification-dropdown" onKeyDown={e=>{if(e.key==="Escape"&&open){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus();}}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
 <button ref={trigger} type="button" aria-label="通知" title="通知" aria-expanded={open} aria-controls="classroom-notifications" onClick={()=>{const rect=trigger.current?.getBoundingClientRect();if(rect){const width=Math.min(360,window.innerWidth-24);setPosition({width,left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),top:rect.bottom+8});}setOpen(!open);if(!open){assignments.reload();site.reload();}}} className="grid h-11 w-11 place-items-center rounded-md text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><Bell size={19} strokeWidth={1.7}/></button>
 {open&&<section id="classroom-notifications" aria-label="通知列表" style={{position:"fixed",...position}} className=" z-[60] w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-xl">
 <header className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">通知</h2><p className="mt-1 text-xs text-muted-foreground">站点公告与作业提醒</p></header>
 <div className="max-h-[min(480px,70dvh)] overflow-y-auto">
 {site.data?.announcement&&<article className="border-b border-border px-4 py-4"><h3 className="text-sm font-semibold">站点公告</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{site.data.announcement}</p></article>}
 {(assignments.loading||site.loading)?<p role="status" className="p-5 text-sm text-muted-foreground">正在加载…</p>:(assignments.error||site.error)?<div role="alert" className="p-4 text-sm"><p className="text-destructive">{assignments.error||site.error}</p><button type="button" className="mt-2 min-h-11 rounded border border-border px-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" onClick={()=>{assignments.reload();site.reload();}}>重试</button></div>:<>{assignments.data?.items.map(a=><AppLink key={a.id} href={`/student/assignments/${a.id}`} onNavigate={()=>setOpen(false)} className="block border-b border-border px-4 py-4 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><p className="break-words text-sm font-medium">{a.title}</p><p className="mt-1 text-xs text-muted-foreground">截止：{new Date(a.dueAt).toLocaleString("zh-CN",{hour12:false})}</p></AppLink>)}{!assignments.data?.items.length&&!site.data?.announcement&&<div className="flex min-h-36 flex-col items-center justify-center gap-3 px-4 py-6 text-muted-foreground"><Inbox size={28} strokeWidth={1.4}/><p className="text-sm">暂无通知</p></div>}</>}
 </div><footer className="px-4 py-2"><AppLink href="/student/assignments" onNavigate={()=>setOpen(false)} className="flex min-h-11 items-center justify-center rounded-md text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">查看全部作业</AppLink></footer>
 </section>}
 </div>;
}
