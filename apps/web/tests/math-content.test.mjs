import {test} from 'node:test';import assert from 'node:assert/strict';import katex from 'katex';
import {contentBlocks,inlineTokens} from '../src/components/content-parser.ts';
test('inline LaTeX delimited by dollars and parentheses stays in its text flow',()=>{const tokens=inlineTokens(String.raw`输入 $a_i$，满足 \(x^2\)。`);assert.deepEqual(tokens.filter(x=>x.kind==='math').map(x=>x.text),['a_i','x^2']);});
test('display formulas support dollar pairs and brackets across lines',()=>{const blocks=contentBlocks(String.raw`描述

$$
\sum_{i=1}^{n} a_i
$$

\[x^2+y^2=z^2\]`);assert.deepEqual(blocks.filter(x=>x.kind==='math').map(x=>x.text.trim()),[String.raw`\sum_{i=1}^{n} a_i`,'x^2+y^2=z^2']);});
test('escaped dollars and ordinary prices remain plain text',()=>{assert.equal(inlineTokens(String.raw`价格 \$5 和 \$10`).filter(x=>x.kind==='math').length,0);assert.equal(inlineTokens('price $5 and $10').filter(x=>x.kind==='math').length,0);});
test('math inside inline code or code fences is not rendered',()=>{assert.deepEqual(inlineTokens('`$n$`').map(x=>x.kind),['code']);const blocks=contentBlocks('```python\nprint("$n$")\n```');assert.equal(blocks[0].kind,'code');assert.equal(blocks[0].text,'print("$n$")');});
test('unclosed formulas and code fences preserve content',()=>{assert.equal(inlineTokens('文本 $x').map(x=>x.text).join(''),'文本 $x');assert.equal(contentBlocks('```\na=1')[0].text,'a=1');});
test('headings, paragraphs, lists and strong text remain available',()=>{const blocks=contentBlocks('# 输入\n\n给定 **数组**。\n\n- $a$\n- $b$');assert.deepEqual(blocks.map(x=>x.kind),['heading','paragraph','list']);assert.equal(inlineTokens('**数组**')[0].kind,'strong');});
test('KaTeX emits fractions and accessible MathML locally',()=>{const html=katex.renderToString(String.raw`\frac{a}{b}`,{trust:false});assert.ok(html.includes('mfrac'));assert.ok(html.includes('katex'));});
test('untrusted formulas cannot introduce executable links or remote images',()=>{const html=katex.renderToString(String.raw`\href{javascript:alert(1)}{x}`,{trust:false,throwOnError:false});assert.ok(!html.includes('href="javascript:'));const image=katex.renderToString(String.raw`\includegraphics{https://evil.test/x.png}`,{trust:false,throwOnError:false});assert.ok(!image.includes('<img'));});
test('invalid input and excessive expansion fail without exposing raw HTML',()=>{assert.throws(()=>katex.renderToString(String.raw`\frac{`,{throwOnError:true}));assert.throws(()=>katex.renderToString(String.raw`\def\x{\x}\x`,{maxExpand:10}));});
