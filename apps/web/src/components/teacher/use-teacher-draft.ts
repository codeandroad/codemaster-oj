"use client";
import {useEffect,useState} from 'react';
import {parseTeacherDraft,type TeacherDraft} from './teacher-drafts';
export function useTeacherDraft({storageKey,baseline,snapshot,baseVersion,dirty,editable,onRestore}:{storageKey:string;baseline:string;snapshot:string;baseVersion:string;dirty:boolean;editable:boolean;onRestore:(snapshot:string)=>void}){
 const [ready,setReady]=useState(false),[recovery,setRecovery]=useState<TeacherDraft|null>(null),[status,setStatus]=useState('');
 useEffect(()=>{try{const stored=parseTeacherDraft(localStorage.getItem(storageKey));if(stored&&stored.snapshot!==baseline)setRecovery(stored);}catch{setStatus('浏览器存储不可用，请手动保存草稿。');}setReady(true);},[storageKey,baseline]);
 useEffect(()=>{
  if(!ready||!dirty||!editable||recovery)return;
  const persist=()=>{try{const updatedAt=new Date().toISOString();localStorage.setItem(storageKey,JSON.stringify({snapshot,baseVersion,updatedAt}));setStatus(`本机草稿已自动保存 · ${new Date(updatedAt).toLocaleTimeString('zh-CN',{hour12:false})}`);}catch{setStatus('本机草稿保存失败，请手动保存到服务器。');}};
  const timer=setTimeout(persist,500);window.addEventListener('pagehide',persist);window.addEventListener('beforeunload',persist);
  return()=>{clearTimeout(timer);window.removeEventListener('pagehide',persist);window.removeEventListener('beforeunload',persist);};
 },[ready,dirty,editable,recovery,storageKey,snapshot,baseVersion]);
 function clear(){try{localStorage.removeItem(storageKey);}catch{}setRecovery(null);setStatus('草稿已保存到服务器。');}
 function discard(){try{localStorage.removeItem(storageKey);}catch{}setRecovery(null);setStatus('已忽略本机恢复草稿。');}
 function restore(){if(!recovery||!editable)return;onRestore(recovery.snapshot);setRecovery(null);setStatus('本机草稿已恢复，尚未保存到服务器。');}
 return {recovery,status,clear,discard,restore};
}
