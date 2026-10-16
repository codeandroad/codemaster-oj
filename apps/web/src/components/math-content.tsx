"use client";
import katex from 'katex';
import {Fragment,type ReactNode} from 'react';
import {useLocale} from './locale-context';
import {contentBlocks,inlineTokens} from './content-parser';
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
export function MathContent({content,renderCode,preserveHeadingLevels=false}:{content:string;renderCode?:(text:string,language?:string)=>ReactNode;preserveHeadingLevels?:boolean}){
  return <div className={styles.content}>{contentBlocks(content).map((block,index)=>{
    if(block.kind==='code')return <Fragment key={index}>{renderCode?renderCode(block.text,block.language):<pre className={styles.codeBlock}><code>{block.text}</code></pre>}</Fragment>;
    if(block.kind==='math')return <div key={index} className={styles.mathBlock}><Formula text={block.text} display/></div>;
    if(block.kind==='heading')return preserveHeadingLevels && (block.level ?? 1)>2 ? <h3 key={index}><Inline text={block.text}/></h3> : <h2 key={index}><Inline text={block.text}/></h2>;
    if(block.kind==='list'){const items=block.items?.map((item,i)=><li key={i}><Inline text={item}/></li>);return block.ordered?<ol key={index}>{items}</ol>:<ul key={index}>{items}</ul>;}
    return <p key={index}><Inline text={block.text}/></p>;
  })}</div>;
}
