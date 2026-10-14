import katex from 'katex';
export interface MathDiagnostic {line:number;message:string;source:string}
export function mathDiagnostics(content:string):MathDiagnostic[]{
 const issues:MathDiagnostic[]=[];let fence='',offset=0;
 const masked=content.split('\n').map(line=>{const match=line.trim().match(/^(`{3,}|~{3,})/);if(match){if(!fence)fence=match[1];else if(match[1].startsWith(fence))fence='';return ' '.repeat(line.length);}return fence?' '.repeat(line.length):line.replace(/(`+)([\s\S]*?)\1/g,m=>' '.repeat(m.length));}).join('\n');
 const escaped=(at:number)=>{let n=0;while(at>0&&masked[--at]==='\\')n++;return n%2===1;};
 while(offset<masked.length){
  const open=masked.startsWith('$$',offset)?'$$':masked.startsWith('\\[',offset)?'\\[':masked.startsWith('\\(',offset)?'\\(':masked[offset]==='$'?'$':null;
  if(!open||escaped(offset)){offset++;continue;}
  const close=open==='\\['?'\\]':open==='\\('?'\\)':open;let end=masked.indexOf(close,offset+open.length);
  while(end>=0&&escaped(end))end=masked.indexOf(close,end+close.length);
  const line=content.slice(0,offset).split('\n').length;
  if(end<0){if(open!=='$'||!/^\d/.test(masked.slice(offset+1)))issues.push({line,message:`公式缺少闭合符号 ${close}`,source:content.slice(offset,offset+80)});break;}
  const source=content.slice(offset+open.length,end);
  // Plain monetary amounts are not formulas.
  if(open==='$'&&/^\d+\s+/.test(source)&&/^\d/.test(masked.slice(end+1))){offset=end+1;continue;}
  try{katex.renderToString(source,{throwOnError:true,trust:false,maxExpand:1000,maxSize:20,strict:'ignore',macros:{}});}
  catch(error){issues.push({line,message:(error instanceof Error?error.message:'公式语法错误').replace(/^KaTeX parse error:\s*/,''),source});}
  offset=end+close.length;
 }
 return issues;
}
