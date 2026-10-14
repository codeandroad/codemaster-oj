"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiMessage, productionApi } from "@/lib/production-api";

export const inputClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const panelClass = "rounded-lg border border-border bg-surface";
export function useData<T>(path: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{data: T | null; error: string; loading: boolean}>({data:null,error:"",loading:true});
  useEffect(() => {
    const controller = new AbortController();
    productionApi<T>(path,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({data,error:"",loading:false});}).catch(error=>{if(!controller.signal.aborted)setState(previous=>({...previous,error:apiMessage(error),loading:false}));});
    return ()=>controller.abort();
  },[path,revision]);
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  return {...state,reload};
}
export function useMutation() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  return {busy,error,message,success:setMessage,clear:()=>{setError("");setMessage("");},run:async(work:()=>Promise<void>)=>{setBusy(true);setError("");setMessage("");try{await work();}catch(e){setError(apiMessage(e));}finally{setBusy(false);}}};
}
export function Feedback({action}:{action:{error:string;message:string}}) {
  return <>{action.error&&<p role="alert" className="mt-3 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{action.error}</p>}{action.message&&<p role="status" className="mt-3 border border-success/30 bg-success-soft p-3 text-sm text-success">{action.message}</p>}</>;
}
export function Loading({resource,children}:{resource:{loading:boolean;error:string;reload:()=>void};children:ReactNode}) {
  if(resource.loading)return <p role="status" className="py-8 text-sm text-muted-foreground">正在加载…</p>;
  if(resource.error)return <div role="alert" className="mt-4 border border-destructive/30 p-4"><p className="text-sm text-destructive">{resource.error}</p><Button variant="secondary" className="mt-3" onClick={resource.reload}>重新加载</Button></div>;
  return children;
}
export function SearchInput({value,onChange,placeholder}:{value:string;onChange:(s:string)=>void;placeholder:string}) {
  return <label className="relative"><span className="sr-only">{placeholder}</span><Search className="absolute left-3 top-3 text-muted-foreground" size={15}/><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className={`${inputClass} pl-9`}/></label>;
}
export function Field({label,children}:{label:string;children:ReactNode}) {return <label className="block text-sm font-semibold"><span>{label}</span><div className="mt-2">{children}</div></label>;}
export function CopyCode({text,label="复制"}:{text:string;label?:string}) {
  const [done,setDone]=useState(false),[failed,setFailed]=useState(false);
  return <><Button size="sm" variant="ghost" aria-label={label} onClick={async()=>{try{await navigator.clipboard.writeText(text);setDone(true);setFailed(false);}catch{setFailed(true);setDone(false);}}}>{done?<Check size={14}/>:<Copy size={14}/>} {done?"已复制":label}</Button>{failed&&<span role="alert" className="text-xs text-destructive">复制失败，请选中文本手动复制。</span>}</>;
}
export function Modal({title,description,onClose,children,wide=false}:{title:string;description?:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className={`max-h-[90vh] overflow-y-auto bg-surface p-5 ${wide?"max-w-2xl":"max-w-xl"}`}><div className="pr-6"><DialogTitle>{title}</DialogTitle><DialogDescription className="mt-2">{description??"请核对信息后确认操作。"}</DialogDescription></div>{children}</DialogContent></Dialog>;
}
export function Drawer({title,eyebrow,onClose,children,wide=false}:{title:string;eyebrow?:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className={`left-auto right-0 top-0 flex h-dvh max-h-dvh w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-l bg-surface p-0 sm:rounded-none ${wide?"max-w-3xl":"max-w-xl"}`}><div className="border-b border-border p-5 pr-12">{eyebrow&&<p className="text-xs font-semibold uppercase text-primary">{eyebrow}</p>}<DialogTitle className="mt-1 text-xl">{title}</DialogTitle><DialogDescription className="sr-only">查看和管理此记录的资料</DialogDescription></div><div className="thin-scrollbar flex-1 overflow-y-auto p-5">{children}</div></DialogContent></Dialog>;
}
export function dateLabel(value?:string|null) {return value?new Date(value).toLocaleString("zh-CN",{hour12:false}):"无记录/未获取";}
