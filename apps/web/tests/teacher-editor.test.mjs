import {test} from 'node:test';import assert from 'node:assert/strict';
import {mathDiagnostics} from '../src/components/teacher/math-diagnostics.ts';
test('valid inline and display formulas accept all supported delimiters',()=>assert.deepEqual(mathDiagnostics(String.raw`$a^2$ \(x\) $$\frac{a}{b}$$ \[x+y\]`),[]));
test('syntax errors identify their source line',()=>{const e=mathDiagnostics(String.raw`文字

$$\frac{a}$$`);assert.equal(e.length,1);assert.equal(e[0].line,3);assert.match(e[0].message,/Expected|argument|group|Unexpected/i);});
test('unclosed math delimiters produce actionable feedback',()=>{const e=mathDiagnostics('文字\n\\(a+b');assert.equal(e[0].line,2);assert.ok(e[0].message.includes('\\)'));});
test('literal code, escaped currency and code fences do not trigger math errors',()=>assert.deepEqual(mathDiagnostics('`$bad`\n\\$10\n```python\n"$bad"\n```\nprice $5 and $10'),[]));
test('multiple errors are reported independently',()=>assert.equal(mathDiagnostics(String.raw`$\badcommand{x}$ and $\frac{$`).length,2));
test('expansion limits prevent runaway formula validation',()=>assert.equal(mathDiagnostics(String.raw`$$\def\x{\x}\x$$`).length,1));
import {validateFunctionCase} from '../src/components/teacher/test-validation.ts';
test('function cases accept args and kwargs, matching judge admission',()=>{validateFunctionCase('[1,2]','3');validateFunctionCase('{"args":[1],"kwargs":{"step":2}}','3');});
test('invalid function protocols and nonfinite JSON cannot enter test data',()=>{for(const input of ['{}','{"args":[],"kwargs":null}','{"args":[],"extra":1}','[1e400]'])assert.throws(()=>validateFunctionCase(input,'0'));assert.throws(()=>validateFunctionCase('[]','1e400'));});
