"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiMessage, apiRequestTimeoutMs, isApiConnectionError, productionApi } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";

export const inputClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const panelClass = "rounded-lg border border-border bg-surface";
export function useData<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const request = `${revision}:${path}`;
  const [state, setState] = useState<{data: T | null; error: string; connectionError: boolean; loading: boolean; completed?: string}>({data:null,error:"",connectionError:false,loading:true});
  const reload=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(() => {
    if(path===null){setState({data:null,error:"",connectionError:false,loading:false,completed:request});return;}
    const controller = new AbortController();
    setState(previous=>({...previous,error:"",connectionError:false,loading:previous.data===null}));
    productionApi<T>(path,{signal:controller.signal,timeoutMs:apiRequestTimeoutMs}).then(data=>{if(!controller.signal.aborted)setState({data,error:"",connectionError:false,loading:false,completed:request});}).catch(error=>{if(!controller.signal.aborted){const connectionError=isApiConnectionError(error);setState(previous=>({data:error instanceof ApiError&&(error.status===403||error.status===404)?null:previous.data,error:apiMessage(error),connectionError,loading:false,completed:request}));}});
    return ()=>controller.abort();
  },[path,request]);
  useEffect(() => {
    if (path === null || (!state.connectionError && state.completed === request)) return;
    const recover = () => reload();
    window.addEventListener("online", recover);
    return () => window.removeEventListener("online", recover);
  }, [path, state.connectionError, state.completed, request, reload]);
  const { completed, ...resource } = state;
  return path===null?{data:null,error:"",connectionError:false,loading:false,pending:false,reload}:{...resource,pending:completed!==request,reload};
}
export function useMutation() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  return {busy,error,message,success:setMessage,clear:()=>{setError("");setMessage("");},run:async(work:()=>Promise<void>)=>{setBusy(true);setError("");setMessage("");try{await work();}catch(e){setError(apiMessage(e));}finally{setBusy(false);}}};
}
export function Feedback({action}:{action:{error:string;message:string}}) {
  const {t}=useLocale();
  return <>{action.error&&<p role="alert" className="mt-3 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{t(action.error)}</p>}{action.message&&<p role="status" className="mt-3 border border-success/30 bg-success-soft p-3 text-sm text-success">{t(action.message)}</p>}</>;
}
