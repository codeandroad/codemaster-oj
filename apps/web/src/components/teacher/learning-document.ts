import {parse,stringify} from "yaml";
export interface LearningDocumentChapter {title:string;objective:string;content:string;checkpoint:string;checkpointAnswer:string;problemIds:string[];}
export interface LearningDocument {format:"codemaster-learning-path";version:1;title:string;description:string;category:string;estimatedMinutes:number;difficulty?:"beginner"|"intermediate"|"advanced";coverKey?:"python"|"algorithms"|"general";chapters:LearningDocumentChapter[];}
const sectionNames:Record<string,keyof LearningDocumentChapter>={"学习目标":"objective","正文":"content","检查点":"checkpoint","参考答案":"checkpointAnswer","关联题目":"problemIds"};
export function parseLearningMarkdown(input:string):LearningDocument {
 if(new TextEncoder().encode(input).length>524288)throw Error("文档不得超过 512 KB。");
 const text=input.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");const match=text.match(/^---\n([\s\S]*?)\n---\n/);if(!match)throw Error("文档需要 YAML 头部；请使用格式模板。");
 const meta=parse(match[1]);if(!meta||meta.format!=="codemaster-learning-path"||meta.version!==1)throw Error("仅支持 codemaster-learning-path 版本 1。");
 const str=(v:unknown,name:string,max:number,required=false)=>{if(typeof v!=="string"||v.length>max||required&&!v.trim())throw Error(`${name}缺失或过长。`);return v.trim();};
 const doc:LearningDocument={format:"codemaster-learning-path",version:1,title:str(meta.title,"路径标题",200,true),description:str(meta.description??"","描述",4000),category:str(meta.category??"Python","分类",100,true),estimatedMinutes:meta.estimatedMinutes,chapters:[]};
 if(meta.difficulty!==undefined){if(!["beginner","intermediate","advanced"].includes(meta.difficulty))throw Error("课程难度无效。");doc.difficulty=meta.difficulty;}
 if(meta.coverKey!==undefined){if(!["python","algorithms","general"].includes(meta.coverKey))throw Error("课程封面无效。");doc.coverKey=meta.coverKey;}
 if(!Number.isInteger(doc.estimatedMinutes)||doc.estimatedMinutes<1||doc.estimatedMinutes>10080)throw Error("预计时长须为 1–10080 分钟。");
 let chapter:LearningDocumentChapter|null=null,key:keyof LearningDocumentChapter="content",buffer:string[]=[],fence:{char:string;length:number}|null=null,seen=new Set<string>();
 const flush=()=>{if(!chapter)return;const value=buffer.join("\n").trim();if(key==="problemIds"){const ids=value?JSON.parse(value):[];if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=="string"||!/^[-0-9a-f]{36}$/i.test(id)))throw Error("关联题目须为最多 100 个 UUID 的 JSON 数组。");chapter.problemIds=ids;}else chapter[key]=value;buffer=[];};
 for(const line of text.slice(match[0].length).split("\n")){
  const fm=line.match(/^\s*(`{3,}|~{3,})(.*)$/);if(fm){if(!fence)fence={char:fm[1][0],length:fm[1].length};else if(fm[1][0]===fence.char&&fm[1].length>=fence.length&&!fm[2].trim())fence=null;buffer.push(line);continue;}
  if(!fence){const heading=line.match(/^## 章节：[ \t]*(.+)$/);if(heading){flush();chapter={title:str(heading[1],"章节标题",200,true),objective:"",content:"",checkpoint:"",checkpointAnswer:"",problemIds:[]};doc.chapters.push(chapter);seen=new Set();key="content";buffer=[];continue;}
   const section=line.match(/^### (学习目标|正文|检查点|参考答案|关联题目)\s*$/);if(section){if(!chapter)throw Error("章节字段必须在章节标题之后。");flush();if(seen.has(section[1]))throw Error(`章节「${chapter.title}」有重复字段：${section[1]}`);seen.add(section[1]);key=sectionNames[section[1]];continue;}
  }
  if(chapter)buffer.push(line);else if(line.trim()&&!line.startsWith("# "))throw Error("章节前只能有文档主标题；请使用「## 章节：标题」。");
 }
 if(fence)throw Error("文档中存在未闭合的代码围栏。");flush();
 if(!doc.chapters.length||doc.chapters.length>100)throw Error("文档需包含 1–100 个章节。");
 for(const c of doc.chapters){if(!c.content.trim())throw Error(`章节「${c.title}」缺少正文。`);if(c.objective.length>4000||c.checkpoint.length>10000||c.checkpointAnswer.length>10000||new TextEncoder().encode(c.content).length>262144)throw Error(`章节「${c.title}」内容过长。`);}
 return doc;
}
export function serializeLearningMarkdown(doc:LearningDocument):string {
 const {chapters,...meta}=doc;
 return `---\n${stringify(meta).trim()}\n---\n\n# ${doc.title}\n\n`+chapters.map(c=>`## 章节：${c.title}\n\n### 学习目标\n\n${c.objective.trim()}\n\n### 正文\n\n${c.content.trim()}\n\n### 检查点\n\n${c.checkpoint.trim()}\n\n### 参考答案\n\n${c.checkpointAnswer.trim()}\n\n### 关联题目\n\n${JSON.stringify(c.problemIds)}\n`).join("\n");
}
export function downloadLearningMarkdown(doc:LearningDocument){const markdown=serializeLearningMarkdown(doc);parseLearningMarkdown(markdown);const blob=new Blob([markdown],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=doc.title.replace(/[\\/:*?"<>|]/g,"-")+".md";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
