"use client";
import katex from 'katex';
import {Fragment,type ReactNode} from 'react';
import {useLocale} from './locale-context';
import {contentBlocks,inlineTokens} from './content-parser';
import {AcslSourceImage} from './acsl/source-images';
import {acslSourceImageBlock} from './acsl/source-asset';
import {parseContentDiagram} from './content-diagram';
import {AcslNativeDiagram} from './acsl/native-diagram';
import styles from './math-content.module.css';
function formulaHTML(text:string,display:boolean){
  try{return {html:katex.renderToString(text,{displayMode:display,output:'htmlAndMathml',throwOnError:true,trust:false,maxExpand:1000,maxSize:20,strict:'ignore',macros:{}}),error:''};}
  catch(error){return {html:'',error:error instanceof Error?error.message:'公式语法有误'};}
}
function Formula({text,display=false}:{text:string;display?:boolean}){
  const {locale}=useLocale();
  const result=formulaHTML(text,display);
  if(result.error)return <code className={styles.mathError} title={`${locale==='en'?'Formula error: ':'公式错误：'}${result.error==='公式语法有误'&&locale==='en'?'Invalid formula syntax':result.error}`}>{display?'$$':'$'}{text}{display?'$$':'$'}</code>;
  return <span className={display?styles.displayMath:styles.inlineMath} data-math-display={display} dangerouslySetInnerHTML={{__html:result.html}}/>;
}
function Inline({text}:{text:string}){
  return <>{inlineTokens(text).map((token,index)=>token.kind==='math'?<Formula key={index} text={token.text} display={token.display}/>:token.kind==='code'?<code key={index} className={styles.inlineCode}>{token.text}</code>:token.kind==='strong'?<strong key={index}><Inline text={token.text}/></strong>:token.text)}</>;
}
export function MathContent({content,renderCode,preserveHeadingLevels=false,compact=false,language}:{content:string;renderCode?:(text:string,language?:string)=>ReactNode;preserveHeadingLevels?:boolean;compact?:boolean;language?:'en'|'zh'}){
  const {locale}=useLocale();
  return <div className={compact ? `${styles.content} ${styles.compact}` : styles.content}>{contentBlocks(content).map((block,index)=>{
    if(block.kind==='code'&&block.language==='diagram'){
      const diagram=parseContentDiagram(block.text);
      return diagram?<AcslNativeDiagram key={index} diagram={diagram} language={language??(locale==='en'?'en':'zh')}/>:<div key={index} className="my-4 rounded-md border border-border p-3 text-sm text-muted-foreground" role="note">{locale==='en'?'This diagram could not be displayed. Please ask your teacher to check it.':'此图形暂时无法显示，请联系教师检查。'}</div>;
    }
    if(block.kind==='code')return <Fragment key={index}>{renderCode?renderCode(block.text,block.language):<pre className={styles.codeBlock}><code>{block.text}</code></pre>}</Fragment>;
    if(block.kind==='math')return <div key={index} className={styles.mathBlock}><Formula text={block.text} display/></div>;
    if(block.kind==='heading')return preserveHeadingLevels && (block.level ?? 1)>2 ? <h3 key={index}><Inline text={block.text}/></h3> : <h2 key={index}><Inline text={block.text}/></h2>;
    if(block.kind==='list'){const items=block.items?.map((item,i)=><li key={i}><Inline text={item}/></li>);return block.ordered?<ol key={index}>{items}</ol>:<ul key={index}>{items}</ul>;}
    if(block.kind==='table')return <div key={index} className={styles.tableScroll} role="region" aria-label={locale==='en'?'Table, scroll horizontally if needed':'表格，可横向滚动'} tabIndex={0}>
      <table className={styles.table}>
        <thead><tr>{block.headers?.map((header,column)=><th key={column} scope="col" style={{textAlign:block.alignments?.[column]??'left'}}><Inline text={header}/></th>)}</tr></thead>
        {Boolean(block.rows?.length)&&<tbody>{block.rows?.map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,column)=><td key={column} style={{textAlign:block.alignments?.[column]??'left'}}><Inline text={cell}/></td>)}</tr>)}</tbody>}
      </table>
    </div>;
    const image=block.kind==='paragraph'?acslSourceImageBlock(block.text):null;
    if(image)return <AcslSourceImage key={`${index}:${image.src}`} src={image.src} label={image.label} className={styles.sourceImage}/>;
    return <p key={index}><Inline text={block.text}/></p>;
  })}</div>;
}
