"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated original figures and private answer images. */
import { useState } from 'react';
import { LessonContent } from '@/components/student/shared';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/locale-context';
import { apiMessage,productionApi } from '@/lib/production-api';
import { controlClass,emptyAnswer,type Answer,type Question } from './model';

async function imageData(file:File){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw new Error('Choose a PNG, JPEG or WebP image under 8 MiB.');
 const bitmap=await createImageBitmap(file);
 try{const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image conversion unavailable.');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const result=canvas.toDataURL('image/png').split(',')[1];if(result.length>Math.ceil(1048576/3)*4)throw new Error('Image is too large after conversion. Use a smaller image.');return result;
 }finally{bitmap.close();}
}
export function WrittenQuestion({question:q,answer=emptyAnswer(),onChange,assetBase,attemptPath,onUploading,onAttachment}:{question:Question;answer?:Answer;onChange?:(next:Answer)=>void;assetBase:string;attemptPath?:string;onUploading?:(busy:boolean)=>void;onAttachment?:(id:string)=>void}){
 const {locale}=useLocale(),tx=(zh:string,en:string)=>locale==='en'?en:zh;
 const [uploading,setUploading]=useState(false),[error,setError]=useState('');
 const value=(key:string)=>answer.values[key]??'';
 const update=(key:string,next:string)=>onChange?.({...answer,values:{...answer.values,[key]:next}});
 return <section className="min-w-0 space-y-5" data-question-id={q.id}>
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{tx('第 ','Question ')}{q.label} <span className="text-sm font-normal text-muted-foreground">[{q.maxMarks}]</span></h2><span className="text-xs text-muted-foreground">{tx('原卷页码','Paper page')} {q.sourcePages.join(', ')}</span></div>
  <div lang="en"><LessonContent content={q.statement}/></div>
  {q.images.map(id=><figure key={id}><img src={assetBase.replace(':asset', id)} alt={`Question ${q.label}: original logic circuit`} className="max-h-96 max-w-full rounded border border-border bg-white"/><figcaption className="mt-1 text-xs text-muted-foreground">{tx('原卷图示，可点击查看大图。','Original figure. Open for a larger view.')} <a href={assetBase.replace(':asset', id)} target="_blank" rel="noreferrer" className="underline">{tx('查看大图','Open figure')}</a></figcaption></figure>)}
  {q.fields?.map(f=><div key={f.id} className="space-y-1.5"><label htmlFor={`${q.id}-${f.id}`} className="block text-sm font-medium">{f.label}</label>{f.multiline?<textarea id={`${q.id}-${f.id}`} name={f.id} rows={5} maxLength={8000} className={controlClass} value={value(f.id)} readOnly={!onChange} onChange={e=>update(f.id,e.target.value)}/>:<input id={`${q.id}-${f.id}`} name={f.id} maxLength={8000} className={controlClass} value={value(f.id)} readOnly={!onChange} onChange={e=>update(f.id,e.target.value)}/>}</div>)}
  {q.table&&<div className="max-w-full overflow-x-auto rounded border border-border"><table className="w-full border-collapse text-sm"><caption className="p-2 text-left">{q.label} · {tx('答题表格','Answer table')}</caption><thead><tr>{q.table.columns.map(c=><th key={c.id} scope="col" className="border border-border bg-muted p-2 text-left">{c.label}</th>)}</tr></thead><tbody>{q.table.rows.map((r,index)=><tr key={r.id}>{q.table!.columns.map(c=><td key={c.id} className="border border-border p-1">{c.editable?<><label className="sr-only" htmlFor={`${q.id}-${r.id}-${c.id}`}>{q.label} · {tx('第','Row ')} {index+1} {tx('行','')} · {c.label}</label><input id={`${q.id}-${r.id}-${c.id}`} name={`${r.id}.${c.id}`} className={`${controlClass} min-w-20`} value={value(`${r.id}.${c.id}`)} maxLength={8000} readOnly={!onChange} onChange={e=>update(`${r.id}.${c.id}`,e.target.value)}/></>:<span className="px-2">{r.cells[c.id]}</span>}</td>)}</tr>)}</tbody></table></div>}
  <div className="space-y-1.5"><label htmlFor={`${q.id}-working`} className="block text-sm font-medium">{tx('计算过程／补充说明','Working / additional explanation')}</label><textarea id={`${q.id}-working`} name="working" rows={3} maxLength={8000} className={controlClass} value={answer.working} readOnly={!onChange} onChange={e=>onChange?.({...answer,working:e.target.value})}/></div>
  {attemptPath&&<div className="space-y-3"><p className="text-sm font-medium">{tx('手写答案与图形','Handwritten answers and diagrams')}</p><div className="flex flex-wrap gap-3">{answer.attachments.map((id,index)=><figure key={id} className="max-w-full"><a href={`/api/v1/${attemptPath}/attachments/${id}`} target="_blank" rel="noreferrer"><img src={`/api/v1/${attemptPath}/attachments/${id}`} alt={tx(`第 ${q.label} 题作答附件 ${index+1}`,`Answer attachment ${index+1} for ${q.label}`)} className="max-h-64 max-w-full rounded border border-border"/></a>{onChange&&<Button type="button" variant="ghost" onClick={()=>onChange({...answer,attachments:answer.attachments.filter(x=>x!==id)})}>{tx('移除此附件','Remove attachment')}</Button>}</figure>)}</div>
   {onChange&&<div><label htmlFor={`${q.id}-image`} className="mb-2 block text-sm">{tx('上传图片（最多 3 张）','Upload image (up to 3)')}</label><input id={`${q.id}-image`} name="image" type="file" accept="image/png,image/jpeg,image/webp" className={`${controlClass} text-sm`} disabled={uploading||answer.attachments.length>=3} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setError('');setUploading(true);onUploading?.(true);try{const contentBase64=await imageData(file);const result=await productionApi<{id:string}>(`${attemptPath}/attachments`,{method:'POST',body:{questionId:q.id,requestId:crypto.randomUUID(),contentBase64}});onAttachment?.(result.id);}catch(reason){setError(apiMessage(reason));}finally{setUploading(false);onUploading?.(false);}}}/><p className="mt-1 text-xs text-muted-foreground">{tx('支持 PNG、JPEG、WebP，单张原图不超过 8 MiB；上传时会转换为 PNG。','PNG, JPEG or WebP, up to 8 MiB each; converted to PNG for upload.')}</p></div>}
   {uploading&&<p role="status">{tx('正在上传…','Uploading…')}</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
  </div>}
 </section>;
}
