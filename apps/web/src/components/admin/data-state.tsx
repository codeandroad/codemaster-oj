"use client";

import { useCallback, useEffect, useState } from "react";
import { apiMessage, productionApi } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";

export const inputClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const panelClass = "rounded-lg border border-border bg-surface";
export function useData<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const request = `${revision}:${path}`;
  const [state, setState] = useState<{data: T | null; error: string; loading: boolean; completed?: string}>({data:null,error:"",loading:true});
  useEffect(() => {
    if(path===null){setState({data:null,error:"",loading:false,completed:request});return;}
    const controller = new AbortController();
    productionApi<T>(path,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({data,error:"",loading:false,completed:request});}).catch(error=>{if(!controller.signal.aborted)setState(previous=>({...previous,error:apiMessage(error),loading:false,completed:request}));});
    return ()=>controller.abort();
  },[path,request]);
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  const { completed, ...resource } = state;
  return path===null?{data:null,error:"",loading:false,pending:false,reload}:{...resource,pending:completed!==request,reload};
}
export function useMutation() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  return {busy,error,message,success:setMessage,clear:()=>{setError("");setMessage("");},run:async(work:()=>Promise<void>)=>{setBusy(true);setError("");setMessage("");try{await work();}catch(e){setError(apiMessage(e));}finally{setBusy(false);}}};
}
export function Feedback({action}:{action:{error:string;message:string}}) {
  const {t}=useLocale();
  return <>{action.error&&<p role="alert" className="mt-3 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{t(action.error)}</p>}{action.message&&<p role="status" className="mt-3 border border-success/30 bg-success-soft p-3 text-sm text-success">{t(action.message)}</p>}</>;
}
