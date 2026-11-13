import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {dirname,extname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const sourceRoot=fileURLToPath(new URL('../src/',import.meta.url));

// Check the browser's eager module graph, including re-export barrels. A type
// annotation or an import() boundary must not make an editor eager again.
function staticSpecifiers(source,name='fixture.tsx'){
 const ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true);
 return ast.statements.flatMap(node=>{
  if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))return [];
  if(!node.moduleSpecifier||!ts.isStringLiteral(node.moduleSpecifier)||node.isTypeOnly||node.importClause?.isTypeOnly)return [];
  const bindings=node.importClause?.namedBindings??node.exportClause;
  if(bindings&&'elements' in bindings&&!node.importClause?.name&&bindings.elements.length&&bindings.elements.every(element=>element.isTypeOnly))return [];
  return [node.moduleSpecifier.text];
 });
}

function resolveLocal(parent,specifier){
 const base=specifier.startsWith('@/')?resolve(sourceRoot,specifier.slice(2)):specifier.startsWith('.')?resolve(dirname(parent),specifier):null;
 if(!base)return null;
 if(/\.(?:css|svg|png|jpe?g|webp|woff2?)$/.test(base))return null;
 const candidates=[base,...['.ts','.tsx','.mjs','.js','/index.ts','/index.tsx'].map(extension=>base+extension)];
 if(/\.[cm]?js$/.test(base))candidates.push(base.slice(0,-extname(base).length)+'.ts');
 const found=candidates.find(candidate=>existsSync(candidate)&&statSync(candidate).isFile());
 assert.ok(found,`Unresolved static dependency ${specifier} in ${relative(sourceRoot,parent)}`);
 return found;
}

const deferredModules=[
 /^components\/teacher\//,
 /^components\/student\/(?:pages|learning|workspace|shared|code-editor|run-result-panel|learning-course-reader)\.tsx$/,
 /^components\/student\/workspace-settings-dialog\.tsx$/,
 /^components\/math-content\.tsx$/,
 /^components\/acsl\/(?:acsl-page|programming|question-view|review-panel)\.tsx$/,
 /^components\/scholarship\/account-pages\.tsx$/,
 /^components\/schools\/(?:schools-page|public-course-catalog|school-practice|platform-page)\.tsx$/,
 /^components\/admin\/common\.tsx$/,
];
const deferredPackages=/^(?:katex|xlsx|prettier)(?:\/|$)|^@wasm-fmt\//;

function inspect(entry){
 const visited=new Set(),queue=[[resolve(sourceRoot,entry)]];
 while(queue.length){
  const trail=queue.shift(),file=trail.at(-1);
  if(visited.has(file))continue;
  visited.add(file);
  const name=relative(sourceRoot,file).replaceAll('\\','/');
  assert.ok(!deferredModules.some(pattern=>pattern.test(name)),`Heavy page became eager:\n${trail.map(item=>relative(sourceRoot,item)).join(' -> ')}`);
  for(const specifier of staticSpecifiers(readFileSync(file,'utf8'),file)){
   assert.ok(!deferredPackages.test(specifier),`Heavy library became eager:\n${trail.map(item=>relative(sourceRoot,item)).join(' -> ')} -> ${specifier}`);
   const dependency=resolveLocal(file,specifier);
   if(dependency)queue.push([...trail,dependency]);
  }
 }
 return visited;
}

test('dependency scanner distinguishes eager barrels from type-only and dynamic imports',()=>{
 assert.deepEqual(staticSpecifiers(`
  import type { Model } from './model';
  import { type Theme } from './theme';
  export type { Other } from './other';
  export { type Extra } from './extra';
  const View = dynamic(() => import('./deferred').then(module => module.View));
  import Default, { type Props } from './runtime';
  import './side-effects';
  export * from './barrel';
  export { run, type Result } from './mixed';
 `),['./runtime','./side-effects','./barrel','./mixed']);
});

for(const entry of ['components/production-app.tsx','components/student/problems.tsx','components/student/learning-list.tsx']){
 test(`${entry} keeps editors, readers and unrelated role pages behind lazy boundaries`,()=>{
  const graph=inspect(entry);
  assert.ok(graph.size>5,'the test must inspect transitive imports, not just the entry file');
  assert.ok(graph.has(resolve(sourceRoot,'lib/production-api.ts')),'catalog API access must remain reachable');
 });
}
