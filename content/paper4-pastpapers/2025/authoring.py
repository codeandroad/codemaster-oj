"""Rebuild six 2025 Paper 4 manifests. Trusted authoring only: never executes candidate/reference code.
Run with Python 3 from any directory. Original user-supplied text data is snapshotted in source-data.json.
"""
import ast,json,re,pathlib,textwrap,copy
HERE=pathlib.Path(__file__).resolve().parent
SOURCE=json.loads((HERE/'source-data.json').read_text())
PACKAGES={}
LOAD='''import ast,types,contextlib,io
with open('/w/main.py',encoding='utf-8') as f:
    tree=ast.parse(f.read(),filename='/w/main.py')
class_names={n.name for n in tree.body if isinstance(n,ast.ClassDef)}
safe_calls={'range','len','list','tuple','dict','set','int','float','str','bool'}|class_names
def safe_expr(n):
    if n is None:return True
    if isinstance(n,(ast.Constant,ast.Name)):return True
    if isinstance(n,ast.Call):
        return isinstance(n.func,ast.Name) and n.func.id in safe_calls and all(safe_expr(a) for a in n.args) and all(safe_expr(k.value) for k in n.keywords)
    if isinstance(n,(ast.List,ast.Tuple,ast.Set)):return all(safe_expr(x) for x in n.elts)
    if isinstance(n,ast.Dict):return all(safe_expr(x) for x in n.keys+n.values)
    if isinstance(n,(ast.ListComp,ast.SetComp,ast.GeneratorExp)):
        return safe_expr(n.elt) and all(safe_expr(g.iter) and all(safe_expr(x) for x in g.ifs) for g in n.generators)
    if isinstance(n,ast.DictComp):return safe_expr(n.key) and safe_expr(n.value) and all(safe_expr(g.iter) and all(safe_expr(x) for x in g.ifs) for g in n.generators)
    if isinstance(n,ast.UnaryOp):return safe_expr(n.operand)
    if isinstance(n,ast.BinOp):return safe_expr(n.left) and safe_expr(n.right)
    if isinstance(n,ast.BoolOp):return all(safe_expr(x) for x in n.values)
    if isinstance(n,ast.Compare):return safe_expr(n.left) and all(safe_expr(x) for x in n.comparators)
    if isinstance(n,ast.IfExp):return safe_expr(n.test) and safe_expr(n.body) and safe_expr(n.orelse)
    if isinstance(n,ast.Subscript):return safe_expr(n.value) and safe_expr(n.slice)
    if isinstance(n,ast.Slice):return safe_expr(n.lower) and safe_expr(n.upper) and safe_expr(n.step)
    if isinstance(n,ast.Attribute):return safe_expr(n.value)
    return False
def declaration(n):
    if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):return True
    if isinstance(n,(ast.Assign,ast.AnnAssign)):return safe_expr(n.value)
    if isinstance(n,ast.For):return safe_expr(n.iter) and all(declaration(x) and not isinstance(x,(ast.FunctionDef,ast.ClassDef,ast.Import,ast.ImportFrom)) for x in n.body+n.orelse)
    return False
c=types.ModuleType('candidate');c.__file__='/w/main.py'
with contextlib.redirect_stdout(io.StringIO()):
    for n in tree.body:
        if declaration(n):
            try:exec(compile(ast.fix_missing_locations(ast.Module(body=[n],type_ignores=[])),'/w/main.py','exec'),c.__dict__)
            except (NameError,IndexError,AttributeError,TypeError,ValueError):
                if not isinstance(n,(ast.Assign,ast.AnnAssign,ast.For)):raise
'''
def driver(body,load=True):
    return 'try:\n'+textwrap.indent((LOAD if load else '')+textwrap.dedent(body).strip()+'\n','    ')+'except Exception:\n    print("FAIL")\n'
def case(id,body,out='PASS\n',public=True,files=None,load=True):
    d={'id':id,'public':public,'driverCode':driver(body,load),'expectedStdout':out}
    if files is not None:d['inputFiles']=files
    return d
def maincase(id,inputs,condition,public=True,files=None,extra=''):
    body='''import builtins,contextlib,io,runpy,re
inputs = iter(INPUTS)
builtins.input = lambda prompt='': next(inputs)
out=io.StringIO()
with contextlib.redirect_stdout(out):
    result=runpy.run_path('/w/main.py',run_name='__main__')
s=out.getvalue()
tokens=s.split()
'''.replace('INPUTS',repr(inputs))+extra+'\nprint("PASS" if ('+condition+') else "FAIL")\n'
    return case(id,body,public=public,files=files,load=False)
def stage(q,part,marks,mode,desc=None):
    return {'id':q+'_'+re.sub('[^a-zA-Z0-9]','',part),'title':q[1:]+part,'description':desc or ('Teacher checks the source structure required by this subpart.' if mode=='manual' else 'Teacher reviews saved execution and original requested evidence.' if mode=='evidence' else 'Behavior is checked in the isolated executor; teacher also checks the stated algorithm and method calls.'),'maxMarks':marks,'judgeMode':mode}
def question(key,title,statement,stages,initial=None,outputs=None):
    return {'key':key,'title':title,'statement':statement,'starterCode':'# Complete every subpart in one Python 3 program.\n','initialFiles':initial or {},'outputFiles':outputs or [],'stages':stages}
def paper(key,qs,cases):
    summer='_s25_' in key
    p={'format':'codemaster-paper4','version':1,'paper':{'title':f'9618 Paper 4 · {"May/June" if summer else "October/November"} 2025 · Paper {key[-2:]}','description':'Classroom practice from the user-supplied original paper. Automatic behavior checks support teacher marking; required source structure and evidence remain teacher-reviewed.','examYear':2025,'examSession':'summer' if summer else 'autumn','examVariant':int(key[-2:])},'questions':qs,'runnerCases':cases,'referenceSolutions':{q['key']:(HERE/'refs'/f'{key}-{q["key"]}.py').read_text() for q in qs}}
    PACKAGES[key]=p
    return p
# Statements retain original English requirements and mark labels. Word evidence templates are not imported.
def statement(key,q):return SOURCE[key]['statements'][q]
# 9618/42 May/June: LIFO expressions, overflow records, animal inheritance.
k='9618_s25_42'
q1=question('Q1','A stack and sequential calculations',statement(k,'Q1'),[
 stage('Q1','(a)',2,'manual'),stage('Q1','(b)',4,'auto'),stage('Q1','(c)',4,'auto'),stage('Q1','(d)',6,'auto','Check unknown-length reading, calls to Push and exception handling; functional checks cover normal and overflowing files.'),stage('Q1','(e)',7,'auto'),stage('Q1','(f)(i)',2,'auto'),stage('Q1','(f)(ii)',2,'evidence')],{n:v for n,v in SOURCE[k]['initialFiles'].items() if n!='HashData.txt'})
q2=question('Q2','A hash table with a spare array',statement(k,'Q2'),[
 stage('Q2','(a)',2,'manual'),stage('Q2','(b)(i)',1,'manual'),stage('Q2','(b)(ii)',2,'auto'),stage('Q2','(c)',2,'auto'),stage('Q2','(d)',6,'auto'),stage('Q2','(e)',5,'auto'),stage('Q2','(f)(i)',2,'auto'),stage('Q2','(f)(ii)',1,'auto'),stage('Q2','(f)(iii)',1,'evidence')],{'HashData.txt':SOURCE[k]['initialFiles']['HashData.txt']})
q3=question('Q3','Animals, parrots and wolves',statement(k,'Q3'),[
 stage('Q3','(a)(i)',4,'manual','Check Animal attributes, constructor parameters and Python declaration comments.'),stage('Q3','(a)(ii)',3,'auto'),stage('Q3','(b)(i)',4,'manual','Check inheritance, parent constructor, new attributes and ChangeNumberWords. Behavioral updates are exercised in (b)(ii).'),stage('Q3','(b)(ii)',2,'auto'),stage('Q3','(c)(i)',4,'manual','Check Wolf inheritance, parent constructor and additive SetTerritorySize method. Updates are exercised in (c)(ii).'),stage('Q3','(c)(ii)',2,'auto'),stage('Q3','(d)(i)',2,'manual'),stage('Q3','(d)(ii)',3,'auto'),stage('Q3','(d)(iii)',2,'evidence')])
reset='c.Stack=["-1"]*20\nc.TopOfStack=-1\n'
record='''
def field(r,n):
    return getattr(r,n) if hasattr(r,n) else getattr(r,'Get'+n)()
def make(k,a,b):
    T=getattr(c,'NewRecord',getattr(c,'Record',None))
    try: return T(k,a,b)
    except TypeError:
        r=T();r.Key=k;r.Item1=a;r.Item2=b;return r
c.HashTable=[None]*200
c.Spare=[None]*100
'''
spares=[];seen=set()
for row in SOURCE[k]['initialFiles']['HashData.txt'].splitlines():
 values=[int(x) for x in row.split(',')]
 if values[0]%200 in seen:spares.append(values[0])
 else:seen.add(values[0]%200)
cs={
 'Q1_b':[case('push-first-full',reset+'''print(c.Push("hello"),c.TopOfStack,c.Stack[0])
for i in range(19): c.Push(str(i))
print(c.Push("overflow"),c.TopOfStack,c.Stack[19])''','1 0 hello\n-1 19 18\n'),case('push-does-not-overwrite',reset+'''for i in range(20): c.Push(str(i))
before=c.Stack[:]
print(c.Push("bad"),c.Stack==before,c.TopOfStack)''','-1 True 19\n',False)],
 'Q1_c':[case('pop-lifo-empty',reset+'''print(c.Pop())
c.Push("A");c.Push("B")
print(c.Pop(),c.Pop(),c.Pop(),c.TopOfStack)''','-1\nB A -1 -1\n'),case('pop-refill',reset+'''c.Push("7");c.Pop();c.Push("0")
print(c.Pop(),c.Pop())''','0 -1\n',False)],
 'Q1_d':[case('read-file',reset+'''c.ReadData("StackData.txt")
print(c.TopOfStack, *c.Stack[:c.TopOfStack+1])''','8 3 + 2 * 2 ^ 2 - 10\n'),case('read-overflow',reset+'''import contextlib,io
out=io.StringIO()
with contextlib.redirect_stdout(out): c.ReadData("Overflow.txt")
print(c.TopOfStack,c.Stack[:20]==[str(i) for i in range(20)],out.getvalue().count("Stack full"))''','19 True 2\n',False,{'Overflow.txt':'\n'.join(map(str,range(22)))+'\n'}),case('read-exception',reset+'''import contextlib,io
with contextlib.redirect_stdout(io.StringIO()): c.ReadData("Missing.txt")
print("PASS" if c.TopOfStack==-1 else "FAIL")''',public=False)],
 'Q1_e':[case('diagram-left-to-right',reset+'''for v in ["2","-","3","+","10"]: c.Push(v)
print(float(c.Calculate()),c.TopOfStack)''','11.0 -1\n'),case('all-operators',reset+'''for v in ["2","^","3","*","5","/","6","-","4","+","20"]: c.Push(v)
print('PASS' if abs(c.Calculate()-116.64)<1e-9 and c.TopOfStack==-1 else 'FAIL')''',public=False),case('division-noninteger',reset+'''for v in ["2","/","5"]:c.Push(v)
print(float(c.Calculate()))''','2.5\n',False)],
 'Q1_fi':[maincase('stack-source', ['StackData.txt'],'any(abs(float(x)-131)<1e-9 for x in re.findall(r"-?\\d+(?:\\.\\d+)?",s))'),maincase('second-source',['SecondStack.txt'],'any(abs(float(x)-320)<1e-9 for x in re.findall(r"-?\\d+(?:\\.\\d+)?",s))',False)],
 'Q2_bii':[case('initialise',record+'''c.Initialise()
print(len(c.HashTable),len(c.Spare),all(field(r,n)==-1 for r in c.HashTable+c.Spare for n in ['Key','Item1','Item2']))''','200 100 True\n')],
 'Q2_c':[case('modulo-200','print(*(c.CalculateHash(x) for x in [0,199,200,646,1248]))','0 199 0 46 48\n'),case('large-key','print(c.CalculateHash(99999))','199\n',False)],
 'Q2_d':[case('collisions-next-spare',record+'''c.Initialise()
for vals in [(1,10,20),(201,30,40),(401,50,60),(2,70,80)]: c.InsertIntoHash(make(*vals))
print(*(field(c.HashTable[i],'Key') for i in [1,2]))
print(*(field(c.Spare[i],'Key') for i in [0,1,2]))
print(field(c.Spare[1],'Item1'),field(c.Spare[1],'Item2'))''','1 2\n201 401 -1\n50 60\n'),case('collision-index-199',record+'''c.Initialise()
for vals in [(199,1,2),(399,3,4)]: c.InsertIntoHash(make(*vals))
print(field(c.HashTable[199],'Key'),field(c.Spare[0],'Key'),field(c.HashTable[0],'Key'))''','199 399 -1\n',False)],
 'Q2_e':[case('read-all-records',record+'''c.Initialise();c.CreateHashTable()
print(field(c.HashTable[46],'Key'),field(c.HashTable[46],'Item1'),field(c.HashTable[46],'Item2'))
print(sum(field(r,'Key')!=-1 for r in c.HashTable)+sum(field(r,'Key')!=-1 for r in c.Spare))''','646 12 568\n199\n'),case('small-file',record+'''c.Initialise();c.CreateHashTable()
print(field(c.HashTable[0],'Key'),field(c.Spare[0],'Key'),field(c.Spare[0],'Item2'))''','200 400 9\n',False,{'HashData.txt':'200,1,2\n400,8,9\n'})],
 'Q2_fi':[case('print-only-used-spare',record+'''c.Initialise()
for vals in [(5,1,2),(205,3,4),(405,5,6)]:c.InsertIntoHash(make(*vals))
c.PrintSpare()''','205\n405\n')],
 'Q2_fii':[maincase('main-spare-keys',[],f'[int(x) for x in tokens] == {spares!r}')],
 'Q3_aii':[case('animal-description','print(c.Animal("Teddy","Bark",4,6).Description())',"The animal's name is Teddy, it makes a Bark, its size is 4 and its intelligence level is 6\n"),case('animal-different','print(c.Animal("Mouse","Squeak",1,3).Description())',"The animal's name is Mouse, it makes a Squeak, its size is 1 and its intelligence level is 3\n",False)],
 'Q3_bii':[case('parrot-add-words','p=c.Parrot("Chewie","Squawk",1,10,30,29)\np.ChangeNumberWords(2)\nprint(p.Description())',"The animal's name is Chewie, it makes a Squawk, its size is 1 and its intelligence level is 10. It has a wingspan of 30cm and can say 31 words.\n"),case('parrot-negative-update','p=c.Parrot("Pip","Chirp",2,7,12,10)\np.ChangeNumberWords(-3)\np.ChangeNumberWords(0)\nprint(p.Description())',"The animal's name is Pip, it makes a Chirp, its size is 2 and its intelligence level is 7. It has a wingspan of 12cm and can say 7 words.\n",False)],
 'Q3_cii':[case('wolf-add-territory','w=c.Wolf("Nighteyes","Howl",8,7,100)\nw.SetTerritorySize(-20)\nprint(w.Description())',"The animal's name is Nighteyes, it makes a Howl, its size is 8 and its intelligence level is 7. Its territory is 80 square miles.\n"),case('wolf-positive-update','w=c.Wolf("Grey","Howl",7,8,9)\nw.SetTerritorySize(4)\nprint(w.Description())',"The animal's name is Grey, it makes a Howl, its size is 7 and its intelligence level is 8. Its territory is 13 square miles.\n",False)],
 'Q3_dii':[maincase('three-animals',[],'''all(x in s for x in ["Chewie", "Nighteyes", "Copper", "31 words", "80 square miles", "Neigh"])''')]
}
paper(k,[q1,q2,q3],cs)
# 9618/43 May/June: linear queue, insertion sort and binary search, linked list.
k='9618_s25_43'
q1=question('Q1','A linear queue and file total',statement(k,'Q1'),[stage('Q1','(a)',3,'manual'),stage('Q1','(b)',6,'auto'),stage('Q1','(c)',5,'auto'),stage('Q1','(d)',6,'auto','Check calls to Enqueue, unknown-length reading and file exception handling.'),stage('Q1','(e)(i)',5,'auto','Behavior checks the total; teacher checks CreateQueue and Dequeue calls.'),stage('Q1','(e)(ii)',1,'evidence')],SOURCE[k]['initialFiles'])
q2=question('Q2','Insertion sort and binary search',statement(k,'Q2'),[stage('Q2','(a)',1,'manual'),stage('Q2','(b)',5,'auto','Check insertion-sort algorithm and no inbuilt sorting function; tests verify ordering.'),stage('Q2','(c)',2,'auto'),stage('Q2','(d)(i)',2,'auto'),stage('Q2','(d)(ii)',1,'evidence'),stage('Q2','(e)',6,'auto','Check binary-search algorithm and no inbuilt searching function.'),stage('Q2','(f)(i)',2,'manual','Review four calls for 0, 345, 67 and 2, and appropriate found-index/not-found messages.'),stage('Q2','(f)(ii)',1,'evidence')])
q3=question('Q3','An object-oriented linked list',statement(k,'Q3'),[stage('Q3','(a)(i)',4,'manual'),stage('Q3','(a)(ii)',3,'auto'),stage('Q3','(a)(iii)',2,'auto'),stage('Q3','(b)(i)',2,'manual'),stage('Q3','(b)(ii)',4,'auto','Teacher also checks use of Node and SetNextNode, with new nodes inserted at the head.'),stage('Q3','(b)(iii)',3,'auto'),stage('Q3','(b)(iv)',6,'auto'),stage('Q3','(c)(i)',3,'auto'),stage('Q3','(c)(ii)',2,'evidence')])
reset='c.Queue=[-1]*50\nc.HeadPointer=-1\nc.TailPointer=-1\n'
original=[0,3,4,56,67,44,43,32,31,345,45,6,54,1]
sorted_original=[0,1,3,4,6,31,32,43,44,45,54,56,67,345]
total=sum(map(int,SOURCE[k]['initialFiles']['QueueData.txt'].splitlines()))
cs={
 'Q1_b':[case('enqueue-first-full',reset+'''print(c.Enqueue(9),c.HeadPointer,c.TailPointer,c.Queue[0])
for i in range(1,50): c.Enqueue(i)
print(c.Enqueue(999),c.TailPointer,c.Queue[49])''','True 0 0 9\nFalse 49 49\n'),case('no-overwrite',reset+'''for i in range(50):c.Enqueue(i+1)
before=c.Queue[:]
print(c.Enqueue(88),c.Queue==before)''','False True\n',False)],
 'Q1_c':[case('dequeue-order-empty',reset+'''print(c.Dequeue())
for i in [7,9,11]:c.Enqueue(i)
print(c.Dequeue(),c.Dequeue(),c.Dequeue(),c.Dequeue())''','-1\n7 9 11 -1\n'),case('dequeue-all-50',reset+'''for i in range(50):c.Enqueue(i+1)
print('PASS' if [c.Dequeue() for i in range(50)]==list(range(1,51)) and c.Dequeue()==-1 else 'FAIL')''',public=False)],
 'Q1_d':[case('queue-source',reset+'''c.CreateQueue()
values=[]
v=c.Dequeue()
while v!=-1:
    values.append(v);v=c.Dequeue()
print(len(values),sum(values),values[:3],values[-3:])''',f'46 {total} [15, 8, 65] [45, 87, 54]\n'),case('queue-overflow',reset+'''import contextlib,io
out=io.StringIO()
with contextlib.redirect_stdout(out):c.CreateQueue()
print(c.TailPointer,out.getvalue().count('Queue full'))''','49 2\n',False,{'QueueData.txt':'\n'.join(map(str,range(1,53)))+'\n'}),case('queue-read-error',reset+'''import builtins,io,contextlib
def broken(*a,**k):raise OSError('unavailable')
builtins.open=broken
with contextlib.redirect_stdout(io.StringIO()):c.CreateQueue()
print('PASS')''',public=False)],
 'Q1_ei':[maincase('original-file-total',[],f'"{total}" in re.findall(r"-?\\d+",s)'),maincase('different-file-total',[],'"18" in re.findall(r"-?\\d+",s)',False,{'QueueData.txt':'2\n3\n13\n'})],
 'Q2_b':[case('sort-original',f'print(*c.InsertionSort({original!r}))',' '.join(map(str,sorted_original))+'\n'),case('sort-duplicates-nonnegative','print(*c.InsertionSort([5,2,5,0,2,13,12,11,10,9,8,7,6,4]))','0 2 2 4 5 5 6 7 8 9 10 11 12 13\n',False),case('sort-already-ordered','print(*c.InsertionSort(list(range(14))))','0 1 2 3 4 5 6 7 8 9 10 11 12 13\n',False)],
 'Q2_c':[case('array-one-line','c.OutputArray(list(range(1,15)))','1 2 3 4 5 6 7 8 9 10 11 12 13 14\n')],
 'Q2_di':[maincase('unsorted-then-sorted',[],f'len(lines)>=2 and lines[0]=={list(map(str,original))!r} and lines[1]=={list(map(str,sorted_original))!r}',extra='lines=[line.split() for line in s.splitlines() if re.fullmatch(r"\\s*(?:-?\\d+\\s+){13}-?\\d+\\s*",line)]')],
 'Q2_e':[case('paper-searches',f'print(*(c.Search({sorted_original!r},v) for v in [0,345,67,2]))','0 13 12 -1\n'),case('search-other-fourteen','a=list(range(0,28,2))\nprint(c.Search(a,0),c.Search(a,26),c.Search(a,27),c.Search(a,8))','0 13 -1 4\n',False)],
 'Q3_aii':[case('node-getters','n=c.Node(23)\nprint(n.GetData(),n.GetNextNode() is None)','23 True\n')],
 'Q3_aiii':[case('node-links','a=c.Node(1);b=c.Node(2)\na.SetNextNode(b)\nprint(a.GetNextNode() is b,b.GetNextNode() is None)\na.SetNextNode(None)\nprint(a.GetNextNode() is None)','True True\nTrue\n')],
 'Q3_bii':[case('head-insertion','l=c.LinkedList()\nfor n in [10,20,30]:l.InsertNode(n)\nprint(l.Traverse().strip())','30 20 10\n')],
 'Q3_biii':[case('traverse-empty-and-values','l=c.LinkedList()\nprint(repr(l.Traverse().strip()))\nfor n in [4,4,-2]:l.InsertNode(n)\nprint(l.Traverse().strip())',"''\n-2 4 4\n")],
 'Q3_biv':[case('remove-middle-head-tail','l=c.LinkedList()\nprint(l.RemoveNode(5))\nfor n in [10,20,30,40]:l.InsertNode(n)\nprint(l.RemoveNode(20),l.Traverse().strip())\nprint(l.RemoveNode(40),l.Traverse().strip())\nprint(l.RemoveNode(10),l.Traverse().strip())\nprint(l.RemoveNode(99),l.RemoveNode(30),l.RemoveNode(30))','False\nTrue 40 30 10\nTrue 30 10\nTrue 30\nFalse True False\n'),case('only-first-duplicate','l=c.LinkedList()\nfor n in [5,2,5,3]:l.InsertNode(n)\nprint(l.RemoveNode(5),l.Traverse().strip())','True 3 2 5\n',False)],
 'Q3_ci':[maincase('paper-linked-list',[],'lines==[["50","40","30","20","10"],["50","40","20","10"]]',extra='lines=[line.split() for line in s.splitlines() if line.strip()]')]
}
paper(k,[q1,q2,q3],cs)
# 9618/41 October/November: random stack, station capacities, 2D collision buckets.
k='9618_w25_41'
q1=question('Q1','A stack and extreme values',statement(k,'Q1'),[stage('Q1','(a)',2,'manual'),stage('Q1','(b)',4,'auto'),stage('Q1','(c)',4,'auto'),stage('Q1','(d)',4,'manual','Review generation of at most 40 integers in 0..1000 inclusive, stopping after the first failed Push and outputting Stack full. Randomness has no mandated seed or library API.'),stage('Q1','(e)',4,'auto','Behavior checks extrema and a drained stack; teacher checks repeated Pop calls and meaningful messages.'),stage('Q1','(f)(i)',1,'manual'),stage('Q1','(f)(ii)',1,'evidence')])
q2=question('Q2','Trains and station platforms',statement(k,'Q2'),[stage('Q2','(a)(i)',4,'manual','Review private attributes, constructor and declaration comments.'),stage('Q2','(a)(ii)',3,'auto'),stage('Q2','(b)',2,'manual'),stage('Q2','(c)(i)',3,'manual'),stage('Q2','(c)(ii)',4,'auto'),stage('Q2','(c)(iii)',6,'auto'),stage('Q2','(d)(i)',2,'manual'),stage('Q2','(d)(ii)',4,'auto'),stage('Q2','(d)(iii)',2,'evidence')])
q3=question('Q3','A hash table with collision buckets',statement(k,'Q3'),[stage('Q3','(a)',2,'manual'),stage('Q3','(b)',2,'manual','Check independent 100x10 rows and empty/null record initialisation by InitialiseHashTable.'),stage('Q3','(c)',2,'auto'),stage('Q3','(d)',4,'auto'),stage('Q3','(e)',5,'auto'),stage('Q3','(f)',5,'auto'),stage('Q3','(g)(i)',3,'auto'),stage('Q3','(g)(ii)',2,'evidence')],SOURCE[k]['initialFiles'])
reset='c.Stack=[None]*30\nc.TopOfStack=-1\n'
hashreset='c.HashTable=[[None for j in range(10)] for i in range(100)]\nc.InitialiseHashTable()\n'
cs={
 'Q1_b':[case('push-to-capacity',reset+'''print(c.Push(0),c.TopOfStack,c.Stack[0])
for i in range(1,30):c.Push(i)
print(c.Push(1000),c.TopOfStack,c.Stack[29])''','True 0 0\nFalse 29 29\n'),case('push-reuse',reset+'''c.Push(1000);c.Pop()
print(c.Push(8),c.TopOfStack,c.Stack[0])''','True 0 8\n',False)],
 'Q1_c':[case('pop-lifo-sentinel',reset+'''print(c.Pop())
c.Push(0);c.Push(1000)
print(c.Pop(),c.Pop(),c.Pop(),c.TopOfStack)''','-999\n1000 0 -999 -1\n')],
 'Q1_e':[case('extrema-range-boundaries',reset+'''import contextlib,io,re
for v in [300,0,27,1000,46]:c.Push(v)
out=io.StringIO()
with contextlib.redirect_stdout(out):c.FindValues()
nums=[int(x) for x in re.findall(r'-?\d+',out.getvalue())]
print('PASS' if 0 in nums and 1000 in nums and c.Pop()==-999 else 'FAIL')'''),case('extrema-single-item',reset+'''import contextlib,io,re
c.Push(73)
out=io.StringIO()
with contextlib.redirect_stdout(out):c.FindValues()
nums=[int(x) for x in re.findall(r'-?\d+',out.getvalue())]
print('PASS' if 73 in nums and c.Pop()==-999 else 'FAIL')''',public=False),case('extrema-all-positive',reset+'''import contextlib,io,re
for v in [12,9,16]:c.Push(v)
out=io.StringIO()
with contextlib.redirect_stdout(out):c.FindValues()
nums=[int(x) for x in re.findall(r'-?\d+',out.getvalue())]
print('PASS' if 9 in nums and 16 in nums and c.Pop()==-999 else 'FAIL')''',public=False)],
 'Q2_aii':[case('train-getters','t=c.Train("12ADV",134)\nprint(t.GetTrainIDNumber(),t.GetRoute())','12ADV 134\n'),case('train-different-values','t=c.Train("NEW",0)\nprint(t.GetTrainIDNumber(),t.GetRoute())','NEW 0\n',False)],
 'Q2_cii':[case('capacity-two','s=c.Station("STH",2)\nprint(s.AddTrain(c.Train("A",1)),s.AddTrain(c.Train("B",2)),s.AddTrain(c.Train("C",3)))','True True False\n'),case('capacity-one','s=c.Station("NTH",1)\nprint(s.AddTrain(c.Train("X",9)),s.AddTrain(c.Train("Y",8)))','True False\n',False)],
 'Q2_ciii':[case('empty-station','print(c.Station("Empty",2).GetTrains())','There are no trains\n'),case('station-description','s=c.Station("NT1",2)\ns.AddTrain(c.Train("48RTG",43));s.AddTrain(c.Train("6UFH",12))\nprint(s.GetTrains())','The trains at station NT1 are:\n48RTG on route number 43\n6UFH on route number 12\n'),case('full-keeps-first-train','s=c.Station("ONE",1)\ns.AddTrain(c.Train("A",7));s.AddTrain(c.Train("B",8))\nprint(s.GetTrains())','The trains at station ONE are:\nA on route number 7\n',False)],
 'Q2_dii':[maincase('paper-stations',[],'''all(x in " ".join(tokens) for x in ["Station is full", "The trains at station STH are: 12ADV on route number 134 33ART on route number 20", "The trains at station NTH are: 21VBC on route number 24"])''')],
 'Q3_c':[case('hash-mod-100','print(*(c.Hash(v) for v in [0,99,100,528,1128,1999]))','0 99 0 28 28 99\n')],
 'Q3_d':[case('collision-buckets',hashreset+'''for k,d in [(28,'a'),(128,'b'),(99,'z')]:c.InsertData(c.Record(k,d))
print(c.HashTable[28][0].Key,c.HashTable[28][1].Key,c.HashTable[99][0].Data)''','28 128 z\n'),case('tenth-collision',hashreset+'''for i in range(10):c.InsertData(c.Record(7+100*i,str(i)))
print(*(c.HashTable[7][i].Key for i in range(10)))''','7 107 207 307 407 507 607 707 807 907\n',False)],
 'Q3_e':[case('read-original-data',hashreset+'''c.ReadData()
print(c.GetRecord(528),c.GetRecord(1128),c.GetRecord(1828),c.GetRecord(1062))''','permission peace precedent up\n'),case('read-other-file',hashreset+'''c.ReadData()
print(c.GetRecord(5),c.GetRecord(105),c.GetRecord(205),c.GetRecord(6))''','alpha beta gamma Not found\n',False,{'HashTableData.txt':'5,alpha\n105,beta\n205,gamma\n'+''.join(str(10000+i)+',filler'+str(i)+'\n' for i in range(197))})],
 'Q3_f':[case('lookup-hit-and-miss',hashreset+'''for k,d in [(0,'zero'),(100,'hundred'),(200,'two hundred')]:c.InsertData(c.Record(k,d))
print(c.GetRecord(0),c.GetRecord(200),c.GetRecord(300),c.GetRecord(99),sep='\\n')''','zero\ntwo hundred\nNot found\nNot found\n'),case('lookup-tenth-slot',hashreset+'''for i in range(10):c.InsertData(c.Record(99+100*i,str(i)))
print(c.GetRecord(999),c.GetRecord(1099))''','9 Not found\n',False)],
 'Q3_gi':[maincase('five-original-keys',['528','1128','1828','1062','39'],'tokens==["permission","peace","precedent","up","Not","found"]')]
}
paper(k,[q1,q2,q3],cs)
# 9618/42 October/November: bird movement, random arrays and an array binary tree.
k='9618_w25_42'
q1=question('Q1','Bird positions and movement',statement(k,'Q1'),[stage('Q1','(a)(i)',4,'manual','Check four private attributes, constructor parameters, 500.0 initial coordinates and declaration comments.'),stage('Q1','(a)(ii)',2,'auto'),stage('Q1','(a)(iii)',3,'auto'),stage('Q1','(a)(iv)',5,'auto'),stage('Q1','(b)',3,'manual'),stage('Q1','(c)(i)',8,'manual','Review initial species/position outputs, choice of either bird, direction and minute inputs repeated until valid, Move call and meaningful updated-position output. The paper specifies no exact selection menu or prompt text.'),stage('Q1','(c)(ii)',3,'evidence','Review four separate runs: Cockatiel N 60, Macaw S 30, Cockatiel W 30, Macaw E 60.')])
q2=question('Q2','Unique random data, sorting and searching',statement(k,'Q2'),[stage('Q2','(a)',3,'manual'),stage('Q2','(b)',3,'auto'),stage('Q2','(c)',5,'auto','Review bubble-sort algorithm, arbitrary array length and no inbuilt sort; tests check ordering.'),stage('Q2','(d)(i)',3,'auto'),stage('Q2','(d)(ii)',1,'evidence'),stage('Q2','(e)',6,'auto','Review actual recursive binary-search implementation; tests cover hits, misses, and narrowed bounds.'),stage('Q2','(f)(i)',3,'auto'),stage('Q2','(f)(ii)',2,'evidence')])
q3=question('Q3','An array binary tree and a text file',statement(k,'Q3'),[stage('Q3','(a)',3,'manual'),stage('Q3','(b)',7,'auto'),stage('Q3','(c)',4,'auto','Check file values inserted in original order using AddNode.'),stage('Q3','(d)',5,'auto','Review write exception handling; tests verify all 50 comma-separated rows and replacement of an existing file.'),stage('Q3','(e)(i)',1,'auto'),stage('Q3','(e)(ii)',1,'evidence','Review Tree.txt evidence showing all lines and the filename.')],SOURCE[k]['initialFiles'],['Tree.txt'])
birdhelper='''
import inspect,re
def bird(speed,species):
    names=list(inspect.signature(c.Bird).parameters)
    if names and any(x in names[0].lower() for x in ['dist','speed']):
        return c.Bird(speed,species)
    b=c.Bird(species,speed)
    return b if b.GetSpecies()==species else c.Bird(speed,species)
def position(b):
    s=b.GetPosition()
    m=re.fullmatch(r'\\s*X\\s*=\\s*(-?[0-9]+(?:\\.[0-9]+)?)\\s+Y\\s*=\\s*(-?[0-9]+(?:\\.[0-9]+)?)\\s*',s)
    if not m: raise ValueError('position format')
    return tuple(float(x) for x in m.groups())
'''
treereset='c.TreeArray=[[-1,-1,-1] for i in range(50)]\nc.RootPointer=-1\nc.FreeNode=0\n'
# Independent authoring oracle models pointer updates without executing a reference program.
def tree_rows(values):
    rows=[[-1,-1,-1] for _ in range(50)]
    for n,value in enumerate(values):
        rows[n][1]=value
        if n==0:continue
        parent=0
        while True:
            col=0 if value<rows[parent][1] else 2
            if rows[parent][col]==-1:rows[parent][col]=n;break
            parent=rows[parent][col]
    return rows
def tree_text(rows):return ''.join(','.join(map(str,row))+'\n' for row in rows)
source_tree=tree_text(tree_rows([int(x) for x in SOURCE[k]['initialFiles']['TreeData.txt'].splitlines()]))
def random_main(id,which,public):
    return case(id,'''import builtins,contextlib,io,re,runpy
out=io.StringIO()
def arrays():
    return [[int(t) for t in line.split()] for line in out.getvalue().splitlines() if re.fullmatch(r'\\s*(?:\\d+\\s+){19}\\d+\\s*',line)]
def answer(prompt=''):
    a=arrays()[-1]
    return str(a[0] if WHICH=='first' else a[-1] if WHICH=='last' else next(x for x in range(101) if x not in a))
builtins.input=answer
with contextlib.redirect_stdout(out):runpy.run_path('/w/main.py',run_name='__main__')
s=out.getvalue();a=arrays()
ok=len(a)==2 and len(a[0])==20 and len(set(a[0]))==20 and all(0<=x<=100 for x in a[0]) and a[1]==sorted(a[0]) and 'Sorted' in s
suffix=s.splitlines()[-1].split()
if WHICH=='first':ok=ok and suffix[-4:]==['Found','at','position','0']
elif WHICH=='last':ok=ok and suffix[-4:]==['Found','at','position','19']
else:ok=ok and suffix[-2:]==['Not','found']
print('PASS' if ok else 'FAIL')
'''.replace('WHICH',repr(which)),public=public,load=False)
cs={
 'Q1_aii':[case('species-name',birdhelper+'print(bird(71.0,"Cockatiel").GetSpecies())','Cockatiel\n')],
 'Q1_aiii':[case('initial-position',birdhelper+'print(position(bird(56.0,"Macaw")))','(500.0, 500.0)\n')],
 'Q1_aiv':[case('north-and-south',birdhelper+'''b=bird(71.0,'Cockatiel');b.Move('N',60)
print(position(b))
b=bird(56.0,'Macaw');b.Move('S',30)
print(position(b))''','(500.0, 571.0)\n(500.0, 472.0)\n'),case('west-and-east',birdhelper+'''b=bird(71.0,'Cockatiel');b.Move('W',30)
print(position(b))
b=bird(56.0,'Macaw');b.Move('E',60)
print(position(b))''','(464.5, 500.0)\n(556.0, 500.0)\n',False),case('zero-and-maximum',birdhelper+'''b=bird(0.0,'Still');b.Move('N',500)
print(position(b))
b=bird(60.0,'Fast');b.Move('S',500);b.Move('W',500);b.Move('E',0)
print(position(b))''','(500.0, 500.0)\n(0.0, 0.0)\n',False)],
 'Q2_b':[case('print-array','c.PrintArray([0,100]+list(range(1,19)))','0 100 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18\n')],
 'Q2_c':[case('bubble-reverse','print(*c.BubbleSort([9,7,5,3,1]))','1 3 5 7 9\n'),case('bubble-short-and-duplicates','print(c.BubbleSort([]),c.BubbleSort([4]),c.BubbleSort([2,0,2,1]))','[] [4] [0, 1, 2, 2]\n',False)],
 'Q2_di':[random_main('random-main-output','absent',True)],
 'Q2_e':[case('recursive-binary-boundaries','a=list(range(20))\nprint(*(c.RecursiveBinarySearch(a,0,19,v) for v in [0,19,7,21]))','0 19 7 -1\n'),case('empty-range-and-restricted-bounds','a=list(range(20))\nprint(c.RecursiveBinarySearch(a,8,7,4),c.RecursiveBinarySearch(a,4,4,4),c.RecursiveBinarySearch(a,7,9,0),c.RecursiveBinarySearch(a,7,9,9))','-1 4 -1 9\n',False)],
 'Q2_fi':[random_main('random-smallest','first',True),random_main('random-largest','last',False),random_main('random-absent','absent',False)],
 'Q3_b':[case('tree-parent-pointers',treereset+'''for v in [20,10,30,15,5]:c.AddNode(v)
print(c.RootPointer,c.FreeNode)
for row in c.TreeArray[:5]:print(*row)''','0 5\n1 20 2\n4 10 3\n-1 30 -1\n-1 15 -1\n-1 5 -1\n'),case('full-tree-boundary',treereset+'''import contextlib,io
for v in range(50):c.AddNode(v)
before=[r[:] for r in c.TreeArray]
out=io.StringIO()
with contextlib.redirect_stdout(out):c.AddNode(50)
print('PASS' if c.FreeNode==50 and before==c.TreeArray and 'The tree is full' in out.getvalue() else 'FAIL')''',public=False)],
 'Q3_c':[{'id':'original-tree-file','public':True,'expectedStdout':'','expectedFiles':{'Tree.txt':source_tree}}],
 'Q3_d':[{'id':'write-all-50-rows','public':True,'driverCode':driver(treereset+'''c.TreeArray[0]=[-1,20,1]
c.TreeArray[1]=[-1,30,-1]
c.WriteAllToFile()'''),'expectedStdout':'','inputFiles':{'Tree.txt':'old data\n'},'expectedFiles':{'Tree.txt':tree_text([[-1,20,1],[-1,30,-1]]+[[-1,-1,-1] for _ in range(48)])}},case('write-error-handled',treereset+'''import builtins,contextlib,io
def broken(*a,**k):raise OSError('unavailable')
builtins.open=broken
with contextlib.redirect_stdout(io.StringIO()):c.WriteAllToFile()
print('PASS')''',public=False)],
 'Q3_ei':[{'id':'main-writes-tree','public':True,'expectedStdout':'','expectedFiles':{'Tree.txt':source_tree}}]
}
paper(k,[q1,q2,q3],cs)
# 9618/43 October/November: a board, run-length compression, recursive count and scanning.
k='9618_w25_43'
q1=question('Q1','Board objects and a ten-by-ten board',statement(k,'Q1'),[stage('Q1','(a)(i)',5,'manual'),stage('Q1','(a)(ii)',3,'auto'),stage('Q1','(a)(iii)',3,'manual','Check Object1..Object5 identifiers and original code/value pairs.'),stage('Q1','(b)(i)',4,'manual'),stage('Q1','(b)(ii)',2,'auto'),stage('Q1','(b)(iii)',2,'auto'),stage('Q1','(b)(iv)',3,'auto'),stage('Q1','(c)(i)',3,'auto'),stage('Q1','(c)(ii)',1,'evidence'),stage('Q1','(d)(i)',4,'auto','Teacher reviews range-validation loops and meaningful messages; tests supply invalid coordinates, a hit and a miss.'),stage('Q1','(d)(ii)',1,'evidence')])
q2=question('Q2','A linear queue and binary compression',statement(k,'Q2'),[stage('Q2','(a)',2,'manual'),stage('Q2','(b)',5,'auto'),stage('Q2','(c)',3,'auto'),stage('Q2','(d)',5,'auto','Teacher checks text-file reading and Enqueue calls.'),stage('Q2','(e)',6,'auto','Teacher checks use of Dequeue and storage in global NewString; tests cover final and single runs.'),stage('Q2','(f)(i)',2,'auto'),stage('Q2','(f)(ii)',1,'evidence')],SOURCE[k]['initialFiles'])
q3=question('Q3','Recursive counting and splitting statements',statement(k,'Q3'),[stage('Q3','(a)(i)',6,'auto','Teacher checks recursive calls with the array excluding its first element and the zero-elements base case.'),stage('Q3','(a)(ii)',3,'auto'),stage('Q3','(a)(iii)',1,'evidence'),stage('Q3','(b)(i)',1,'manual'),stage('Q3','(b)(ii)',6,'auto','Teacher checks character scanning and no inbuilt split function; tests verify all four statements without semicolons.'),stage('Q3','(b)(iii)',2,'auto'),stage('Q3','(b)(iv)',1,'evidence')])
def board_grid(objects):
    grid=[['-']*10 for _ in range(10)]
    for code,row,col in objects:grid[row][col]=code
    return grid
board=board_grid([('A',0,0),('B',9,9),('C',4,5),('D',2,2),('E',8,7)])
exampleboard=board_grid([('A',0,7),('B',0,9),('C',1,1),('E',6,5)])
reset='c.Queue=[""]*100\nc.QueueHead=-1\nc.QueueTail=-1\nc.NumberItems=0\nc.NewString=""\n'
from itertools import groupby
def compress(text):return ''.join(k+str(len(list(g))) for k,g in groupby(text))
original_digits=''.join(SOURCE[k]['initialFiles']['BinaryData.txt'].splitlines())
rle=compress(original_digits)
cs={
 'Q1_aii':[case('object-getters','o=c.BoardObject("C",5)\nprint(o.GetCode(),o.GetValue())','C 5\n'),case('empty-object','o=c.BoardObject("-",0)\nprint(o.GetCode(),o.GetValue())','- 0\n',False)],
 'Q1_bii':[case('empty-board-corners','b=c.Board()\nprint(*(b.GetObject(r,col).GetCode() for r,col in [(0,0),(9,9),(4,5)]))\nprint(*(b.GetObject(r,col).GetValue() for r,col in [(0,0),(9,9),(4,5)]))','- - -\n0 0 0\n')],
 'Q1_biii':[case('set-row-column-independence','b=c.Board();o=c.BoardObject("Z",8)\nb.SetObject(o,2,7)\nprint(b.GetObject(2,7).GetCode(),b.GetObject(2,7).GetValue(),b.GetObject(7,2).GetCode(),b.GetObject(1,7).GetCode())','Z 8 - -\n'),case('replace-and-boundaries','b=c.Board()\nb.SetObject(c.BoardObject("A",2),0,0);b.SetObject(c.BoardObject("B",3),9,9);b.SetObject(c.BoardObject("E",7),0,0)\nprint(b.GetObject(0,0).GetCode(),b.GetObject(9,9).GetCode(),b.GetObject(0,9).GetCode())','E B -\n',False)],
 'Q1_biv':[case('display-example-grid','b=c.Board()\nfor code,r,col in [("A",0,7),("B",0,9),("C",1,1),("E",6,5)]:b.SetObject(c.BoardObject(code,1),r,col)\nb.DisplayBoard()',''.join(' '.join(row)+'\n' for row in exampleboard)),case('display-empty-grid','c.Board().DisplayBoard()',''.join(' '.join(['-']*10)+'\n' for _ in range(10)),False)],
 'Q1_ci':[maincase('initial-five-objects',['4','5'],f'rows[:10]=={board!r}',extra='rows=[line.split() for line in s.splitlines() if len(line.split())==10 and all(x in ["-","A","B","C","D","E"] for x in line.split())]')],
 'Q1_di':[maincase('specified-invalid-then-hit',['10','4','-1','5'],'"C" in tokens[100:] and "5" in tokens[100:]'),maincase('valid-miss',['0','1'],'"Miss" in tokens[100:]',False),maincase('upper-corner-hit',['9','9'],'"B" in tokens[100:] and "3" in tokens[100:]',False)],
 'Q2_b':[case('enqueue-first-and-full',reset+'''print(c.Enqueue('1'),c.QueueHead,c.QueueTail,c.NumberItems)
for i in range(99):c.Enqueue('0')
print(c.Enqueue('1'),c.QueueTail,c.NumberItems,c.Queue[0],c.Queue[99])''','True 0 0 1\nFalse 99 100 1 0\n')],
 'Q2_c':[case('dequeue-fifo-string-sentinel',reset+'''print(repr(c.Dequeue()))
c.Enqueue('1');c.Enqueue('0')
print(c.Dequeue(),c.Dequeue(),repr(c.Dequeue()),c.NumberItems)''',"'False'\n1 0 'False' 0\n"),case('all-100-dequeue',reset+'''for i in range(100):c.Enqueue(str(i%2))
print('PASS' if [c.Dequeue() for i in range(100)]==[str(i%2) for i in range(100)] and c.Dequeue()=='False' and c.NumberItems==0 else 'FAIL')''',public=False)],
 'Q2_d':[case('read-source-bits',reset+'''c.ReadData()
print(c.NumberItems,''.join(c.Queue[:c.NumberItems]))''',f'{len(original_digits)} {original_digits}\n'),case('read-max-length',reset+'''c.ReadData()
print(c.NumberItems,c.Queue[0],c.Queue[99])''','100 0 1\n',False,{'BinaryData.txt':'0\n1\n'*50})],
 'Q2_e':[case('compression-example',reset+'''for v in '11000111':c.Enqueue(v)
c.Compress()
print(c.NewString,c.NumberItems,c.Dequeue())''','120313 0 False\n'),case('single-run-nine',reset+'''for v in '111111111':c.Enqueue(v)
c.Compress()
print(c.NewString,c.NumberItems)''','19 0\n',False),case('single-zero',reset+'''c.Enqueue('0');c.Compress();print(c.NewString)''','01\n',False),case('alternating-bits',reset+'''for v in '10101':c.Enqueue(v)
c.Compress();print(c.NewString)''','1101110111\n',False)],
 'Q2_fi':[maincase('original-compression',[],f'{rle!r} in tokens'),maincase('changed-bits',[],'"0213" in tokens',False,{'BinaryData.txt':'0\n0\n1\n1\n1\n'})],
 'Q3_ai':[case('recursive-original','print(c.RecursiveCount([0,5,1,2,5,9,9,6,5,0],10,0))','2\n'),case('recursive-empty-and-all','print(c.RecursiveCount([],0,4),c.RecursiveCount([7]*10,10,7),c.RecursiveCount([1,2,1],3,1),c.RecursiveCount([1,2,3],3,8))','0 10 2 0\n',False)],
 'Q3_aii':[maincase('original-count',[],'"2" in tokens')],
 'Q3_bii':[case('split-original','print(repr(c.SplitData("x=0;y=1;x=x+y;y++;")))',"['x=0', 'y=1', 'x=x+y', 'y++']\n"),case('split-different-statements','print(repr(c.SplitData("a=9;b=2;c=a-b;go();")))',"['a=9', 'b=2', 'c=a-b', 'go()']\n",False),case('split-preserves-spaces','print(repr(c.SplitData("x = 1;y = 2;print(x);x++;")))',"['x = 1', 'y = 2', 'print(x)', 'x++']\n",False)],
 'Q3_biii':[maincase('four-output-lines',[],'all(line in s.splitlines() for line in ["x=0","y=1","x=x+y","y++"])')]
}
paper(k,[q1,q2,q3],cs)
# The repository's complete original-English s25_41 example is the reviewed base.
basepath=HERE.parents[2]/'examples/paper4-english-practice/paper4-english-practice.json'
# A portable source snapshot is supplied so rebuilds do not depend on future example edits.
if (HERE/'inputs'/'s25_41-base.json').exists():basepath=HERE/'inputs'/'s25_41-base.json'
p=json.loads(basepath.read_text())
p['paper'].update({'title':'9618 Paper 4 · May/June 2025 · Paper 41','description':'Classroom practice from the user-supplied 9618/41/M/J/25 paper. Original candidate text data retained; source structure and evidence require teacher review.','examYear':2025,'examSession':'summer','examVariant':41})
provided=SOURCE['9618_s25_41']['initialFiles']
for name,value in provided.items():
    old=p['questions'][1]['initialFiles'].get(name)
    assert old is not None and old.replace('\r\n','\n')==value.replace('\r\n','\n'),name
p['questions'][1]['initialFiles']=provided
PACKAGES['9618_s25_41']=p

# Source-fidelity corrections for the historical example without editing that example.
p=PACKAGES['9618_s25_41']
# Empty state is defined by NumberItems; a reset of both pointers is not prescribed.
p['runnerCases']['Q1_dequeue'][1]['driverCode']=driver('''print(c.Dequeue())
c.Enqueue(9)
print(c.Dequeue(),c.Dequeue())
print(c.NumberItems,c.Enqueue(17),c.Dequeue())''')
p['runnerCases']['Q1_dequeue'][1]['expectedStdout']='-1\n9 -1\n0 True 17\n'
# The original output examples define token order, not a line-layout restriction.
for sid,final in [('Q1_main',False),('Q1_main_dequeue',True)]:
    body="import contextlib,io,runpy\nout=io.StringIO()\nwith contextlib.redirect_stdout(out):runpy.run_path('/w/main.py',run_name='__main__')\ntokens=out.getvalue().split()\nexpected=[word for n in range(1,26) for word in [str(n),'Successful' if n<=20 else 'Unsuccessful']]\n"
    body+="print('PASS' if tokens[:50]==expected"+(" and tokens[50:]==['1','2']" if final else "")+" else 'FAIL')\n"
    p['runnerCases'][sid][0]['driverCode']=driver(body,load=False)

# Q2 function checks load definitions without triggering the candidate's main.
# Part2(a) requests prompting/reading, but does not require a missing-file exception handler.
for sid in ['Q2_a','Q2_b','Q2_c','Q2_d']:
    for item in p['runnerCases'][sid]:
        old=item['driverCode']
        marker="            Path(name).write_bytes(content)\n"
        assert marker in old
        rest=old.split(marker,1)[1].rsplit('except Exception:',1)[0]
        rest=textwrap.dedent(rest)
        rest=rest.replace("_, missing_prompt = read_file('MissingData.txt')\n",'')
        rest=rest.replace("assert missing_prompt.strip() and missing_prompt.strip() != short_prompt.strip()\n",'')
        rest=rest.replace("assert error_output.getvalue().strip()\n",'')
        rest=rest.replace("Path('Red.txt').read_text(encoding='utf-8') == '100\\n7\\n9\\n'","Path('Red.txt').read_text(encoding='utf-8').splitlines() == ['100','7','9']")
        rest=rest.replace("Path(name).read_text(encoding='utf-8') == expected.get(name, '')","Path(name).read_text(encoding='utf-8').splitlines() == expected.get(name, '').splitlines()")
        item['driverCode']=driver('import contextlib,io,sys\nfrom pathlib import Path\ncandidate=c\noutput_names=("Red.txt","Green.txt","Blue.txt","Orange.txt","Yellow.txt","Pink.txt")\n'+rest)

# s25_43 requires Traverse calls; it does not explicitly require printing each returned string.
# Observe those calls while running the candidate main, preserving its normal method behavior.
PACKAGES['9618_s25_43']['runnerCases']['Q3_ci'][0]['driverCode']=driver('''import contextlib,io
calls=[]
original=c.LinkedList.Traverse
def observed(self):
    value=original(self)
    calls.append(value.split())
    return value
c.LinkedList.Traverse=observed
c.__dict__['__name__']='__main__'
main_nodes=[n for n in tree.body if not isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))]
with contextlib.redirect_stdout(io.StringIO()):
    exec(compile(ast.fix_missing_locations(ast.Module(body=main_nodes,type_ignores=[])),'/w/main.py','exec'),c.__dict__)
print('PASS' if len(calls)>=2 and calls[0]==['50','40','30','20','10'] and calls[-1]==['50','40','20','10'] else 'FAIL')''')

# Upgrade inherited example function loaders to the shared safe declaration collector.
for cases in PACKAGES['9618_s25_41']['runnerCases'].values():
    for item in cases:
        old=item.get('driverCode','')
        if 'candidate = types.ModuleType' not in old:continue
        lines=old.splitlines()
        last=next(i for i,line in enumerate(lines) if 'exec(compile(ast.fix_missing_locations(ast.Module(body=' in line and 'candidate.__dict__)' in line)
        rest=textwrap.dedent('\n'.join(lines[last+1:]).rsplit('except Exception:',1)[0])
        rest=rest.replace('main_nodes = [node for node in source_tree.body if not declaration(node)]','main_nodes = [node for node in source_tree.body if not isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))]')
        item['driverCode']=driver('candidate=c\nsource_tree=tree\n'+rest)

# The original Node/Tree diagrams do not mandate public visibility.
# Inspect state through the required interfaces so private-field implementations remain valid.
for sid in ['Q3_node','Q3_getters','Q3_setters','Q3_tree']:
    for item in PACKAGES['9618_s25_41']['runnerCases'][sid]:
        code=item['driverCode']
        code=code.replace('node.NodeData == 10 and node.LeftNode is None and node.RightNode is None','node.GetData() == 10 and node.GetLeft() is None and node.GetRight() is None')
        code=code.replace('root.LeftNode, root.RightNode = left, right','root.SetLeft(left); root.SetRight(right)')
        code=code.replace('root.LeftNode is left and root.RightNode is right','root.GetLeft() is left and root.GetRight() is right')
        code=code.replace('tree.FirstNode is root','tree.GetRootNode() is root')
        item['driverCode']=code

# File-line requirements do not mandate a newline after the last line.
# Compare CSV fields / numeric lines semantically while still collecting outputFiles.
def relax_file_cases(manifests):
    for manifest in manifests.values():
        for cases in manifest['runnerCases'].values():
            for item in cases:
                if not item.get('expectedFiles'):continue
                expected=item.pop('expectedFiles')
                prior=item.get('driverCode')
                if prior:
                    run='exec('+repr(prior)+', {})\n'
                else:
                    run="import sys,runpy\nsys.stdin=io.StringIO("+repr(item.get('stdin',''))+")\nrunpy.run_path('/w/main.py',run_name='__main__')\n"
                body='import io,contextlib\nout=io.StringIO()\nwith contextlib.redirect_stdout(out):\n'+textwrap.indent(run,'    ')
                body+="assert 'FAIL' not in out.getvalue() and '__CHECK_FAILED__' not in out.getvalue()\n"
                body+='expected='+repr(expected)+'\n'
                body+='''def lines(name,text):
    rows=text.splitlines()
    if name=='Tree.txt':return [[int(cell.strip()) for cell in row.split(',')] for row in rows]
    if name=='SelectedToys.txt':return [(parts[0].strip(),int(parts[1]),parts[2].strip(),parts[3].strip()) for row in rows for parts in [row.split(',')]]
    return [int(row.strip()) for row in rows]
for name,wanted in expected.items():
    with open(name,encoding='utf-8') as f:actual=f.read()
    assert lines(name,actual)==lines(name,wanted)
print('PASS')
'''
                item['driverCode']=driver(body,load=False)
                item['expectedStdout']='PASS\n'
relax_file_cases(PACKAGES)

# Parse-only safety and integrity checks. No Python learner or reference program executes here.
for key,p in PACKAGES.items():
    assert len(p['questions'])==3
    assert sum(s['maxMarks'] for q in p['questions'] for s in q['stages'])==75,key
    stages={s['id']:s for q in p['questions'] for s in q['stages']}
    assert len(stages)==sum(len(q['stages']) for q in p['questions'])
    assert sum(len(v) for v in p['runnerCases'].values())<=50,key
    for sid,s in stages.items():
        cases=p['runnerCases'].get(sid,[])
        assert bool(cases)==(s['judgeMode']=='auto'),(key,sid)
        assert len(cases)<=12
        for c in cases:
            if c.get('driverCode'):ast.parse(c['driverCode'])
    assert set(p['runnerCases'])<=set(stages)
    for source in p['referenceSolutions'].values():ast.parse(source)
    text=json.dumps(p,indent=2,ensure_ascii=False)+'\n'
    assert len(text.encode())<=1024*1024
    (HERE/(key+'.json')).write_text(text)

lines=['# 2025 Paper 4 authoring coverage','',
'All six packages preserve the supplied question-paper subparts and 75-mark totals. English statements retain required interfaces, outputs and evidence tasks. JSON files are teacher-only import packages containing references and hidden cases. No source, package, fixture or asset was imported from the adjacent prototype.','',
'`python3 content/paper4-pastpapers/2025/authoring.py` regenerates the six manifests. `source-data.json` snapshots the supplied original text attachments and extracted question requirements; `inputs/s25_41-base.json` snapshots the existing reviewed example. Reference sources remain editable in `refs/` for the other five papers.','',
'## Current validation','',
'Authoring validation parses every reference and teacher driver as Python syntax, verifies stage identifiers, auto/manual/evidence case allocation, 75 marks, three questions, case limits and package byte limits. It does **not** execute references, candidate programs or drivers on the host/API/web. Real isolated-executor reference and wrong-answer validation is performed centrally and must be reported separately.','',
'## Marking and testing caveats','',
'- Automatic behavior checks support, but do not award, the original subpart marks. Teachers must review recursion, insertion/bubble/binary algorithms, avoidance of prohibited built-ins, OOP inheritance/privacy, comments, required function calls and local/global scope as stated in each subpart.',
'- Manual stages preserve marks for structural requirements, random-number generation, and input-menu choices where the original prescribes no exact menu/prompt spelling. Evidence stages retain the original screenshot/run requirements through teacher review of saved code/run records; the Word template is not imported.',
'- Function drivers AST-load safe declarations and definitions wherever located without running the student main. Drivers reset mutable global test fixtures explicitly. No particular main guard is required. Unexpected exceptions become FAIL.',
'- Public cases show representative behavior. Hidden cases cover capacity/empty boundaries, FIFO/LIFO ordering, collisions, absent search values, duplicates in sortable arrays, singleton/extreme values, coordinate independence and final compression runs. Expected values are reasoned independently in the authoring data; no reference is called to generate expected answers.',
'- Hash tables preserve collision insertion order. Bird constructor tests accept either sensible parameter order because the original describes parameter values without prescribing positional order. Bird selection menus remain manually reviewed.',
'- The s25_42 stack files evaluate top-to-bottom in pop order, left-to-right: StackData gives 131; SecondStack gives 320. The PDF diagram was visually checked. The w25_43 row/column board diagram was also visually checked.',
'- File tests compare numeric lines/CSV fields and tolerate an optional final newline. The original s25_41 function tests now AST-load definitions, and no missing-file handler or pointer-reset convention is added to that paper. Required text attachments are copied exactly, including original line endings. No original student text source is synthetic. Tree.txt is collected as a generated output; s25_41 retains all six color outputs and their original empty initial files.','']
for key,p in sorted(PACKAGES.items()):
 lines+=['## '+p['paper']['title'],'',f"Cases: {sum(len(v) for v in p['runnerCases'].values())}. Marks: 75.",'','| Original subpart | Marks | Mode | Cases / coverage |','| --- | ---: | --- | --- |']
 for q in p['questions']:
  for s in q['stages']:
   cases=p['runnerCases'].get(s['id'],[])
   names=', '.join(c['id']+(' (public)' if c['public'] else ' (hidden)') for c in cases)
   lines.append(f'| {s["title"]} | {s["maxMarks"]} | {s["judgeMode"]} | {names or s["description"]} |')
 lines+=['','Source checksums: '+json.dumps(SOURCE[key]['sources'],ensure_ascii=False),'']
(HERE/'coverage.md').write_text('\n'.join(lines).rstrip()+'\n')
print(json.dumps({key:{'marks':75,'cases':sum(len(v) for v in p['runnerCases'].values()),'bytes':(HERE/(key+'.json')).stat().st_size} for key,p in sorted(PACKAGES.items())},indent=2))
