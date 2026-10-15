"use client";

import { useEffect, useRef, useState,useImperativeHandle, type ReactNode, type Ref, type CSSProperties, type KeyboardEvent } from "react";
import type { SubmissionLanguage } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { languageInfo } from "./languages";
import type { WorkspaceSettings } from "./workspace-settings";
import {editKey,matchingBrackets,editorCommand,moveEditorLines,type EditSnapshot} from "./editor-behavior";
export interface CodeEditorHandle {replaceCode:(code:string)=>void;focus:()=>void}
import {editorTheme} from "./editor-themes";
import {editorActionFor} from "./editor-keymap";
import styles from "./code-editor.module.css";

const keywords: Record<SubmissionLanguage, Set<string>> = {
  python: new Set("def return for in if else elif while class import from as and or not is try except finally raise with pass break continue lambda yield async await True False None".split(" ")),
  cpp: new Set("auto bool break case catch char class const constexpr continue default delete do double else enum explicit false float for if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while".split(" ")),
  javascript: new Set("async await break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null return static super switch this throw true try typeof undefined var void while yield".split(" ")),
};
const builtin = new Set("print input range len list int str enumerate sum console Math JSON Array Object String Number Boolean std json cin cout vector string".split(" "));
const tokenPattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/gm;

export function CodeTokens({ code, language, matches }: { code: string; language: SubmissionLanguage; matches?: [number,number] | null }) {
  const elements=[];let offset=0;
  for(const token of code.split(tokenPattern)){
    const color=token.startsWith("#")||token.startsWith("//")||token.startsWith("/*")?"text-[var(--syntax-comment)]":token.startsWith('"')||token.startsWith("'")||token.startsWith("`")?"text-[var(--syntax-string)]":keywords[language].has(token)?"text-[var(--syntax-keyword)]":/^\d/.test(token)?"text-[var(--syntax-number)]":builtin.has(token)?"text-[var(--syntax-builtin)]":undefined;
    const start=offset;offset+=token.length;const containsMatch=matches?.some(position=>position>=start&&position<offset);
    const decorated=[];let localOffset=0;
    if(containsMatch)for(const character of token){const position=start+localOffset;localOffset+=character.length;decorated.push(<span key={position} className={matches?.includes(position)?styles.matchedBracket:undefined}>{character}</span>);}
    elements.push(<span key={start+":"+elements.length} className={color}>{containsMatch?decorated:token}</span>);
  }
  return <>{elements}</>;
}

const fontFamily: Record<WorkspaceSettings["fontFamily"], string> = {
  default: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  consolas: 'Consolas, "Liberation Mono", monospace',
  monaco: 'Monaco, "SFMono-Regular", monospace',
  courier: '"Courier New", Courier, monospace',
};

export function CodeEditor({ code, onChange, language, settings, status,idPrefix="production",inputLabel,readOnly=false,editorRef,onFormat,actions }: { code: string; onChange: (code: string) => void; language: SubmissionLanguage; settings: WorkspaceSettings; status?: string;idPrefix?:string;inputLabel?:string;readOnly?:boolean;editorRef?:Ref<CodeEditorHandle>;onFormat?:()=>void;actions?:ReactNode }) {
  const {locale}=useLocale();const tx=(zh:string,en:string)=>locale==='en'?en:zh;
  const highlight=useRef<HTMLPreElement>(null),numbers=useRef<HTMLDivElement>(null),fieldRef=useRef<HTMLTextAreaElement>(null),textSurface=useRef<HTMLDivElement>(null),mirror=useRef<HTMLDivElement>(null);
  const [cursor,setCursor]=useState({start:0,end:0,line:1,column:1}),[focused,setFocused]=useState(false),[scroll,setScroll]=useState({top:0,left:0}),[lineHeights,setLineHeights]=useState<number[]>([]),[viewportHeight,setViewportHeight]=useState(900);
  const historyLanguage=useRef(language);
  const history=useRef<{current:EditSnapshot;past:EditSnapshot[];future:EditSnapshot[]}>({current:{value:code,start:0,end:0},past:[],future:[]});
  const lines=code.split("\n"),editorStyle={tabSize:settings.tabSize,fontSize:settings.fontSize,fontFamily:fontFamily[settings.fontFamily],fontVariantLigatures:settings.ligatures?"common-ligatures":"none",lineHeight:"24px"} as const;
  useEffect(() => {
    if(historyLanguage.current!==language||history.current.current.value!==code){history.current={current:{value:code,start:0,end:0},past:[],future:[]};setCursor({start:0,end:0,line:1,column:1});}
    historyLanguage.current=language;
  },[code,language]);
  useEffect(()=>{const surface=textSurface.current;if(!surface)return;const measure=()=>setViewportHeight(surface.clientHeight);measure();const observer=new ResizeObserver(measure);observer.observe(surface);return()=>observer.disconnect();},[]);
  useEffect(() => {
    if(!settings.wordWrap||!textSurface.current||!mirror.current)return;
    const measure=()=>{const heights=Array.from(mirror.current?.children??[],element=>Math.max(24,element.getBoundingClientRect().height));setLineHeights(previous=>previous.length===heights.length&&previous.every((v,i)=>v===heights[i])?previous:heights);};
    measure();const observer=new ResizeObserver(measure);observer.observe(textSurface.current);return()=>observer.disconnect();
  },[code,settings.wordWrap,settings.fontSize,settings.fontFamily,settings.tabSize,settings.ligatures]);
  function selection(field:HTMLTextAreaElement){
    // Ignore selection events from the old DOM value while a controlled edit is committing.
    if(field.value!==history.current.current.value)return;
    const before=field.value.slice(0,field.selectionStart),parts=before.split("\n");
    setCursor({start:field.selectionStart,end:field.selectionEnd,line:parts.length,column:parts.at(-1)!.length+1});
    history.current.current={value:field.value,start:field.selectionStart,end:field.selectionEnd};
  }
  function move(next:EditSnapshot){requestAnimationFrame(()=>{const field=fieldRef.current;if(!field)return;field.setSelectionRange(next.start,next.end);selection(field);});}
  function apply(next:EditSnapshot,moveCursor=true){
    const current=history.current.current;
    if(next.value!==current.value){history.current.past.push({...current});if(history.current.past.length>100)history.current.past.shift();history.current.future=[];}
    history.current.current={...next};onChange(next.value);if(moveCursor)move(next);
  }
  function undo(redo=false){
    const source=redo?history.current.future:history.current.past,target=redo?history.current.past:history.current.future,next=source.pop();
    if(!next)return;target.push({...history.current.current});history.current.current={...next};onChange(next.value);move(next);
  }
  useImperativeHandle(editorRef,()=>({replaceCode:formatted=>apply({value:formatted,start:0,end:0}),focus:()=>fieldRef.current?.focus()}));
  function onKeyDown(event:KeyboardEvent<HTMLTextAreaElement>){
    if(readOnly)return;
    const field=event.currentTarget;selection(field);
    if(event.nativeEvent.isComposing||event.key==='Process'||event.keyCode===229)return;
    const action=editorActionFor(event,settings.editorKeymap);
    if(action){event.preventDefault();
      const snapshot={value:field.value,start:field.selectionStart,end:field.selectionEnd};
      if(action==='undo'||action==='redo')undo(action==='redo');
      else if(action==='moveUp'||action==='moveDown')apply(moveEditorLines(snapshot,action==='moveUp'?'up':'down'));
      else if(action==='format')onFormat?.();
      else {const command=editorCommand(snapshot,action==='comment'?'/':action==='indent'?']':'[',{language,tabSize:settings.tabSize,autoIndent:settings.autoIndent,autoClose:settings.autoClose});if(command)apply(command);}
      return;
    }
    if(settings.keyBinding==='emacs'&&event.ctrlKey&&!event.metaKey&&['a','e'].includes(event.key.toLowerCase())){
      event.preventDefault();const at=event.key.toLowerCase()==='a'?code.slice(0,field.selectionStart).lastIndexOf("\n")+1:(()=>{const end=code.indexOf("\n",field.selectionStart);return end<0?code.length:end;})();field.setSelectionRange(at,at);selection(field);return;
    }
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const next=editKey({value:field.value,start:field.selectionStart,end:field.selectionEnd},event.key,{language,tabSize:settings.tabSize,autoIndent:settings.autoIndent,autoClose:settings.autoClose,shift:event.shiftKey});
    if(next){event.preventDefault();apply(next);}
  }
  const activeHeight=settings.wordWrap?lineHeights[cursor.line-1]??24:24;
  const lineTop=14+(settings.wordWrap?lineHeights.slice(0,cursor.line-1).reduce((sum,n)=>sum+n,0):(cursor.line-1)*24)-scroll.top;
  const matches=focused&&cursor.start===cursor.end?matchingBrackets(code,cursor.start,language):null;
  const visibleGuides=!settings.wordWrap?lines.map((line,i)=>({i,top:14+i*24-scroll.top,depth:Math.floor((line.match(/^[ \t]*/)?.[0].replace(/\t/g,' '.repeat(settings.tabSize)).length??0)/settings.tabSize)})).filter(row=>row.depth>0&&row.top>-24&&row.top<viewportHeight):[];
  return <div className={styles.container} style={editorTheme(settings.theme).tokens as CSSProperties} data-editor-theme={settings.theme} data-od-id={`${idPrefix}-code-editor`}>
    <div className={styles.surface} style={editorStyle}>
      <div ref={numbers} aria-hidden className={styles.numbers}>{Array.from({length:lines.length},(_,index)=><div key={index} className={focused&&index+1===cursor.line?styles.activeNumber:undefined} style={{height:settings.wordWrap?lineHeights[index]??24:24}}>{settings.relativeLineNumbers&&index+1!==cursor.line?Math.abs(index+1-cursor.line):index+1}</div>)}</div>
      <div ref={textSurface} className={styles.textSurface}>
        {focused&&<div className={styles.currentLine} aria-hidden style={{top:lineTop,height:activeHeight}} data-od-id={idPrefix==="production"?"editor-current-line":`${idPrefix}-current-line`}/>}
        <div aria-hidden className={styles.guides}>{visibleGuides.map(row=><div key={row.i} className={styles.guideRow} style={{top:row.top}}>{Array.from({length:row.depth},(_,i)=><span key={i} className={styles.guide} style={{left:`calc(${i*settings.tabSize}ch - ${scroll.left}px)`}}/>)}</div>)}</div>
        <pre ref={highlight} aria-hidden className={`${styles.highlight} ${settings.wordWrap?styles.hiddenHighlight:''}`} style={editorStyle}><CodeTokens code={code+"\n"} language={language} matches={matches}/></pre>
        {settings.wordWrap&&<div ref={mirror} aria-hidden className={styles.mirror} style={editorStyle}>{lines.map((line,index)=><div key={index}>{line||"\u200b"}</div>)}</div>}
        <textarea readOnly={readOnly} ref={fieldRef} aria-label={inputLabel??`${languageInfo[language].name} ${tx('代码编辑器','code editor')}`} data-od-id={`${idPrefix}-code-input`} value={code}
          onChange={event=>{const field=event.target;apply({value:field.value,start:field.selectionStart,end:field.selectionEnd},false);selection(field);}}
          onFocus={event=>{setFocused(true);selection(event.currentTarget);}} onBlur={()=>setFocused(false)} onSelect={event=>selection(event.currentTarget)} onKeyDown={onKeyDown} onKeyUp={event=>selection(event.currentTarget)} onClick={event=>selection(event.currentTarget)}
          onCompositionEnd={event=>selection(event.currentTarget)}
          onScroll={event=>{const field=event.currentTarget;setScroll({top:field.scrollTop,left:field.scrollLeft});if(highlight.current){highlight.current.scrollTop=field.scrollTop;highlight.current.scrollLeft=field.scrollLeft;}if(numbers.current)numbers.current.scrollTop=field.scrollTop;}}
          spellCheck={false} autoCapitalize="none" autoComplete="off" wrap={settings.wordWrap?"soft":"off"} className={`${styles.input} ${settings.wordWrap?styles.wrappedInput+' '+styles.wrap:''}`} style={editorStyle}/>
      </div>
    </div>
    <div className={styles.status}><span className="flex flex-wrap items-center gap-3"><span aria-live="off">{locale==='en'?`Line ${cursor.line}, column ${cursor.column}`:`行 ${cursor.line}，列 ${cursor.column}`}</span><span>{status??tx('草稿保存在当前浏览器会话','Draft saved in this browser session')}</span></span>{actions&&<div className="flex shrink-0 items-center gap-2" data-od-id="editor-run-actions">{actions}</div>}</div>
  </div>;
}
