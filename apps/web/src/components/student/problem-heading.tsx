"use client";
import {useId,useRef,useState} from 'react';
import {Tag} from 'lucide-react';
import {useLocale} from '@/components/locale-context';
import styles from './workspace.module.css';
export function ProblemHeading({title,difficulty,tags=[]}:{title:string;difficulty?:string;tags?:string[]}){
  const {locale}=useLocale();const tx=(zh:string,en:string)=>locale==='en'?en:zh;
  const level=difficulty?.trim()||'未设置难度';
  const translatedLevel=locale==='en'
    ? ({'入门':'Beginner','基础':'Easy','进阶':'Intermediate','提高':'Advanced','未设置难度':'Difficulty not set'} as Record<string,string>)[level]??level
    : ({easy:'入门',medium:'进阶',hard:'提高',beginner:'入门',intermediate:'进阶',advanced:'提高'} as Record<string,string>)[level.toLowerCase()]??level;
  const [open,setOpen]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),id=useId();
  const topics=[...new Set(tags.map(value=>value.trim()).filter(Boolean))];
  function show(){if(timer.current)clearTimeout(timer.current);setOpen(true);}
  function hide(){timer.current=setTimeout(()=>setOpen(false),120);}
  return <header className={styles.problemHeading} data-od-id="problem-title-bar">
    <h1 data-od-id="problem-title">{title}</h1>
    <div className={styles.metadataRow} data-od-id="problem-metadata">
      <span className={`${styles.metadataTag} ${difficulty==='进阶'||difficulty?.toLowerCase()==='hard'?styles.hardDifficulty:''}`} data-od-id="problem-difficulty">{translatedLevel}</span>
      <div className={styles.topicAnchor} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))hide();}} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);event.stopPropagation();}}}>
        <button type="button" className={styles.metadataTag} aria-label={tx('查看题目主题分类','View problem topics')} aria-expanded={open} aria-describedby={open?id:undefined} onClick={show} data-od-id="problem-topic-tag"><Tag size={14}/>{tx('主题','Topic')}{topics.length>0&&<span className="text-muted-foreground">{topics.length}</span>}</button>
        {open&&<div id={id} role="tooltip" className={styles.topicPopover} data-od-id="topic-classification"><strong>{tx('主题分类','Topics')}</strong>{topics.length?<div className={styles.topicList}>{topics.map(topic=><span key={topic}>{topic}</span>)}</div>:<p>{tx('此题尚未设置主题分类。','This problem has no topics yet.')}</p>}</div>}
      </div>
    </div>
  </header>;
}
