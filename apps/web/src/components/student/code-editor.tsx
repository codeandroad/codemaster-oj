"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState,useImperativeHandle, type ReactNode, type Ref, type CSSProperties, type KeyboardEvent } from "react";
import type { SubmissionLanguage } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { languageInfo } from "./languages";
import type { WorkspaceSettings } from "./workspace-settings";
import {editKey,matchingBrackets,editorCommand,moveEditorLines,type EditSnapshot} from "./editor-behavior";
export interface CodeEditorHandle {replaceCode:(code:string)=>void;focus:()=>void}
import {editorTheme} from "./editor-themes";
import {editorActionFor} from "./editor-keymap";
import {createVimState,vimKey,type VimState} from "./editor-vim";
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

export function CodeEditor({ code, onChange, language, settings, status,idPrefix="production",inputLabel,readOnly=false,editorRef,onFormat,onEnableVim,actions }: { code: string; onChange: (code: string) => void; language: SubmissionLanguage; settings: WorkspaceSettings; status?: string;idPrefix?:string;inputLabel?:string;readOnly?:boolean;editorRef?:Ref<CodeEditorHandle>;onFormat?:()=>void;onEnableVim?:()=>void;actions?:ReactNode }) {
  const {locale}=useLocale();const tx=(zh:string,en:string)=>locale==='en'?en:zh;
  const highlight=useRef<HTMLPreElement>(null),numbers=useRef<HTMLDivElement>(null),fieldRef=useRef<HTMLTextAreaElement>(null),textSurface=useRef<HTMLDivElement>(null),mirror=useRef<HTMLDivElement>(null);
  const [cursor,setCursor]=useState({start:0,end:0,line:1,column:1}),[focused,setFocused]=useState(false),[scroll,setScroll]=useState({top:0,left:0}),[lineHeights,setLineHeights]=useState<number[]>([]),[viewport,setViewport]=useState({height:900,width:0});
  const [escapeVim,setEscapeVim]=useState(false),[caretPosition,setCaretPosition]=useState({left:10,top:14,width:8,height:24,character:''});
  const caretMirror=useRef<HTMLDivElement>(null);
  const vimEnabled=settings.keyBinding==='vim'||escapeVim,viewportHeight=viewport.height;
  const historyLanguage=useRef(language);
  const vimRef=useRef(createVimState()),[vim,setVim]=useState(createVimState);
  const insertGroup=useRef<{checkpoint:EditSnapshot;recorded:boolean}|null>(null);
  const pendingSelection=useRef<EditSnapshot|null>(null);
  function updateVim(next:VimState){vimRef.current=next;setVim(next);}
  useEffect(()=>{setEscapeVim(false);updateVim(createVimState());insertGroup.current=null;},[settings.keyBinding,language]);
  const history=useRef<{current:EditSnapshot;past:EditSnapshot[];future:EditSnapshot[]}>({current:{value:code,start:0,end:0},past:[],future:[]});
  const lines=code.split("\n"),editorStyle={tabSize:settings.tabSize,fontSize:settings.fontSize,fontFamily:fontFamily[settings.fontFamily],fontVariantLigatures:settings.ligatures?"common-ligatures":"none",lineHeight:"24px"} as const;
  useEffect(() => {
    if(historyLanguage.current!==language||history.current.current.value!==code){history.current={current:{value:code,start:0,end:0},past:[],future:[]};setCursor({start:0,end:0,line:1,column:1});updateVim(createVimState());insertGroup.current=null;}
    historyLanguage.current=language;
  },[code,language]);
  // Restore a controlled edit's caret before the next key can observe the DOM.
  // A deferred animation frame can otherwise lose to a rapid Vim command.
  useLayoutEffect(()=>{const next=pendingSelection.current;if(next&&fieldRef.current?.value===next.value){pendingSelection.current=null;move(next);}});
  useEffect(()=>{const surface=textSurface.current;if(!surface)return;const measure=()=>setViewport(current=>current.height===surface.clientHeight&&current.width===surface.clientWidth?current:{height:surface.clientHeight,width:surface.clientWidth});measure();const observer=new ResizeObserver(measure);observer.observe(surface);return()=>observer.disconnect();},[]);
  const caretOffset=useCallback((at:number)=>{
    const mirror=caretMirror.current,field=fieldRef.current,node=mirror?.firstChild;
    if(!mirror||!field||!node)return null;
    // A normal-mode caret belongs ON the current character, not at the insertion
    // boundary before it. A non-collapsed range also resolves wrapped boundaries.
    const usableWidth=field.clientWidth;mirror.style.width=`${usableWidth}px`;
    at=Math.max(0,Math.min(at,code.length));
    const character=String.fromCodePoint(code.codePointAt(at)??32),block=vimRef.current.mode!=='insert';
    const blank=character==='\n'||character==='\t'||at===code.length;
    const range=document.createRange();range.setStart(node,at);
    if(block&&!blank)range.setEnd(node,at+character.length);else range.collapse(true);
    const rect=range.getClientRects()[0]??range.getBoundingClientRect(),base=mirror.getBoundingClientRect();
    // Client rects include CSS zoom/transforms; overlay coordinates are local CSS
    // pixels. Keep measurement and painting in the same coordinate system.
    const scale=usableWidth>0?base.width/usableWidth||1:1;
    const cell=document.createRange();cell.setStart(node,code.length);cell.setEnd(node,code.length+1);
    const cellWidth=cell.getBoundingClientRect().width/scale||settings.fontSize*.6;
    const height=block?24:settings.fontSize+4;
    return {left:(rect.left-base.left)/scale,top:(rect.top-base.top)/scale+(rect.height/scale-height)/2,width:block?blank?cellWidth:Math.max(1,rect.width/scale):3,height,character:block&&!blank?character:''};
  },[code,settings.fontSize]);
  useLayoutEffect(()=>{
    const field=fieldRef.current;
    if(!vimEnabled||!focused||readOnly||!field)return;
    // Use the browser's text layout, including tabs, CJK, wrapping and ligatures.
    const at=vim.mode.startsWith('visual')?vim.head:cursor.start;
    const position=caretOffset(at);if(!position)return;
    const next={...position,left:position.left-field.scrollLeft,top:position.top-field.scrollTop};
    setCaretPosition(current=>current.left===next.left&&current.top===next.top&&current.width===next.width&&current.height===next.height&&current.character===next.character?current:next);
  },[vimEnabled,focused,readOnly,vim.mode,vim.head,cursor.start,code,scroll.left,scroll.top,settings.fontSize,settings.fontFamily,settings.ligatures,settings.tabSize,settings.wordWrap,viewport.width,viewport.height,caretOffset]);
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
  function move(next:EditSnapshot){const position=()=>{const field=fieldRef.current;if(!field||field.value!==next.value)return;field.setSelectionRange(next.start,next.end);selection(field);
    if(vimEnabled){
      const at=vimRef.current.mode.startsWith('visual')?vimRef.current.head:next.start;
      const exact=caretOffset(at);
      if(exact){
        if(exact.top<field.scrollTop)field.scrollTop=Math.max(0,Math.floor(exact.top-2));else if(exact.top+exact.height>field.scrollTop+field.clientHeight)field.scrollTop=Math.ceil(exact.top+exact.height+2-field.clientHeight);
        if(!settings.wordWrap){if(exact.left<field.scrollLeft)field.scrollLeft=Math.max(0,Math.floor(exact.left-2));else if(exact.left+exact.width>field.scrollLeft+field.clientWidth-14)field.scrollLeft=Math.ceil(exact.left+exact.width+14-field.clientWidth);}
        return;
      }
      const parts=next.value.slice(0,at).split('\n'),line=parts.length-1;
      const top=14+(settings.wordWrap?lineHeights.slice(0,line).reduce((sum,n)=>sum+n,0):line*24);
      if(top<field.scrollTop)field.scrollTop=top;else if(top+24>field.scrollTop+field.clientHeight)field.scrollTop=top+24-field.clientHeight;
      if(!settings.wordWrap){const column=(parts.at(-1)??'').replace(/\t/g,' '.repeat(settings.tabSize)).length,left=10+column*settings.fontSize*.61;if(left<field.scrollLeft)field.scrollLeft=left;else if(left+16>field.scrollLeft+field.clientWidth)field.scrollLeft=left+16-field.clientWidth;}
    }
  };if(fieldRef.current?.value===next.value){pendingSelection.current=null;position();}else pendingSelection.current=next;}
  function apply(next:EditSnapshot,moveCursor=true){
    const current=history.current.current;
    if(next.value!==current.value){const group=insertGroup.current;if(!group||!group.recorded){history.current.past.push({...group?.checkpoint??current});if(history.current.past.length>100)history.current.past.shift();if(group)group.recorded=true;}history.current.future=[];}
    history.current.current={...next};if(next.value!==current.value)onChange(next.value);if(moveCursor)move(next);
  }
  function undo(redo=false){
    insertGroup.current=null;
    const source=redo?history.current.future:history.current.past,target=redo?history.current.past:history.current.future,next=source.pop();
    if(!next)return;target.push({...history.current.current});history.current.current={...next};onChange(next.value);move(next);
  }
  useImperativeHandle(editorRef,()=>({replaceCode:formatted=>apply({value:formatted,start:0,end:0}),focus:()=>fieldRef.current?.focus()}));
  function onKeyDown(event:KeyboardEvent<HTMLTextAreaElement>){
    if(readOnly)return;
    const field=event.currentTarget;selection(field);
    if(event.nativeEvent.isComposing||event.key==='Process'||event.keyCode===229)return;
    const enableVim=event.key==='Escape'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!vimEnabled;
    if(enableVim){setEscapeVim(true);onEnableVim?.();}
    if(vimEnabled||enableVim){
      const previous=enableVim?{...createVimState(),mode:'insert' as const}:vimRef.current,next=vimKey({value:field.value,start:field.selectionStart,end:field.selectionEnd},previous,event,settings.autoIndent);
      if(next){event.preventDefault();event.stopPropagation();
        if(previous.mode!=='insert'&&next.state.mode==='insert')insertGroup.current={checkpoint:{...history.current.current},recorded:false};
        if(next.state.mode!=='insert')insertGroup.current=null;
        updateVim(next.state);
        if(next.history)undo(next.history==='redo');else apply(next.snapshot);
        return;
      }
      if(previous.mode==='insert'&&!insertGroup.current)insertGroup.current={checkpoint:{...history.current.current},recorded:false};
    }
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
    // Unhandled normal-mode keys (including Tab / IME setup) must never fall
    // through to the insert-mode indentation and bracket helpers.
    if(vimEnabled&&vimRef.current.mode!=='insert')return;
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
        {vimEnabled&&focused&&!readOnly&&<><div ref={caretMirror} aria-hidden className={`${styles.caretMirror} ${settings.wordWrap?styles.wrap:''}`} style={editorStyle}>{code+' '}</div>{(cursor.start===cursor.end||vim.mode.startsWith('visual'))&&<div className={styles.caretLayer} aria-hidden><span className={`${styles.vimCaret} ${vim.mode!=='insert'?styles.vimBlock:''}`} data-od-id={`${idPrefix}-vim-caret`} data-caret-shape={vim.mode==='insert'?'bar':'block'} style={{left:caretPosition.left,top:caretPosition.top,width:caretPosition.width,height:caretPosition.height}}>{caretPosition.character}</span></div>}</>}
        <textarea readOnly={readOnly||(vimEnabled&&vim.mode!=='insert')} ref={fieldRef} aria-label={inputLabel??`${languageInfo[language].name} ${tx('代码编辑器','code editor')}`} aria-describedby={vimEnabled?`${idPrefix}-vim-status`:undefined} data-vim-mode={vimEnabled?vim.mode:undefined} data-od-id={`${idPrefix}-code-input`} value={code}
          onChange={event=>{const field=event.target;apply({value:field.value,start:field.selectionStart,end:field.selectionEnd},false);selection(field);}}
          onFocus={event=>{setFocused(true);selection(event.currentTarget);}} onBlur={()=>setFocused(false)} onSelect={event=>selection(event.currentTarget)} onKeyDown={onKeyDown} onKeyUp={event=>selection(event.currentTarget)} onClick={event=>{if(vimEnabled&&vimRef.current.mode!=='insert'){updateVim({...createVimState(),register:vimRef.current.register,linewise:vimRef.current.linewise});}selection(event.currentTarget);}}
          onCompositionEnd={event=>selection(event.currentTarget)}
          onScroll={event=>{const field=event.currentTarget;setScroll({top:field.scrollTop,left:field.scrollLeft});if(highlight.current){highlight.current.scrollTop=field.scrollTop;highlight.current.scrollLeft=field.scrollLeft;}if(numbers.current)numbers.current.scrollTop=field.scrollTop;}}
          spellCheck={false} autoCapitalize="none" autoComplete="off" wrap={settings.wordWrap?"soft":"off"} className={`${styles.input} ${vimEnabled?styles.vimInput:''} ${settings.wordWrap?styles.wrappedInput+' '+styles.wrap:''}`} style={editorStyle}/>
      </div>
    </div>
    <div className={styles.status}><span className="flex flex-wrap items-center gap-3">{vimEnabled&&<span id={`${idPrefix}-vim-status`} role="status" className="font-mono font-semibold">VIM · {vim.query!==null?`/${vim.query}`:({normal:tx('普通','NORMAL'),insert:tx('插入','INSERT'),visual:tx('可视','VISUAL'),'visual-line':tx('可视行','VISUAL LINE')}[vim.mode])}{vim.query===null&&` ${vim.operator}${vim.count}${vim.pending}`}</span>}<span aria-live="off">{locale==='en'?`Line ${cursor.line}, column ${cursor.column}`:`行 ${cursor.line}，列 ${cursor.column}`}</span><span>{status??tx('草稿保存在当前浏览器会话','Draft saved in this browser session')}</span></span>{actions&&<div className="flex shrink-0 items-center gap-2" data-od-id="editor-run-actions">{actions}</div>}</div>
  </div>;
}
