"use client";
import {useEffect,useState} from 'react';
import {parseTeacherDraft,type TeacherDraft} from './teacher-drafts';
export function useTeacherDraft({storageKey,baseline,snapshot,baseVersion,dirty,editable,onRestore}:{storageKey:string;baseline:string;snapshot:string;baseVersion:string;dirty:boolean;editable:boolean;onRestore:(snapshot:string)=>void}){
 const [ready,setReady]=useState(false),[recovery,setRecovery]=useState<TeacherDraft|null>(null);
 const [status,setStatus]=useState<'failed'|'restored'|'discarded'|null>(null);
 const [localSnapshot,setLocalSnapshot]=useState<string|null>(null);
 useEffect(()=>{try{const stored=parseTeacherDraft(localStorage.getItem(storageKey));if(stored&&stored.snapshot!==baseline)setRecovery(stored);}catch{setStatus('failed');}setReady(true);},[storageKey,baseline]);
 useEffect(()=>{
  if(!ready||!dirty||!editable||recovery)return;
  const persist=()=>{try{localStorage.setItem(storageKey,JSON.stringify({snapshot,baseVersion,updatedAt:new Date().toISOString()}));setLocalSnapshot(snapshot);setStatus(null);}catch{setStatus('failed');}};
  const timer=setTimeout(persist,500);window.addEventListener('pagehide',persist);window.addEventListener('beforeunload',persist);
  return()=>{clearTimeout(timer);window.removeEventListener('pagehide',persist);window.removeEventListener('beforeunload',persist);};
 },[ready,dirty,editable,recovery,storageKey,snapshot,baseVersion]);
 function clear(){try{localStorage.removeItem(storageKey);}catch{}setRecovery(null);setLocalSnapshot(null);setStatus(null);}
 function discard(){clear();setStatus('discarded');}
 function restore(){if(!recovery||!editable)return;onRestore(recovery.snapshot);setRecovery(null);setStatus('restored');}
 return {recovery,status,savedLocally:dirty&&localSnapshot===snapshot,clear,discard,restore};
}
