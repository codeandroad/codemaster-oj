"use client";
import {useEffect,useState,useRef} from 'react';
import {Button} from '../ui/button';
import {useLocale} from '@/components/locale-context';
const englishNotices:Record<string,string>={
 '本机草稿读取失败，请手动保存。':'Could not read the local draft. Save manually.',
 '本机草稿已自动保存':'Local draft saved automatically.',
 '本机保存失败，请手动保存到服务器。':'Local save failed. Save to the server manually.',
 '已保存到服务器':'Saved to the server.',
 '草稿自动保存到当前浏览器，发布前仍需保存到服务器。':'Drafts are saved automatically in this browser. Save to the server before publishing.',
 '改动已临时保存在当前浏览器；点击“保存修改”后才会更新已发布作业。':'Changes are temporarily saved in this browser. Click Save changes to update the published assignment.',
 '草稿已恢复，尚未保存到服务器':'Draft restored, but not yet saved to the server.',
 '已忽略恢复草稿':'Recovered draft ignored.',
};
export function useActivityDraft<T extends object>({storageKey,snapshot,editable,noticeText,recoveryDefaults,onRestore}:{storageKey:string;snapshot:T;editable:boolean;noticeText?:string;recoveryDefaults?:Partial<T>;onRestore:(value:T)=>void}){
 const {locale}=useLocale();const tx=(zh:string,en:string)=>locale==='en'?en:zh;const display=(message:string)=>locale==='en'?englishNotices[message]??message:message;
 const serialized=JSON.stringify(snapshot),[recovery,setRecovery]=useState<T|null>(null),[ready,setReady]=useState(false),[status,setStatus]=useState('');
 const latest=useRef(serialized),canPersist=useRef(false);
 useEffect(()=>{latest.current=serialized;canPersist.current=ready&&editable&&!recovery;},[serialized,ready,editable,recovery]);
 useEffect(()=>()=>{if(!canPersist.current)return;try{localStorage.setItem(storageKey,JSON.stringify({snapshot:JSON.parse(latest.current),updatedAt:new Date().toISOString()}));}catch{}},[storageKey]);
 useEffect(()=>{if(!editable)return;try{const raw=localStorage.getItem(storageKey);if(raw){const stored=JSON.parse(raw);const value=stored.snapshot&&typeof stored.snapshot==='object'&&!Array.isArray(stored.snapshot)?{...recoveryDefaults,...stored.snapshot}:null;const shape=snapshot as Record<string,unknown>;if(value&&Object.keys(shape).every(k=>Array.isArray(shape[k])?Array.isArray(value[k]):(typeof value[k]===typeof shape[k]&&(typeof value[k]!=="number"||Number.isFinite(value[k]))))&&typeof value.title==='string'&&Array.isArray(value.participants)&&value.participants.every((x:unknown)=>typeof x==='string')&&Array.isArray(value.problems)&&value.problems.every((x:Record<string,unknown>)=>x&&typeof x.problemId==='string'&&typeof x.title==='string'&&typeof x.points==='number'&&Number.isFinite(x.points))&&JSON.stringify(value)!==serialized)setRecovery(value as T);}}catch{setStatus('本机草稿读取失败，请手动保存。');}setReady(true);
 // A new keyed editor mounts for each account, activity and route.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[storageKey,editable]);
 useEffect(()=>{if(!ready||!editable||recovery)return;const persist=()=>{if(!canPersist.current)return;try{localStorage.setItem(storageKey,JSON.stringify({snapshot:JSON.parse(serialized),updatedAt:new Date().toISOString()}));setStatus('本机草稿已自动保存');}catch{setStatus('本机保存失败，请手动保存到服务器。');}};const hidden=()=>{if(document.visibilityState==='hidden')persist();};const timer=setTimeout(persist,600);window.addEventListener('pagehide',persist);window.addEventListener('beforeunload',persist);document.addEventListener('visibilitychange',hidden);return()=>{clearTimeout(timer);window.removeEventListener('pagehide',persist);window.removeEventListener('beforeunload',persist);document.removeEventListener('visibilitychange',hidden);};},[storageKey,serialized,ready,editable,recovery]);
 function clear(){canPersist.current=false;try{localStorage.removeItem(storageKey);}catch{}setRecovery(null);setStatus('已保存到服务器');}
 const notice=<div data-od-id="activity-autosave"><p role="status" className="mt-2 text-xs text-muted-foreground">{editable?display(status||noticeText||'草稿自动保存到当前浏览器，发布前仍需保存到服务器。'):''}</p>{editable&&recovery&&<section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle p-3 text-sm"><span>{tx('发现本机未保存的活动草稿，请核对后恢复。','A local activity draft was found. Review it before restoring.')}</span><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={()=>{onRestore(recovery);setRecovery(null);setStatus('草稿已恢复，尚未保存到服务器');}}>{tx('恢复草稿','Restore draft')}</Button><Button size="sm" variant="ghost" onClick={()=>{clear();setStatus('已忽略恢复草稿');}}>{tx('忽略草稿','Ignore draft')}</Button></div></section>}</div>;
 return {notice,clear};
}
