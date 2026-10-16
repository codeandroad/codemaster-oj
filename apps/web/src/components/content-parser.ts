export type TableAlignment = 'left'|'center'|'right';
export interface ContentBlock {kind:'paragraph'|'heading'|'code'|'math'|'list'|'table';text:string;level?:number;language?:string;ordered?:boolean;items?:string[];headers?:string[];rows?:string[][];alignments?:TableAlignment[]}
export interface InlineToken {kind:'text'|'code'|'math'|'strong';text:string;display?:boolean}
function escaped(text:string,index:number){let count=0;for(let i=index-1;i>=0&&text[i]==='\\';i--)count++;return count%2===1;}
function closeAt(text:string,delimiter:string,start:number,dollar=false){
  for(let at=text.indexOf(delimiter,start);at>=0;at=text.indexOf(delimiter,at+delimiter.length)){
    if(escaped(text,at))continue;
    if(dollar&&(at===start||/\s/.test(text[at-1])||/\d/.test(text[at+1]??'')))continue;
    return at;
  }return -1;
}
function codeSpanEnd(text:string,start:number,fence:string){
  for(let at=text.indexOf(fence,start);at>=0;at=text.indexOf(fence,at+fence.length)){
    if(text[at-1]!=='`'&&text[at+fence.length]!=='`')return at;
  }
  return -1;
}
function tableRow(line:string){
  const source=line.trim(),cells:string[]=[];let cell='',hasPipe=false,leading=false,trailing=false;
  for(let i=0;i<source.length;){
    if(source[i]==='`'&&!escaped(source,i)){
      const fence=source.slice(i).match(/^`+/)![0],end=codeSpanEnd(source,i+fence.length,fence);
      if(end>=0){cell+=source.slice(i,end+fence.length);i=end+fence.length;continue;}
    }
    if(source[i]==='|'&&!escaped(source,i)){
      hasPipe=true;if(i===0)leading=true;trailing=i===source.length-1;
      cells.push(cell);cell='';i++;continue;
    }
    cell+=source[i++];
  }
  cells.push(cell);
  if(leading)cells.shift();
  if(trailing)cells.pop();
  return {hasPipe,cells:cells.map(value=>value.trim().replace(/(\\+)\|/g,(whole,slashes:string)=>slashes.length%2?`${slashes.slice(0,-1)}|`:whole))};
}
function tableAt(lines:string[],index:number):{block:ContentBlock;end:number}|null{
  if(index+1>=lines.length)return null;
  const header=tableRow(lines[index]),delimiter=tableRow(lines[index+1]);
  if(!header.hasPipe||!header.cells.length||header.cells.length!==delimiter.cells.length||
    !delimiter.cells.every(cell=>/^:?-+:?$/.test(cell)))return null;
  const alignments:TableAlignment[]=delimiter.cells.map(cell=>cell.startsWith(':')?(cell.endsWith(':')?'center':'left'):(cell.endsWith(':')?'right':'left'));
  const rows:string[][]=[];let end=index+1;
  while(end+1<lines.length){
    const next=lines[end+1].trim();
    if(!next||/^(?:#{1,6}\s|`{3,}|~{3,}|\$\$|\\\[|[-*+]\s|\d+\.\s|>|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(next))break;
    const row=tableRow(lines[++end]).cells;
    rows.push(header.cells.map((_,column)=>row[column]??''));
  }
  return {block:{kind:'table',text:'',headers:header.cells,rows,alignments},end};
}
export function inlineTokens(text:string):InlineToken[]{
  const tokens:InlineToken[]=[];let buffer='';const flush=()=>{if(buffer){tokens.push({kind:'text',text:buffer});buffer='';}};
  for(let i=0;i<text.length;){
    if(text[i]==='\\'&&['$','`','*','|','\\'].includes(text[i+1]??'')){buffer+=text[i+1];i+=2;continue;}
    if(text[i]==='`'){
      const fence=text.slice(i).match(/^`+/)![0],end=codeSpanEnd(text,i+fence.length,fence);
      if(end>=0){flush();tokens.push({kind:'code',text:text.slice(i+fence.length,end)});i=end+fence.length;continue;}
    }
    const left=text.startsWith('$$',i)?'$$':text.startsWith('\\[',i)?'\\[':text.startsWith('\\(',i)?'\\(':text[i]==='$'?'$':null;
    if(left&&!escaped(text,i)){
      const right=left==='\\['?'\\]':left==='\\('?'\\)':left;
      const end=closeAt(text,right,i+left.length,left==='$');
      if(end>=0&&text.slice(i+left.length,end).trim()){
        flush();tokens.push({kind:'math',text:text.slice(i+left.length,end),display:left==='$$'||left==='\\['});i=end+right.length;continue;
      }
    }
    if(text.startsWith('**',i)){
      const end=text.indexOf('**',i+2);if(end>i+2){flush();tokens.push({kind:'strong',text:text.slice(i+2,end)});i=end+2;continue;}
    }
    buffer+=text[i++];
  }flush();return tokens;
}
export function contentBlocks(content:string):ContentBlock[]{
  const lines=content.replace(/\r\n/g,'\n').split('\n'),out:ContentBlock[]=[];let paragraph:string[]=[];
  const flush=()=>{if(paragraph.length){out.push({kind:'paragraph',text:paragraph.join('\n')});paragraph=[];}};
  for(let i=0;i<lines.length;i++){
    const line=lines[i],trimmed=line.trim();
    if(!trimmed){flush();continue;}
    const fence=trimmed.match(/^(`{3,}|~{3,})([^\s]*)/);
    if(fence){flush();const code:string[]=[];let next=i+1;for(;next<lines.length&&!lines[next].trim().startsWith(fence[1]);next++)code.push(lines[next]);out.push({kind:'code',text:code.join('\n'),language:fence[2]});i=next;continue;}
    const delimiter=trimmed.startsWith('$$')?'$$':trimmed.startsWith('\\[')?'\\[':null;
    if(delimiter){
      const closing=delimiter==='$$'?'$$':'\\]',rest=trimmed.slice(delimiter.length),parts=[rest];let last=i,end=closeAt(rest,closing,0);
      while(end<0&&last+1<lines.length){parts.push(lines[++last]);end=closeAt(parts.join('\n'),closing,0);}
      const joined=parts.join('\n');
      if(end>=0&&joined.slice(end+closing.length).trim()===''){flush();out.push({kind:'math',text:joined.slice(0,end)});i=last;continue;}
    }
    const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading){flush();out.push({kind:'heading',level:heading[1].length,text:heading[2]});continue;}
    const list=line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
    if(list){flush();const items=[list[3]],ordered=Boolean(list[2]);while(i+1<lines.length){const next=lines[i+1].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);if(!next||Boolean(next[2])!==ordered)break;items.push(next[3]);i++;}out.push({kind:'list',text:'',items,ordered});continue;}
    const table=tableAt(lines,i);if(table){flush();out.push(table.block);i=table.end;continue;}
    paragraph.push(line);
  }flush();return out;
}
