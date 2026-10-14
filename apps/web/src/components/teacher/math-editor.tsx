"use client";
import {useId,useRef,useState,useMemo} from 'react';
import {Eye} from 'lucide-react';
import {MathContent} from '@/components/math-content';
import {Button} from '@/components/ui/button';
import {area} from './shared';
import {mathTemplates} from './math-templates';
import {mathDiagnostics} from './math-diagnostics';
export function MathEditor({label,value,onChange,disabled=false,rows=8,initialPreview=false,fieldName}:{fieldName:string;label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;rows?:number;initialPreview?:boolean}){
  const [preview,setPreview]=useState(initialPreview),[menu,setMenu]=useState(false),field=useRef<HTMLTextAreaElement>(null),id=useId(),issues=useMemo(()=>mathDiagnostics(value),[value]);
  function insert(display:boolean,template?:string){
    const f=field.current;if(!f||disabled)return;
    const start=f.selectionStart,end=f.selectionEnd,selected=template??(value.slice(start,end)||String.raw`a^2 + b^2 = c^2`),prefix=display?'\n$$\n':'$',suffix=display?'\n$$\n':'$';
    setMenu(false);onChange(value.slice(0,start)+prefix+selected+suffix+value.slice(end));
    requestAnimationFrame(()=>{f.focus();f.setSelectionRange(start+prefix.length,start+prefix.length+selected.length);});
  }
  return <section className="min-w-0 space-y-2" data-od-id={`teacher-math-editor-${fieldName}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={id} className="text-sm font-semibold">{label}</label><div className="flex flex-wrap gap-1"><div className="relative" onKeyDown={event=>{if(event.key==='Escape')setMenu(false);}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setMenu(false);}}><Button size="sm" type="button" variant="secondary" disabled={disabled} aria-expanded={menu} aria-haspopup="menu" onClick={()=>setMenu(open=>!open)}>常用公式</Button>{menu&&<div role="menu" aria-label="常用数学公式" className="absolute right-0 top-full z-30 mt-1 grid w-64 max-w-[85vw] grid-cols-2 gap-1 rounded-md border border-border bg-surface p-2 shadow-lg">{mathTemplates.map(item=><button type="button" role="menuitem" key={item.id} className="min-h-11 rounded px-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" onClick={()=>insert(['sum','integral','matrix','cases'].includes(item.id),item.source)}>{item.label}</button>)}</div>}</div><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={()=>insert(false)}>行内公式</Button><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={()=>insert(true)}>独立公式</Button><Button type="button" size="sm" variant="secondary" aria-expanded={preview} onClick={()=>setPreview(value=>!value)}><Eye size={14}/>{preview?'收起预览':'实时预览'}</Button></div></div>
    <div className={preview?"grid grid-cols-2 gap-3 max-lg:grid-cols-1":""}><textarea ref={field} id={id} aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)} rows={rows} aria-invalid={issues.length>0} aria-describedby={issues.length?`${id}-errors`:undefined} className={`${area} font-mono max-h-96 min-h-28`} spellCheck={false}/>
    {preview&&<div className="max-h-96 overflow-auto rounded-md border border-border bg-surface-subtle p-4 font-normal" data-od-id={`teacher-math-preview-${fieldName}`}>{value.trim()?<MathContent content={value}/>:<p className="text-sm text-muted-foreground">输入题面文字或公式后，在这里预览。</p>}</div>}
    </div>
    <p className="text-xs font-normal leading-5 text-muted-foreground">{'行内公式使用 $x^2$，独立公式使用 $$...$$；也支持 \\( ... \\) 与 \\[ ... \\]。'}</p>
    {issues.length>0&&<div id={`${id}-errors`} role="status" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-od-id={`math-errors-${fieldName}`}><p className="font-semibold">发现 {issues.length} 处公式错误</p><ul className="mt-1 space-y-1">{issues.map((issue,index)=><li key={index} className="break-words">第 {issue.line} 行：{issue.message}</li>)}</ul></div>}
  </section>;
}
