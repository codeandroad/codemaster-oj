import type {SubmissionLanguage} from '@/lib/production-api';
let pythonReady:Promise<unknown>|undefined,cppReady:Promise<unknown>|undefined;
export async function formatCode(code:string,language:SubmissionLanguage,tabSize:number){
 if(code.length>256*1024)throw new Error('代码过长，无法在编辑器内格式化。');
 if(language==='python'){const formatter=await import('@wasm-fmt/ruff_fmt/web');if(!pythonReady)pythonReady=formatter.default('/formatters/python.wasm').catch(error=>{pythonReady=undefined;throw error;});await pythonReady;return formatter.format(code,'main.py',{indent_style:'space',indent_width:tabSize,line_width:88});}
 if(language==='cpp'){const formatter=await import('@wasm-fmt/clang-format/web');if(!cppReady)cppReady=formatter.default('/formatters/cpp.wasm').catch(error=>{cppReady=undefined;throw error;});await cppReady;return formatter.format(code,'main.cpp',`{BasedOnStyle: LLVM, IndentWidth: ${tabSize}, ColumnLimit: 100}`);}
 const [prettier,babel,estree]=await Promise.all([import('prettier/standalone'),import('prettier/plugins/babel'),import('prettier/plugins/estree')]);return prettier.format(code,{parser:'babel',plugins:[babel.default,estree.default],tabWidth:tabSize});
}
export function downloadCode(code:string,filename:string){const url=URL.createObjectURL(new Blob([code],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
