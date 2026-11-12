// Only trusted author-written fixtures below are interpreted. Markdown is read
// for equality checks, never used as executable input; no eval, shell or I/O VM.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseLearningMarkdown} from '../../../../apps/web/src/components/teacher/learning-document.ts';
import {contentBlocks} from '../../../../apps/web/src/components/content-parser.ts';

const here=new URL('./',import.meta.url);
const programs={
 calc:`X DC 14
Y DC -3
    LOAD X
    ADD =4
    DIV Y
    STORE T
    LOAD =5
    SUB Y
    MULT T
    STORE X
    PRINT T
    PRINT X
    END`,
 read:`P DC 8
    LOAD =7
    READ P
    PRINT P
    ADD =2
    STORE P
    PRINT P
    END`,
 l1a:`A DC 9
    LOAD A
    ADD =2
    STORE B
    LOAD =2
    PRINT B
    END`,
 l1c:`X DC 4
    LOAD X
    ADD =6
    PRINT X
    STORE X
    PRINT X
    END`,
 l1d:`    LOAD =4
    READ A
    READ B
    ADD A
    STORE C
    PRINT B
    PRINT C
    END`,
 branch:`    READ N
    LOAD N
    SUB =3
    BL LOW
    BE SAME
    LOAD =1
    BU SAVE
LOW LOAD =-1
    BU SAVE
SAME LOAD =0
SAVE STORE R
    PRINT R
    END`,
 countdown:`N DC 2
TOP LOAD N
    PRINT N
    SUB =1
    STORE N
    BG TOP
    PRINT N
    END`,
 reload:`X DC 5
    LOAD X
    SUB =5
    LOAD =1
    BE ZERO
    PRINT X
ZERO END`,
 sentinel:`SUM DC 0
TOP READ X
    LOAD X
    BE DONE
    ADD SUM
    STORE SUM
    BU TOP
DONE PRINT SUM
    END`,
 count:`COUNT DC 2
TOTAL DC 0
TOP LOAD COUNT
    BE STOP
    ADD TOTAL
    STORE TOTAL
    LOAD COUNT
    SUB =1
    STORE COUNT
    BU TOP
STOP PRINT TOTAL
    END`,
 fixed:`X DC 1
TOP LOAD X
    BG TOP
    END`,
 half:`N DC 13
C DC 0
TOP LOAD N
    BE DONE
    DIV =2
    STORE N
    LOAD C
    ADD =1
    STORE C
    BU TOP
DONE PRINT C
    END`,
};
const opcodes=new Set(['DC','LOAD','STORE','ADD','SUB','MULT','DIV','READ','PRINT','BG','BE','BL','BU','END']);
const immediate=new Set(['LOAD','ADD','SUB','MULT','DIV']);
const branches=new Set(['BG','BE','BL','BU']);
const name=/^[A-Za-z][A-Za-z0-9]*$/;
const integer=source=>{assert.match(source,/^-?\d{1,10}$/);return BigInt(source);};
const modulo=value=>{
 // The original fixtures avoid negative overflow: the short official manual
 // does not specify its machine representation. Do not invent unsigned wrap.
 assert.ok(value>-1000000n,'Negative overflow is outside this teaching subset');
 return value>=0n?value%1000000n:value;
};
function compile(source){
 assert.equal(typeof source,'string');assert.ok(source.length<=4000);
 const labels=new Map(),memory=new Map(),lines=source.split('\n');
 assert.ok(lines.length>0&&lines.length<=40);
 let declarations=true;
 const code=lines.map((line,index)=>{
  assert.match(line,/^[ A-Za-z0-9=\-]+$/);const tokens=line.trim().split(/\s+/);let label=null;
  if(!opcodes.has(tokens[0])){
   label=tokens.shift();assert.ok(name.test(label)&&!labels.has(label));assert.ok(!line.startsWith(' '));labels.set(label,index);
  }else assert.ok(line.startsWith(' '),'An unlabeled instruction is indented');
  const [op,arg]=tokens;assert.ok(opcodes.has(op));assert.equal(tokens.length,op==='END'?1:2);
  if(op==='DC'){
   assert.ok(label&&declarations,'All teaching declarations precede executable instructions');integer(arg);memory.set(label,null);
  }else{
   declarations=false;
   if(op!=='END'){
    if(arg.startsWith('=')){assert.ok(immediate.has(op),'Immediate data is only allowed on the five marked operations');integer(arg.slice(1));}
    else assert.ok(name.test(arg),'Memory and branch operands are labels');
   }
   if(['STORE','READ'].includes(op)&&!memory.has(arg))memory.set(arg,null);
  }
  return{label,op,arg,shown:line.trim()};
 });
 for(const {op,arg} of code)if(branches.has(op)){assert.ok(labels.has(arg),'Branch target must exist');assert.notEqual(code[labels.get(arg)].op,'DC','Teaching programs do not jump into declarations');}
 return{code,labels,memory};
}
function execute(source,input=[],limit=500){
 assert.ok(input.length<=40&&input.every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=1000000000));
 assert.ok(Number.isInteger(limit)&&limit>0&&limit<=500);
 const {code,labels,memory}=compile(source),output=[],trace=[];let acc=0n,pc=0,cursor=0;
 for(let step=1;step<=limit;step++){
  assert.ok(pc>=0&&pc<code.length,'The trace must reach END rather than fall off its source');
  const {op,arg,label,shown}=code[pc];let next=pc+1;
  const load=()=>{if(arg.startsWith('='))return integer(arg.slice(1));assert.ok(memory.has(arg)&&memory.get(arg)!==null,'Read before a memory value is supplied');return memory.get(arg);};
  switch(op){
   case'DC':memory.set(label,integer(arg));break;
   case'LOAD':acc=load();break;
   case'STORE':memory.set(arg,acc);break;
   case'ADD':acc=modulo(acc+load());break;
   case'SUB':acc=modulo(acc-load());break;
   case'MULT':acc=modulo(acc*load());break;
   case'DIV':{const divisor=load();assert.notEqual(divisor,0n,'Division by zero');acc/=divisor;break;}
   case'READ':if(cursor===input.length)return{trace,output,memory,acc,cursor,stop:'input exhausted',pc:pc+1};memory.set(arg,modulo(BigInt(input[cursor++])));break;
   case'PRINT':output.push(load());break;
   case'BG':if(acc>0n)next=labels.get(arg);break;
   case'BE':if(acc===0n)next=labels.get(arg);break;
   case'BL':if(acc<0n)next=labels.get(arg);break;
   case'BU':next=labels.get(arg);break;
   case'END':next=null;break;
  }
  assert.ok(acc>-1000000n&&acc<1000000n,'All fixture state stays inside the taught signed range');
  trace.push({step,line:pc+1,instruction:shown,op,acc,memory:new Map(memory),next:next===null?'END':next+1,output:[...output]});
  if(next===null)return{trace,output,memory,acc,cursor,stop:'END',pc:pc+1};pc=next;
 }
 return{trace,output,memory,acc,cursor,stop:'step limit',pc:pc+1};
}
const outputText=values=>'['+values.map(String).join(', ')+']';
const memoryText=memory=>[...memory].map(([key,value])=>`${key}=${value===null?'—':value}`).join('; ')||'—';
const displayed=result=>result.trace.map(t=>[t.step,t.line,t.instruction,t.acc,memoryText(t.memory),t.next,outputText(t.output)].map(String));
const blocks=text=>[...text.matchAll(/```text\n([\s\S]*?)\n```/g)].map(m=>m[1]);
const tables=text=>contentBlocks(text).filter(b=>b.kind==='table').map(b=>b.rows.map(r=>r.map(c=>c.replace(/^`(.*)`$/,'$1'))));
const subsection=(doc,ch,field,number)=>{
 const text=doc.chapters[ch][field];if(!number)return text;
 const sections=text.split(/^\*\*(\d+)\.\*\* /m),index=sections.findIndex((v,i)=>i%2===1&&v===String(number));assert.ok(index>0);return sections[index+1];
};

export async function checkTutorial(){
 const documents=Object.fromEntries(await Promise.all(['en','zh'].map(async language=>[language,parseLearningMarkdown(await readFile(new URL(`course.${language}.md`,here),'utf8'))])));
 let cases=0,traceRows=0,modelComparisons=0;
 const equal=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);cases++;};
 const contains=(ch,field,text,number)=>{for(const[language,doc]of Object.entries(documents))assert.ok(subsection(doc,ch,field,number).includes(text),`${language}/${ch+1}/${field}/${number??''}: ${text}`);};
 const localized=(ch,field,en,zh,number)=>{for(const[language,doc]of Object.entries(documents))assert.ok(subsection(doc,ch,field,number).includes(language==='en'?en:zh));cases++;};
 const program=(ch,field,key,number)=>{for(const[language,doc]of Object.entries(documents))assert.ok(blocks(subsection(doc,ch,field,number)).includes(programs[key]),`${language}/${key}: exact trusted source shown`);cases++;};
 const trace=(ch,field,index,key,input=[],number,source=programs[key])=>{
  const result=execute(source,input);assert.equal(result.stop,'END');
  for(const[language,doc]of Object.entries(documents))equal(`${language}/${ch+1}/${field}/${number??''}: full trace`,tables(subsection(doc,ch,field,number))[index],displayed(result));
  traceRows+=result.trace.length;return result;
 };
 const output=(label,result,expected)=>equal(label,result.output.map(Number),expected);
 for(const[language,doc]of Object.entries(documents)){
  assert.equal(doc.chapters.length,3);
  for(let ch=0;ch<3;ch++){
   for(const field of ['checkpoint','checkpointAnswer'])equal(`${language}/${ch}: four self-check labels`,[...doc.chapters[ch][field].matchAll(/^\*\*([1-4])\.\*\* /gm)].map(m=>m[1]),['1','2','3','4']);
   for(const field of ['content','checkpoint','checkpointAnswer']){
    assert.doesNotMatch(doc.chapters[ch][field],/!\[.*?\]\(|<img|correctOptionIds|\/api\/|\/assets\//);
    equal('bilingual trusted programs',blocks(doc.chapters[ch][field]),blocks(documents.en.chapters[ch][field]));
   }
  }
 }
 program(0,'content','calc');program(0,'content','read');
 const calc=trace(0,'content',1,'calc');output('stored negative arithmetic',calc,[-6,-48]);equal('final independent arithmetic',(14+4)/-3*(5-(-3)),Number(calc.memory.get('X')));
 equal('LOAD leaves stored T intact',calc.trace.slice(5).map(t=>Number(t.memory.get('T'))),Array(8).fill(-6));
 const read=trace(0,'content',2,'read',[12]);output('READ preserves ACC',read,[12,9]);equal('after READ',[Number(read.trace[2].acc),Number(read.trace[2].memory.get('P'))],[7,12]);
 program(0,'checkpoint','l1a',1);output('first self-check',trace(0,'checkpointAnswer',0,'l1a',[],1),[11]);
 contains(0,'checkpointAnswer','`ACC = 2`',1);contains(0,'checkpointAnswer','`A = 9`',1);contains(0,'checkpointAnswer','`B = 11`',1);
 const divisions=[[-17,5,-3],[17,-5,-3],[-17,-5,3],[17,5,3]];
 const divisionRows=[];
 for(const[a,b,expected]of divisions){
  const result=execute(`    LOAD =${a}\n    DIV =${b}\n    END`);equal('signed integer division',Number(result.acc),expected);
  assert.equal(Number(result.acc),Math.trunc(a/b));modelComparisons++;
  divisionRows.push([`LOAD =${a}; DIV =${b}`,String(a),String(expected)]);
  contains(0,'checkpoint',`\`LOAD =${a}; DIV =${b}\``,2);
 }
 for(const doc of Object.values(documents))equal('displayed signed division stages',tables(subsection(doc,0,'checkpointAnswer',2))[0],divisionRows);
 assert.throws(()=>execute('    LOAD =17\n    DIV =0\n    END'),/Division by zero/);cases++;
 program(0,'checkpoint','l1c',3);output('ADD does not store',trace(0,'checkpointAnswer',0,'l1c',[],3),[4,10]);
 program(0,'checkpoint','l1d',4);const readTwo=trace(0,'checkpointAnswer',0,'l1d',[6,11,20],4);output('two input values',readTwo,[11,10]);equal('unread input',readTwo.cursor,2);contains(0,'checkpointAnswer','`20`',4);
 const wrapped=execute('    LOAD =999998\n    ADD =5\n    STORE R\n    PRINT R\n    END');output('positive modulo boundary',wrapped,[3]);contains(0,'content','$999998+5$');
 const readWrapped=execute('    READ R\n    PRINT R\n    END',[1000007]);output('positive READ reduction',readWrapped,[7]);
 for(const opcode of ['STORE','READ','PRINT','BG'])assert.throws(()=>execute(`    ${opcode} =5\n    END`),/Immediate/);cases++;
 assert.throws(()=>execute('    LOAD X\n    END'),/before/);assert.throws(()=>execute('    load =5\n    END'));assert.throws(()=>execute('    BU MISSING\n    END'),/target/);cases+=3;
 localized(0,'content','not x86 or ARM','不采用 x86 或 ARM');localized(0,'content','does not define indirect-address syntax','没有定义间接寻址语法');

 program(1,'content','branch');program(1,'content','countdown');
 output('greater branch example',trace(1,'content',1,'branch',[5]),[1]);
 output('countdown output count',trace(1,'content',2,'countdown'),[2,1,0]);
 for(const[index,input]of [0,3,7].entries())output('three branch paths',trace(1,'checkpointAnswer',index,'branch',[input],1),[Math.sign(input-3)]);
 for(const input of Array.from({length:15},(_,i)=>i-4)){
  const result=execute(programs.branch,[input]);assert.deepEqual(result.output,[BigInt(Math.sign(input-3))]);assert.equal(result.cursor,1);modelComparisons++;
 }
 program(1,'checkpoint','reload',2);output('LOAD replaced comparison',trace(1,'checkpointAnswer',0,'reload',[],2),[5]);
 output('removed LOAD permits BE',execute(programs.reload.replace('    LOAD =1\n','')),[]);contains(1,'checkpointAnswer','`[]`',2);
 const branchRows=[];
 for(const value of [-2,0,2]){
  const row=[String(value)];
  for(const op of ['BG','BE','BL','BU']){
   const r=execute(`    LOAD =${value}\n    ${op} HIT\n    END\nHIT END`);const taken=r.trace[1].next===4;row.push(taken?'T':'F');equal('branch preserves ACC',Number(r.trace[1].acc),value);
   assert.equal(taken,op==='BU'||op==='BG'&&value>0||op==='BE'&&value===0||op==='BL'&&value<0);modelComparisons++;
  }
  branchRows.push(row);
 }
 for(const doc of Object.values(documents))equal('branch truth table',tables(subsection(doc,1,'checkpointAnswer',3))[0],branchRows);
 output('changed BE countdown',trace(1,'checkpointAnswer',0,'countdown',[],4,programs.countdown.replace('BG TOP','BE TOP')),[2,1]);
 localized(1,'content','no separate saved comparison flag','没有另一个自动保留比较结果的标志寄存器');

 program(2,'content','sentinel');program(2,'content','count');program(2,'content','fixed');program(2,'checkpoint','half',4);
 const sentinel=trace(2,'content',0,'sentinel',[4,-1,0,9]);output('sentinel includes negative data',sentinel,[3]);equal('sentinel stops input stream',sentinel.cursor,3);
 const count=trace(2,'content',1,'count');output('two counter additions',count,[3]);equal('body and test counts',[count.trace.filter(t=>t.op==='ADD').length,count.trace.filter(t=>t.op==='BE').length],[2,3]);
 const first=trace(2,'checkpointAnswer',0,'sentinel',[2,5,0,-4],1);output('sentinel self-check',first,[7]);equal('self-check input/add counts',[first.cursor,first.trace.filter(t=>t.op==='ADD').length],[3,2]);contains(2,'checkpointAnswer','`-4`',1);
 const empty=trace(2,'checkpointAnswer',0,'sentinel',[0,8],2);output('empty data before sentinel',empty,[0]);equal('first zero skips addition',[empty.cursor,empty.trace.filter(t=>t.op==='ADD').length],[1,0]);
 const exhausted=execute(programs.sentinel,[2,5]);equal('input exhaustion is not END',[exhausted.stop,exhausted.cursor,exhausted.output.length,Number(exhausted.memory.get('SUM')),exhausted.pc],['input exhausted',2,0,7,2]);
 localized(2,'checkpointAnswer','not a successful run with output 7','不能说它成功输出了 7',2);
 for(const[index,k]of [0,1].entries()){
  const r=trace(2,'checkpointAnswer',index,'count',[],3,programs.count.replace('COUNT DC 2',`COUNT DC ${k}`));output('counter boundary',r,[k]);equal('counter visits',[r.trace.filter(t=>t.op==='ADD').length,r.trace.filter(t=>t.op==='BE').length],[k,k+1]);
 }
 const fixed=execute(programs.fixed,[],20);equal('fixed positive loop stops only at checker bound',[fixed.stop,fixed.trace.length,fixed.output.length],['step limit',20,0]);
 assert.ok(fixed.trace.slice(1).every(t=>t.memory.get('X')===1n&&t.acc===1n));cases++;
 const missingStore=execute(programs.count.replace('    STORE COUNT\n',''),[],100);equal('no STORE means no countdown',[missingStore.stop,missingStore.output.length],['step limit',0]);assert.ok(missingStore.trace.every(t=>t.memory.get('COUNT')===2n));cases++;
 const half=trace(2,'checkpointAnswer',0,'half',[],4);output('four halvings',half,[4]);
 equal('stored halving values',half.trace.filter(t=>t.op==='STORE'&&t.instruction==='STORE N').map(t=>Number(t.memory.get('N'))),[6,3,1,0]);
 equal('halving and test counts',[half.trace.filter(t=>t.op==='DIV').length,half.trace.filter(t=>t.op==='BE').length],[4,5]);contains(2,'checkpointAnswer','`13 → 6 → 3 → 1 → 0`',4);
 // Independent high-level models check families, including the smallest inputs.
 for(let k=0;k<=20;k++){
  const r=execute(programs.count.replace('COUNT DC 2',`COUNT DC ${k}`));assert.equal(r.stop,'END');assert.deepEqual(r.output,[BigInt(k*(k+1)/2)]);assert.equal(r.trace.filter(t=>t.op==='ADD').length,k);assert.equal(r.trace.filter(t=>t.op==='BE').length,k+1);modelComparisons+=3;
 }
 for(let n=0;n<=63;n++){
  const r=execute(programs.half.replace('N DC 13',`N DC ${n}`));assert.equal(r.stop,'END');let v=n,divisions=0;while(v>0){v=Math.floor(v/2);divisions++;}
  assert.deepEqual(r.output,[BigInt(divisions)]);assert.equal(r.trace.filter(t=>t.op==='BE').length,divisions+1);modelComparisons+=2;
 }
 for(const input of [[0],[-2,0,17],[3,-5,4,0,-8],[2,5]]){
  const r=execute(programs.sentinel,input),zero=input.indexOf(0),consumed=zero<0?input.length:zero+1;
  assert.equal(r.cursor,consumed);assert.equal(r.stop,zero<0?'input exhausted':'END');assert.deepEqual(r.output,zero<0?[]:[BigInt(input.slice(0,zero).reduce((a,b)=>a+b,0))]);modelComparisons+=3;
 }
 const map=JSON.parse(await readFile(new URL('practice-map.json',here),'utf8')),manifest=JSON.parse(await readFile(new URL('../../curriculum.json',here),'utf8'));
 equal('practice map version/unit',[map.version,map.unitId],[1,'assembly']);equal('lesson positions',map.chapters.map(c=>c.position),[0,1,2]);equal('reference distribution',map.chapters.map(c=>c.references.length),[2,3,3]);
 const key=r=>`${r.paperSlug}/${r.questionId}`,refs=map.chapters.flatMap(c=>c.references).map(key).sort();equal('eight unique refs',[refs.length,new Set(refs).size],[8,8]);equal('curriculum references',refs,manifest.units.find(u=>u.id==='assembly').practiceReferences.map(key).sort());
 // Confirm the mapped local questions really are Intermediate C4 assembly.
 for(const ref of map.chapters.flatMap(c=>c.references)){
  const year=ref.paperSlug.match(/^acsl-(\d{4}-\d{4})-intermediate-4$/)?.[1];assert.ok(year);
  const paper=JSON.parse(await readFile(new URL(`../../../../packages/domain/content/acsl/editions/${year}/intermediate/contest-4/paper.json`,here),'utf8'));
  const question=paper.questions.find(q=>q.id===ref.questionId);assert.equal(question.topic.en,'Assembly Language');
  const statement=question.statement?.en??question.stem?.en;
  for(const formalProgram of blocks(statement))for(const doc of Object.values(documents))for(const ch of doc.chapters)assert.ok(!ch.content.includes(formalProgram)&&!ch.checkpoint.includes(formalProgram),'Do not reproduce a formal program');
 }
 cases++;
 equal('all displayed execution tables checked once per language',traceRows,231);
 return{cases,modelComparisons,traceRowsPerLanguage:traceRows,checkpointsPerLanguage:12,programFixtures:Object.keys(programs).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkTutorial(),null,2));
