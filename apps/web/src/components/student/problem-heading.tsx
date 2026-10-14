"use client";
import {useId,useRef,useState} from 'react';
import {Tag} from 'lucide-react';
import styles from './workspace.module.css';
export function ProblemHeading({title,difficulty,tags=[]}:{title:string;difficulty?:string;tags?:string[]}){
  const [open,setOpen]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),id=useId();
  const topics=[...new Set(tags.map(value=>value.trim()).filter(Boolean))];
  function show(){if(timer.current)clearTimeout(timer.current);setOpen(true);}
  function hide(){timer.current=setTimeout(()=>setOpen(false),120);}
  return <header className={styles.problemHeading} data-od-id="problem-title-bar">
    <h1 data-od-id="problem-title">{title}</h1>
    <div className={styles.metadataRow} data-od-id="problem-metadata">
      <span className={`${styles.metadataTag} ${difficulty==='进阶'||difficulty?.toLowerCase()==='hard'?styles.hardDifficulty:''}`} data-od-id="problem-difficulty">{difficulty?.trim()||'未设置难度'}</span>
      <div className={styles.topicAnchor} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))hide();}} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);event.stopPropagation();}}}>
        <button type="button" className={styles.metadataTag} aria-label="查看 Topic 主题分类" aria-expanded={open} aria-describedby={open?id:undefined} onClick={show} data-od-id="problem-topic-tag"><Tag size={14}/>Topic{topics.length>0&&<span className="text-muted-foreground">{topics.length}</span>}</button>
        {open&&<div id={id} role="tooltip" className={styles.topicPopover} data-od-id="topic-classification"><strong>主题分类</strong>{topics.length?<div className={styles.topicList}>{topics.map(topic=><span key={topic}>{topic}</span>)}</div>:<p>此题尚未设置主题分类。</p>}</div>}
      </div>
    </div>
  </header>;
}
