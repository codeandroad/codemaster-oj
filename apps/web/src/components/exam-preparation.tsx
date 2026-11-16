"use client";

import { useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, BookOpen, GraduationCap, Languages, Search, Trophy, X } from 'lucide-react';
import { useLocale } from '@/components/locale-context';
import { AppLink } from '@/components/navigation';
import { PageHeader } from '@/components/page-chrome';
import { Button } from '@/components/ui/button';
import {
  examBoards, examBoardDetail, examBoardsFor, examCategories, examDirectoryHref, examEntries, examPrograms, examSelection, searchExamEntries,
  type ExamEntry, type ExamResource, type ExamText,
} from '@/lib/exam-preparation-catalog';

export type AcslDirectoryState = 'available' | 'unavailable' | 'loading' | 'error';
type Props = {
  staff?: boolean;
  rootHref: string;
  paper1Href?: string;
  paper4Href?: string;
  acslHref?: string;
  computerScienceHref?: string;
  acslState: AcslDirectoryState;
  onRetryAcsl?: () => void;
};
const icons = {academic: BookOpen, admissions: GraduationCap, competitions: Trophy, languages: Languages};
const feedback = 'transition-colors duration-150 motion-reduce:transition-none';

/** A planned directory entry never becomes a link without a workspace destination. */
export function ExamPreparation({staff = false, rootHref, paper1Href, paper4Href, acslHref, computerScienceHref, acslState, onRetryAcsl}: Props) {
  const {locale} = useLocale();
  const tx = (zh: string, en: string) => locale === 'en' ? en : zh;
  const label = (text: ExamText) => text[locale === 'en' ? 1 : 0];
  const selection = examSelection(useSearchParams());
  const [query, setQuery] = useState('');
  const inputId = useId(), input = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  const category = examCategories.find(item => item.id === selection.category)!;
  const board = examBoards.find(item => item.id === selection.board)!;
  const resources: Partial<Record<ExamResource, string>> = {
    paper1: paper1Href, paper4: paper4Href, acsl: acslState === 'available' ? acslHref : undefined,
  };
  const entries = searching ? searchExamEntries(query) : examEntries.filter(entry =>
    entry.category === selection.category && (entry.category !== 'academic' ||
      entry.program === selection.program && (entry.program === 'ap' || entry.board === selection.board)));
  const groups = [...new Set(entries.map(entry => searching ? entry.category : label(entry.group)))];
  const select = (next: Parameters<typeof examDirectoryHref>[1]) => examDirectoryHref(rootHref, next);
  const clear = () => {setQuery(''); input.current?.focus();};
  const optionClass = (active: boolean) => `inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm ${feedback} ${active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'}`;

  function row(entry: ExamEntry) {
    const links = entry.resources?.filter(resource => resources[resource]) ?? [];
    const unavailable = entry.id === 'acsl' ? {
      available: tx('当前工作区暂无入口', 'Unavailable in this workspace'),
      unavailable: tx('本校未开放', 'Not enabled in this school'),
      loading: tx('正在确认开放状态…', 'Checking availability…'),
      error: tx('暂时无法确认开放状态', 'Availability could not be checked'),
    }[acslState] : tx('当前工作区暂无入口', 'Unavailable in this workspace');
    const context = [label(examCategories.find(item => item.id === entry.category)!.label),
      entry.program ? examPrograms.find(item => item.id === entry.program)!.label : label(entry.group),
      entry.board ? examBoards.find(item => item.id === entry.board)!.label : undefined].filter(Boolean).join(' / ');
    return <li key={entry.id} data-exam-id={entry.id} data-availability={links.length ? 'available' : entry.resources ? 'unavailable' : 'planned'} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-4">
      <div className="min-w-0 flex-1">
        {searching && <p className="mb-1 text-xs leading-5 text-muted-foreground">{context}</p>}
        <h3 className="text-base font-semibold leading-6">{entry.subject && computerScienceHref ? <AppLink href={computerScienceHref} className="decoration-primary underline-offset-4 hover:underline">{label(entry.name)}</AppLink> : label(entry.name)}</h3>
        {label(entry.detail) && <p className="mt-1 text-sm leading-6 text-muted-foreground">{label(entry.detail)}</p>}
      </div>
      {links.length ? <div className="flex shrink-0 flex-wrap items-center gap-2">{links.map(resource => <AppLink key={resource} href={resources[resource]!} className={`inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-primary hover:border-primary hover:bg-accent ${feedback}`}>
        {resource === 'paper1' ? 'Paper 1' : resource === 'paper4' ? 'Paper 4' : staff ? tx('管理资源', 'Manage resources') : tx('进入练习', 'Open practice')}<ArrowRight size={15} aria-hidden="true"/>
      </AppLink>)}</div> : <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{entry.resources ? unavailable : tx('筹备中', 'Planned')}</span>
        {entry.id === 'acsl' && acslState === 'error' && onRetryAcsl && <Button type="button" variant="ghost" onClick={onRetryAcsl}>{tx('重试', 'Retry')}</Button>}
      </div>}
    </li>;
  }

  return <div className="min-w-0 space-y-4 sm:space-y-6" data-od-id="exam-preparation">
    <PageHeader title={staff ? tx('备考资源', 'Exam resources') : tx('备考中心', 'Exam preparation')}/>
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border pb-4" data-od-id="exam-quick-links">
      <span className="text-sm text-muted-foreground">{staff ? tx('现有资源', 'Available resources') : tx('现有练习', 'Available practice')}</span>
      {(['paper1', 'paper4', 'acsl'] as const).filter(key => resources[key]).map(key => <AppLink key={key} href={resources[key]!} className={`inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline ${feedback}`}>
        {key === 'paper1' ? '9618 · Paper 1' : key === 'paper4' ? '9618 · Paper 4' : 'ACSL'}<ArrowRight size={14} aria-hidden="true"/>
      </AppLink>)}
    </div>
    <form role="search" className="max-w-xl" onSubmit={event => event.preventDefault()}>
      <label htmlFor={inputId} className="mb-2 block text-sm font-medium">{tx('查找考试或科目', 'Find an exam or subject')}</label>
      <div className="flex min-h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <Search size={17} className="shrink-0 text-muted-foreground" aria-hidden="true"/>
        <input
          ref={input}
          id={inputId}
          name="exam"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          aria-describedby={`${inputId}-help`}
          placeholder={tx('9618、AMC、雅思…', '9618, AMC, IELTS…')}
          className="min-h-11 min-w-0 flex-1 appearance-none bg-transparent text-base outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query && <button type="button" onClick={clear} aria-label={tx('清除搜索', 'Clear search')} className={`inline-flex size-9 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted ${feedback}`}><X size={16} aria-hidden="true"/></button>}
      </div>
      <p id={`${inputId}-help`} className="mt-2 text-xs leading-5 text-muted-foreground">{tx('搜索全部分类；标注“筹备中”的项目暂未提供练习。', 'Search all categories. Planned items do not have practice content yet.')}</p>
    </form>
    <div className="grid min-w-0 gap-4 sm:gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
      <nav aria-label={tx('备考分类', 'Exam categories')} className="min-w-0">
        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">{examCategories.map(item => {
          const active = !searching && item.id === selection.category, Icon = icons[item.id];
          return <li key={item.id}><AppLink scroll={false} href={select({category: item.id})} onClick={() => setQuery('')} aria-current={active ? 'page' : undefined} className={`flex h-full min-h-11 items-center gap-2.5 rounded-md border px-3 py-2 lg:min-h-20 lg:items-start lg:py-3 ${feedback} ${active ? 'border-primary bg-accent text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            <Icon size={18} className="mt-0.5 hidden shrink-0 lg:block" aria-hidden="true"/><span className="min-w-0"><span className={`block text-sm leading-5 ${active ? 'font-semibold' : 'font-medium'}`}>{label(item.label)}</span><span className="mt-1 hidden text-xs leading-5 text-muted-foreground lg:block">{label(item.hint)}</span></span>
          </AppLink></li>;
        })}</ul>
      </nav>
      <section className="min-w-0 rounded-lg border border-border bg-surface px-4 pb-1 pt-5 sm:px-6" aria-labelledby={`${inputId}-results`} data-od-id="exam-directory">
        <div className="space-y-4">
          <h2 id={`${inputId}-results`} className={`${searching ? '' : 'sr-only sm:not-sr-only '}text-lg font-semibold`}>{searching ? tx('搜索结果', 'Search results') : label(category.label)}</h2>
          {searching ? <p className="text-sm text-muted-foreground" role="status">{tx(`找到 ${entries.length} 个项目`, `${entries.length} results`)}</p> : selection.category === 'academic' ? <>
            <nav aria-label={tx('课程体系', 'Qualifications')} className="flex flex-wrap gap-x-3 border-b border-border">
              {examPrograms.map(program => <AppLink key={program.id} scroll={false} href={select({category: 'academic', program: program.id, board: selection.board})} aria-current={program.id === selection.program ? 'page' : undefined} className={optionClass(program.id === selection.program)}>{program.label}</AppLink>)}
            </nav>
            {selection.program !== 'ap' ? <div className="space-y-3">
              <nav aria-label={tx('考试局', 'Exam boards')} className="flex flex-wrap gap-1">{examBoardsFor(selection.program).map(item => <AppLink key={item.id} scroll={false} href={select({category: 'academic', program: selection.program, board: item.id})} aria-current={selection.board === item.id ? 'page' : undefined} className={`inline-flex min-h-11 items-center rounded-md border px-3 py-2 text-sm ${feedback} ${selection.board === item.id ? 'border-border-strong bg-muted font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{item.label}</AppLink>)}</nav>
              <p className="text-sm text-muted-foreground">{examBoardDetail(board, selection.program)}</p>
            </div> : <p className="text-sm text-muted-foreground">Advanced Placement · College Board</p>}
          </> : selection.category === 'competitions' ? <p className="text-sm leading-6 text-muted-foreground">{tx('按学科浏览国际竞赛，包含阿思丹相关项目。', 'Browse international competitions by subject, including ASEEDER-related programmes.')}</p> : null}
        </div>
        {!entries.length && <div className="space-y-3 py-10"><p className="text-sm text-muted-foreground">{tx('没有找到对应项目。试试考试简称、科目名称或代码。', 'No matching entries. Try an exam abbreviation, subject or syllabus code.')}</p><Button type="button" variant="secondary" onClick={clear}>{tx('清除搜索', 'Clear search')}</Button></div>}
        {groups.map(group => <section key={group} className="mt-5">
          {(searching || selection.category !== 'academic' || selection.program === 'ap') && <h3 className="border-b border-border pb-2 text-sm font-medium text-muted-foreground">{searching ? label(examCategories.find(item => item.id === group)!.label) : group}</h3>}
          <ul className="divide-y divide-border">{entries.filter(entry => (searching ? entry.category : label(entry.group)) === group).map(row)}</ul>
        </section>)}
      </section>
    </div>
  </div>;
}
