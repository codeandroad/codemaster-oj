"use client";
import { usePathname,useSearchParams } from 'next/navigation';
import { AppLink } from '@/components/navigation';
import { ExamPreparation } from '@/components/exam-preparation';
import { PageHeader } from '@/components/page-chrome';
import { useLocale } from '@/components/locale-context';
import { WrittenWorkspace } from './workspace';
import { writtenHref } from './model';
import { useWorkspaceData } from '@/components/workspace-data';

export function PreparationRouter({schoolId,staff,rootHref,paper4Href,acslHref}:{schoolId:string;staff:boolean;rootHref:string;paper4Href?:string;acslHref?:string}){
 const pathname=usePathname(),search=useSearchParams(),{locale}=useLocale(),tx=(zh:string,en:string)=>locale==='en'?en:zh;
 const availability=useWorkspaceData<{enabled:boolean}>(`schools/${schoolId}/acsl${staff?'/manage':''}?view=availability`);
 const acslState=availability.error?'error':availability.data?availability.data.enabled?'available':'unavailable':'loading';
 const schoolRoute=rootHref.startsWith('/schools?');
 const subjectHref=schoolRoute?writtenHref(rootHref,{subject:'computer-science-9618'}):`${rootHref}/computer-science-9618`;
 const paper1Href=schoolRoute?writtenHref(subjectHref,{component:'paper1'}):`${subjectHref}/paper1`;
 if(pathname===paper1Href.split('?')[0]&&(!schoolRoute||search.get('component')==='paper1')&&(!schoolRoute||search.get('subject')==='computer-science-9618'))return <WrittenWorkspace schoolId={schoolId} staff={staff} baseHref={paper1Href}/>;
 if(pathname===subjectHref||schoolRoute&&search.get('subject')==='computer-science-9618')return <div className="space-y-5" data-od-id="exam-subject-9618"><PageHeader title={tx('计算机科学 · 9618','Computer Science · 9618')}/><p className="text-sm text-muted-foreground">Cambridge · AS &amp; A Level</p><div className="divide-y divide-border rounded-lg border border-border bg-surface">{[{href:paper1Href,label:tx('Paper 1 真题练习','Paper 1 past papers'),description:tx('Theory Fundamentals · 理论基础 · 作答、批阅与复盘','Theory Fundamentals · written answers, marking and reflection')},...(paper4Href?[{href:paper4Href,label:tx('Paper 4 真题练习','Paper 4 past papers'),description:tx('Practical · 编程实践','Practical · programming practice')}]:[])].map(p=><AppLink key={p.href} href={p.href} className="flex min-h-24 items-center justify-between gap-3 p-5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><div className="min-w-0"><h2 className="font-semibold">{p.label}</h2><p className="mt-2 text-sm text-muted-foreground">{p.description}</p></div><span aria-hidden="true">→</span></AppLink>)}</div></div>;
 return <ExamPreparation staff={staff} rootHref={rootHref} paper1Href={paper1Href} paper4Href={paper4Href} computerScienceHref={subjectHref} acslHref={acslHref} acslState={acslState} onRetryAcsl={availability.reload}/>;
}
