export type EditorLanguage = "python" | "cpp" | "javascript";
export interface EditSnapshot { value: string; start: number; end: number }
export interface EditOptions { language: EditorLanguage; tabSize: number; autoIndent: boolean; autoClose: boolean; shift?: boolean }
const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}", "'": "'", '"': '"', "`": "`" };
/** Lexical context, not a compiler. Comments and quoted literals are excluded from bracket scanning. */
export function scanContext(value: string, end: number, language: EditorLanguage) {
  let quote = "", block = false, line = false, triple = false, lineCommentStart: number | null = null;
  const brackets: { char: string; index: number }[] = [];
  for (let i = 0; i < end; i++) {
    const c=value[i],next=value[i+1];
    if (line) { if(c==='\n'){line=false;lineCommentStart=null;} continue; }
    if (block) { if(c==='*'&&next==='/'){block=false;i++;} continue; }
    if (quote) {
      if(c==='\\'){i++;continue;}
      if(triple&&value.slice(i,i+3)===quote.repeat(3)){quote='';triple=false;i+=2;}
      else if(!triple&&c===quote)quote='';
      continue;
    }
    if(language==='python'&&c==='#'){line=true;lineCommentStart=i;continue;}
    if(language!=='python'&&c==='/'&&next==='/'){line=true;lineCommentStart=i;i++;continue;}
    if(language!=='python'&&c==='/'&&next==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||(c==='`'&&language==='javascript')){
      quote=c;
      if(language==='python'&&value.slice(i,i+3)===c.repeat(3)){triple=true;i+=2;}
      continue;
    }
    if('()[]{}'.includes(c))brackets.push({char:c,index:i});
  }
  return { quote, comment: line || block, brackets, lineCommentStart };
}
function replace(snapshot: EditSnapshot, text: string, start=snapshot.start, end=snapshot.end, cursor=start+text.length): EditSnapshot {
  return { value:snapshot.value.slice(0,start)+text+snapshot.value.slice(end),start:cursor,end:cursor };
}
export function editKey(snapshot: EditSnapshot, key: string, options: EditOptions): EditSnapshot | null {
  const {value,start,end}=snapshot,unit=' '.repeat(options.tabSize),lineStart=value.slice(0,start).lastIndexOf('\n')+1;
  const before=value.slice(lineStart,start),indent=before.match(/^[ \t]*/)?.[0]??'',context=scanContext(value,start,options.language);
  if(key==='Tab'){
    if(start===end&&!options.shift)return replace(snapshot,unit);
    const last=end>start&&value[end-1]==='\n'?end-1:end;
    const blockEnd=value.indexOf('\n',last),finish=blockEnd<0?value.length:blockEnd;
    const block=value.slice(lineStart,finish).split('\n');let firstDelta=0,totalDelta=0;
    const changed=block.map((line,index)=>{
      const remove=options.shift?(line.startsWith('\t')?1:Math.min(options.tabSize,line.match(/^ */)?.[0].length??0)):0;
      const delta=options.shift?-remove:unit.length;if(index===0)firstDelta=delta;totalDelta+=delta;
      return options.shift?line.slice(remove):unit+line;
    }).join('\n');
    const next=value.slice(0,lineStart)+changed+value.slice(finish);
    return {value:next,start:Math.max(lineStart,start+firstDelta),end:Math.max(lineStart,end+totalDelta)};
  }
  if(key==='Enter'&&options.autoIndent){
    const content=(context.lineCommentStart!==null?value.slice(lineStart,context.lineCommentStart):before).trimEnd();let nextIndent=indent;
    if((!context.comment||context.lineCommentStart!==null)&&!context.quote){
      const open=context.brackets.at(-1);
      if(content.endsWith('{')||content.endsWith('[')||content.endsWith('(')||(options.language==='python'&&content.endsWith(':')))nextIndent+=unit;
      else if(open&&'([{'.includes(open.char)){
        const openLine=value.lastIndexOf('\n',open.index)+1,openIndent=value.slice(openLine,open.index).match(/^[ \t]*/)?.[0]??'';
        if(indent.length<=openIndent.length)nextIndent=openIndent+unit;
      }
    }
    if(start===end&&options.autoClose&&pairs[value[start-1]]===value[start]&&'([{'.includes(value[start-1])&&!context.quote&&!context.comment){
      const text='\n'+nextIndent+'\n'+indent;
      return replace(snapshot,text,start,end,start+1+nextIndent.length);
    }
    return replace(snapshot,'\n'+nextIndent);
  }
  if(key==='Backspace'&&start===end&&start>0){
    if(options.autoClose&&pairs[value[start-1]]&&pairs[value[start-1]]===value[start]&&!context.comment&&(!context.quote||value[start-1]===context.quote))return replace(snapshot,'',start-1,start+1,start-1);
    if(options.autoIndent&&before.length&&/^[ \t]+$/.test(before)){
      const length=before.endsWith('\t')?1:((before.length-1)%options.tabSize)+1;
      return replace(snapshot,'',start-length,start,start-length);
    }
  }
  if(options.autoClose&&key.length===1){
    if(start===end&&key===value[start]&&')]}\'"`'.includes(key)&&!context.comment&&(!context.quote||key===context.quote))return {...snapshot,start:start+1,end:start+1};
    if(pairs[key]&&!context.comment&&!context.quote&&(key!=='`'||options.language==='javascript')){
      const isQuote="'\"`".includes(key);
      if(isQuote&&start===end&&(/[\w]/.test(value[start-1]??'')||/[\w]/.test(value[start]??'')))return null;
      if(start!==end){const selected=value.slice(start,end),result=replace(snapshot,key+selected+pairs[key]);return {...result,start:start+1,end:end+1};}
      if(!value[start]||/[\s)\]},;:]/.test(value[start]))return replace(snapshot,key+pairs[key],start,end,start+1);
    }
    if(options.autoIndent&&'}])'.includes(key)&&start===end&&/^[ \t]+$/.test(before)&&!context.comment&&!context.quote){
      const stack: {char:string;index:number}[]=[];
      for(const b of context.brackets){if('([{'.includes(b.char))stack.push(b);else if(pairs[stack.at(-1)?.char??'']===b.char)stack.pop();}
      const open=stack.at(-1);
      if(open&&pairs[open.char]===key){const openStart=value.lastIndexOf('\n',open.index)+1,base=value.slice(openStart,open.index).match(/^[ \t]*/)?.[0]??'';return replace(snapshot,base+key,lineStart,end,lineStart+base.length+1);}
    }
  }
  return null;
}
export function matchingBrackets(value: string, cursor: number, language: EditorLanguage): [number,number] | null {
  const tokens=scanContext(value,value.length,language).brackets;
  const at=tokens.findIndex(t=>t.index===cursor-1);const index=at>=0?at:tokens.findIndex(t=>t.index===cursor);
  if(index<0)return null;
  const token=tokens[index],opening='([{'.includes(token.char),target=opening?pairs[token.char]:Object.entries(pairs).find(([k,v])=>'([{'.includes(k)&&v===token.char)?.[0];
  let depth=0;
  for(let i=index;opening?i<tokens.length:i>=0;opening?i++:i--){if(tokens[i].char===token.char)depth++;else if(tokens[i].char===target&&--depth===0)return [token.index,tokens[i].index];}
  return null;
}

export function editorCommand(snapshot:EditSnapshot,key:string,options:EditOptions):EditSnapshot|null{
 if(key==='['||key===']'){const start=snapshot.value.lastIndexOf('\n',snapshot.start-1)+1;const next=editKey({...snapshot,start},'Tab',{...options,shift:key==='['});return next;}
 if(key!=='/')return null;
 const {value,start,end}=snapshot,a=value.lastIndexOf('\n',start-1)+1,last=end>start&&value[end-1]==='\n'?end-1:end,b=value.indexOf('\n',last),finish=b<0?value.length:b,lines=value.slice(a,finish).split('\n'),mark=options.language==='python'?'#':'//';
 const remove=lines.filter(x=>x.trim()).every(x=>x.trimStart().startsWith(mark));let firstDelta=0,totalDelta=0;
 const edited=lines.map((line,i)=>{if(!line.trim())return line;const indent=line.match(/^\s*/)?.[0]??'',text=line.slice(indent.length),next=remove?text.slice(mark.length).replace(/^ /,''):mark+' '+text,delta=next.length-text.length;if(i===0)firstDelta=delta;totalDelta+=delta;return indent+next;}).join('\n');
 return {value:value.slice(0,a)+edited+value.slice(finish),start:Math.max(a,start+firstDelta),end:Math.max(a,end+totalDelta)};
}
export function moveEditorLines(snapshot:EditSnapshot,direction:'up'|'down'):EditSnapshot{
 const {value,start,end}=snapshot,lines=value.split('\n'),first=value.slice(0,start).split('\n').length-1,last=value.slice(0,end>start&&value[end-1]==='\n'?end-1:end).split('\n').length-1;
 if(direction==='up'&&first===0||direction==='down'&&last>=lines.length-1)return snapshot;
 const selected=lines.slice(first,last+1);
 if(direction==='up'){const previous=lines[first-1];lines.splice(first-1,selected.length+1,...selected,previous);const shift=previous.length+1;return {value:lines.join('\n'),start:start-shift,end:end-shift};}
 const next=lines[last+1];lines.splice(first,selected.length+1,next,...selected);const shift=next.length+1;return {value:lines.join('\n'),start:start+shift,end:Math.min(lines.join('\n').length,end+shift)};
}
