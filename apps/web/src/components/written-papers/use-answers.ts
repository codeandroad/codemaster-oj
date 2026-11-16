"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError,apiMessage,productionApi } from '@/lib/production-api';
import { useNavigationBlocker } from '@/components/navigation';
import type { Answers,Attempt } from './model';

export function useAnswers(attempt:Attempt,path:string){
 const [answers,setAnswers]=useState(attempt.answers),[saved,setSaved]=useState(JSON.stringify(attempt.answers));
 const [saving,setSaving]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 const current=useRef(answers),baseline=useRef(saved),revision=useRef(attempt.revision);
 const running=useRef<Promise<number>|null>(null);
 const pending=useRef<{expectedRevision:number;requestId:string;answers:Answers}|null>(null);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const change=useCallback((next:Answers)=>{current.current=next;setAnswers(next);},[]);
 const save=useCallback(async()=>{
  if(running.current)return running.current;
  const work=async()=>{
   setSaving(true);setError('');
   try{
    while(pending.current||JSON.stringify(current.current)!==baseline.current){
     const request=pending.current??{expectedRevision:revision.current,requestId:crypto.randomUUID(),answers:structuredClone(current.current)};
     pending.current=request;
     const result=await productionApi<{revision:number}>(`${path}/answers`,{method:'PATCH',body:request});
     revision.current=result.revision;baseline.current=JSON.stringify(request.answers);pending.current=null;
     if(mounted.current)setSaved(baseline.current);
    }
    return revision.current;
   }catch(reason){if(mounted.current){setError(apiMessage(reason));setConflict(reason instanceof ApiError&&reason.status===409);}throw reason;}
   finally{running.current=null;if(mounted.current)setSaving(false);}
  };
  running.current=Promise.resolve().then(work);return running.current;
 },[path]);
 const dirty=JSON.stringify(answers)!==saved;
 useNavigationBlocker(dirty||saving);
 useEffect(()=>{if(!dirty||saving||error||!attempt.canEdit)return;const timer=setTimeout(()=>{void save().catch(()=>{});},900);return()=>clearTimeout(timer);},[dirty,answers,saving,error,attempt.canEdit,save]);
 useEffect(()=>{if(!dirty&&!saving)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,saving]);
 const attach=useCallback((questionId:string,id:string)=>{
  const answer=current.current[questionId]??{values:{},working:'',flagged:false,attachments:[]};
  change({...current.current,[questionId]:{...answer,attachments:[...answer.attachments,id]}});
 },[change]);
 return {answers,change,attach,save,dirty,saving,error,conflict};
}
