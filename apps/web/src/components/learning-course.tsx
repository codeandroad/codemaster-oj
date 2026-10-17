"use client";

import Image from "next/image";
import {useLocale} from "@/components/locale-context";
export const courseDifficulties={beginner:"入门",intermediate:"进阶",advanced:"提高"};
export const courseCovers={python:"Python",algorithms:"算法",general:"通用学习"};
export function LearningCover({coverKey="general",coverImage,className=""}:{coverKey?:string;coverImage?:string|null;className?:string}){const {locale}=useLocale();const key=coverKey in courseCovers?coverKey:"general";return <Image src={coverImage || `/course-covers/${key}.svg`} alt={coverImage?(locale==="en"?"Course cover":"课程封面"):locale==="en"?`${({python:"Python",algorithms:"Algorithms",general:"General learning"})[key as keyof typeof courseCovers]} course cover`:`${courseCovers[key as keyof typeof courseCovers]}课程封面`} width={640} height={360} unoptimized className={`h-auto w-full ${className}`}/>;}
export function LearningProgressSummary({read,totalChapters,done,totalTasks}:{read:number;totalChapters:number;done:number;totalTasks:number}){
 const {locale}=useLocale();const text=(zh:string,en:string)=>locale==="en"?en:zh;
 return <section aria-label={text("课程进度","Course progress")} className="grid gap-4 sm:grid-cols-2">{[{label:text("章节阅读","Chapters read"),value:read,total:totalChapters,empty:text("暂无章节","No chapters"),kind:"read"},{label:text("练习完成","Practice completed"),value:done,total:totalTasks,empty:text("暂无已发布练习","No published practice"),kind:"practice"}].map(s=><div key={s.kind} className="min-w-0 rounded-md border border-border bg-surface px-4 py-3"><div className="flex justify-between gap-3 text-sm"><span className="font-medium">{s.label}</span><span className="text-muted-foreground">{s.total?`${s.value} / ${s.total}`:s.empty}</span></div><progress aria-label={s.label} max={Math.max(1,s.total)} value={Math.min(s.value,s.total)} className="mt-3 h-2 w-full" style={{accentColor:"var(--primary)"}}/></div>)}</section>;
}
