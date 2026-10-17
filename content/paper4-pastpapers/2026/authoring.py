"""Rebuild three 2026 Paper 4 manifests. Trusted authoring only: never executes candidate/reference code.
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
    summer=True
    p={'format':'codemaster-paper4','version':1,'paper':{'title':f'9618 Paper 4 · {"May/June" if summer else "October/November"} 2026 · Paper {key[-2:]}','description':'Classroom adaptation of the supplied 2026 question paper. The missing original candidate text file is replaced with clearly labelled synthetic classroom data. Required interfaces and marking structure are retained.','examYear':2026,'examSession':'summer' if summer else 'autumn','examVariant':int(key[-2:])},'questions':qs,'runnerCases':cases,'referenceSolutions':{q['key']:(HERE/'refs'/f'{key}-{q["key"]}.py').read_text() for q in qs}}
    PACKAGES[key]=p
    return p
# Statements retain original English requirements and mark labels. Word evidence templates are not imported.
def statement(key,q):return SOURCE[key]['statements'][q]
# 9618/41: unspecified queue state identifiers; tests use only required function interfaces.
k='9618_s26_41'
q1=question('Q1','A ten-place linear queue',statement(k,'Q1'),[stage('Q1','(a)',3,'manual'),stage('Q1','(b)',7,'auto'),stage('Q1','(c)(i)',5,'manual','Review the earlier 11-input main, failed-Enqueue message and non-destructive array output. Part (e) explicitly amends that main to six inputs; its final behavior is tested separately.'),stage('Q1','(c)(ii)',1,'evidence'),stage('Q1','(d)',6,'auto'),stage('Q1','(e)(i)',3,'auto'),stage('Q1','(e)(ii)',1,'evidence')])
q2=question('Q2','Toy records and selection files',statement(k,'Q2'),[stage('Q2','(a)',2,'manual'),stage('Q2','(b)(i)',8,'auto','Check ToyRecord creation, integer brick counts, populated parameter array return and file exception handling.'),stage('Q2','(b)(ii)',3,'auto'),stage('Q2','(b)(iii)',3,'manual'),stage('Q2','(b)(iv)',1,'evidence'),stage('Q2','(c)(i)',5,'manual','Check validated difficulty choice, matching records and returned array. The original permits implementation-defined menus (including numeric choices), so no menu spelling is enforced.'),stage('Q2','(c)(ii)',3,'auto'),stage('Q2','(c)(iii)',2,'manual'),stage('Q2','(c)(iv)',1,'evidence','Review a medium-difficulty run and SelectedToys.txt with filename/content visible, using the labelled classroom dataset.')],SOURCE[k]['initialFiles'],['SelectedToys.txt'])
q3=question('Q3','Objects along a path',statement(k,'Q3'),[stage('Q3','(a)(i)',4,'manual'),stage('Q3','(a)(ii)',4,'manual','Check public NumberSpaces and BoardArray of100 independent empty objects, declaration comments and GetNumberSpaces.'),stage('Q3','(a)(iii)',3,'auto'),stage('Q3','(a)(iv)',2,'auto'),stage('Q3','(a)(v)',1,'auto'),stage('Q3','(b)(i)',6,'auto','Teacher checks required ArrayOfObjects and Path1 identifiers and appropriate method calls; behavior checks all five output objects.'),stage('Q3','(b)(ii)',1,'evidence')])
toyhelper='''
def toy(name,bricks,difficulty,category):
    try:return c.ToyRecord(name,bricks,difficulty,category)
    except TypeError:
        r=c.ToyRecord();r.ToyName=name;r.NumberBricks=bricks;r.Difficulty=difficulty;r.Category=category;return r
'''
cs={
 'Q1_b':[case('enqueue-capacity','print(*(c.Enqueue(i) for i in range(1,12)))','True True True True True True True True True True False\n'),case('enqueue-extreme-integers','print(c.Enqueue(0),c.Enqueue(999999))','True True\n',False)],
 'Q1_d':[case('fifo-empty','print(c.Dequeue())\nfor v in [100,10,5,6,18,68]:c.Enqueue(v)\nprint(*(c.Dequeue() for i in range(7)))','-1\n100 10 5 6 18 68 -1\n'),case('full-drain','for v in range(1,11):c.Enqueue(v)\nprint(*(c.Dequeue() for i in range(11)))','1 2 3 4 5 6 7 8 9 10 -1\n',False)],
 'Q1_ei':[maincase('final-six-input-main',['100','10','5','6','18','68'],'tokens==["100","10","5","6"]'),maincase('different-final-six',['2','4','6','8','10','12'],'tokens==["2","4","6","8"]',False)],
 'Q2_bi':[case('read-classroom-toys','import contextlib,io\na=None\nfor seed in [[],[None]*16]:\n    try:\n        with contextlib.redirect_stdout(io.StringIO()):result=c.ReadData(seed)\n        if len(result)==16 and all(x is not None for x in result):a=result;break\n    except (IndexError,TypeError):pass\nif a is None:raise AssertionError("unpopulated array")\nprint(len(a),a[0].ToyName,a[0].NumberBricks,a[0].Difficulty,a[0].Category)\nprint(a[-1].ToyName,a[-1].NumberBricks,a[-1].Difficulty,a[-1].Category)','16 Fire Station 3981 Expert Town\nRobot Friend 460 Medium Play\n'),case('toy-read-error','import builtins,contextlib,io\ndef broken(*a,**k):raise OSError("unavailable")\nbuiltins.open=broken\nwith contextlib.redirect_stdout(io.StringIO()):c.ReadData([None]*16)\nprint("PASS")',public=False)],
 'Q2_bii':[case('output-toy-data',toyhelper+'c.OutputToys([toy("Test House",120,"Easy","Town"),toy("Bridge",990,"Expert","Display")])','Test House 120 Easy Town\nBridge 990 Expert Display\n')],
 'Q2_cii':[{'id':'write-selected-records','public':True,'driverCode':driver(toyhelper+'c.WriteToys([toy("Space Rover",640,"Medium","Play"),toy("Book Shop",880,"Medium","Town")])'),'expectedStdout':'','inputFiles':{'SelectedToys.txt':'old data\n'},'expectedFiles':{'SelectedToys.txt':'Space Rover,640,Medium,Play\nBook Shop,880,Medium,Town\n'}},{'id':'empty-selection','public':False,'driverCode':driver('c.WriteToys([])'),'expectedStdout':'','inputFiles':{'SelectedToys.txt':'old data\n'},'expectedFiles':{'SelectedToys.txt':''}}],
 'Q3_aiii':[case('initialise-order-and-capacity','p=c.Path(2)\nprint(p.GetNumberSpaces(),len(p.BoardArray),all(o.ObjectType=="" and o.Amount==-1 for o in p.BoardArray))\nprint(p.InitialiseData([c.TheObject("Money",100),c.TheObject("Experience",50)]))\nprint(p.GetPathObject(0).Amount,p.GetPathObject(1).Amount)\nprint(p.InitialiseData([c.TheObject("Money",1)]*3))\nprint(p.GetPathObject(0).Amount,p.GetPathObject(1).Amount)','2 100 True\nTrue\n100 50\nFalse\n100 50\n'),case('initialise-fewer-than-spaces','p=c.Path(5)\nprint(p.InitialiseData([c.TheObject("Experience",7)]),p.GetPathObject(0).Amount,p.GetPathObject(1).Amount)','True 7 -1\n',False)],
 'Q3_aiv':[case('path-format','p=c.Path(3)\np.InitialiseData([c.TheObject("Money",100),c.TheObject("Experience",50)])\nprint(p.ReturnPath().strip())','Money-100 Experience-50\n'),case('path-skips-empty-objects','p=c.Path(5)\np.InitialiseData([c.TheObject("Money",0)])\nprint(p.ReturnPath().strip())','Money-0\n',False)],
 'Q3_av':[case('get-object-indices','p=c.Path(100)\np.BoardArray[99]=c.TheObject("Experience",9)\nprint(p.GetPathObject(99).ObjectType,p.GetPathObject(99).Amount,p.GetPathObject(0).Amount)','Experience 9 -1\n')],
 'Q3_bi':[maincase('five-path-objects',[],'[x.lower() for x in re.findall(r"(?:Money|Experience)-[0-9]+",s,re.I)]==["money-50","experience-100","money-200","money-20","experience-30"]')]
}
paper(k,[q1,q2,q3],cs)
# 9618/42: strings, filtered avatars and array-linked lists.
k='9618_s26_42'
q1=question('Q1','String lengths and alphabetical insertion sort',statement(k,'Q1'),[stage('Q1','(a)',2,'manual'),stage('Q1','(b)(i)',5,'auto','Check appropriate messages and manual comparison by string length; no built-in longest/shortest selection.'),stage('Q1','(b)(ii)',1,'auto'),stage('Q1','(b)(iii)',1,'evidence'),stage('Q1','(c)(i)',5,'auto','Teacher reviews actual insertion sort without built-in sorting and arbitrary input length.'),stage('Q1','(c)(ii)',3,'auto'),stage('Q1','(c)(iii)',1,'evidence')])
q2=question('Q2','Avatars and user criteria',statement(k,'Q2'),[stage('Q2','(a)(i)',4,'manual'),stage('Q2','(a)(ii)',3,'auto'),stage('Q2','(a)(iii)',2,'auto'),stage('Q2','(b)(i)',7,'auto','Check creation of30 objects in global AvailableAvatars, correct Boolean conversion and exception handling.'),stage('Q2','(b)(ii)',1,'manual'),stage('Q2','(c)(i)',6,'manual','Check both validation loops, MeetCriteria calls and a global array of matches. The paper does not prescribe the matching array identifier.'),stage('Q2','(c)(ii)',5,'manual','Review EnterChoices call, matching count, name and age outputs. Hair-colour choices may use textual or numeric menus; no exact menu representation is imposed.'),stage('Q2','(d)(i)',1,'evidence','Review yes, blue then black using the labelled classroom dataset.'),stage('Q2','(d)(ii)',1,'evidence','Review no and green using the labelled classroom dataset.')],SOURCE[k]['initialFiles'])
q3=question('Q3','Linked list and free-node list in an array',statement(k,'Q3'),[stage('Q3','(a)',5,'manual'),stage('Q3','(b)(i)',4,'auto'),stage('Q3','(b)(ii)',3,'auto'),stage('Q3','(b)(iii)',2,'auto'),stage('Q3','(b)(iv)',2,'evidence'),stage('Q3','(c)(i)',8,'auto'),stage('Q3','(c)(ii)',2,'auto'),stage('Q3','(c)(iii)',1,'evidence')])
words=['laptop','tablet','printer','computer','processor','monitor','memory','cable','touchscreen']
ordered=['cable','computer','laptop','memory','monitor','printer','processor','tablet','touchscreen']
llreset='c.LinkedList=[[9512,5],[5541,3],[1999,0],[6651,-1],[-1,6],[5612,1],[-1,-1],[-1,4]]\nc.StartLinkedList=2\nc.StartEmptyList=7\n'
llhelper='''
def values():
    result=[];p=c.StartLinkedList
    while p!=-1:
        if len(result)>8:raise ValueError('cycle')
        result.append(c.LinkedList[p][0]);p=c.LinkedList[p][1]
    return result
'''
avatars=[line.split() for line in SOURCE[k]['initialFiles']['AvatarFile.txt'].splitlines()]
yesblack=[a for a in avatars if a[1]=='True' and a[2]=='black']
nogreen=[a for a in avatars if a[1]=='False' and a[2]=='green']
def avatar_main(id,inputs,selected,public):
    names=[a[0] for a in selected];ages=[a[3] for a in selected];others=[a[0] for a in avatars if a not in selected]
    return maincase(id,inputs,f'all(x in tokens for x in {names+ages+[str(len(names))]!r}) and all(x not in tokens for x in {others!r})',public)
cs={
 'Q1_bi':[case('original-extremes','import io,contextlib,re\no=io.StringIO()\nwith contextlib.redirect_stdout(o):c.FindLongestShortest('+repr(words)+')\nprint("PASS" if "touchscreen" in re.findall("[a-z]+",o.getvalue()) and "cable" in re.findall("[a-z]+",o.getvalue()) else "FAIL")'),case('different-unique-extremes','import io,contextlib,re\no=io.StringIO()\nwith contextlib.redirect_stdout(o):c.FindLongestShortest(["abcdefghi","x","ab","abc","abcd","abcde","abcdef","abcdefg","abcdefgh"])\nprint("PASS" if "abcdefghi" in re.findall("[a-z]+",o.getvalue()) and "x" in re.findall("[a-z]+",o.getvalue()) else "FAIL")',public=False)],
 'Q1_bii':[maincase('main-lengths',[],'"touchscreen" in re.findall("[a-z]+",s) and "cable" in re.findall("[a-z]+",s)')],
 'Q1_ci':[case('sort-original','print(*c.InsertionSort('+repr(words)+'))',' '.join(ordered)+'\n'),case('sort-empty-single-and-duplicates','print(c.InsertionSort([]),c.InsertionSort(["a"]),c.InsertionSort(["z","a","z","ab"]))',"[] ['a'] ['a', 'ab', 'z', 'z']\n",False)],
 'Q1_cii':[maincase('before-after-arrays',[],f'before=={words!r} and after=={ordered!r}',extra='''known=set('''+repr(words)+''')
parts=s.split('Before sorting',1)
if len(parts)!=2:raise ValueError('missing Before sorting')
parts=parts[1].split('After sorting',1)
if len(parts)!=2:raise ValueError('missing After sorting')
before=[x for x in re.findall('[a-z]+',parts[0]) if x in known]
after=[x for x in re.findall('[a-z]+',parts[1]) if x in known]
''')],
 'Q2_aii':[case('avatar-name-age','a=c.Avatar("Kit",True,"blonde",21)\nprint(a.GetName(),a.GetAge())','Kit 21\n')],
 'Q2_aiii':[case('both-criteria-required','a=c.Avatar("Kit",True,"blonde",21)\nprint(a.MeetCriteria(True,"blonde"),a.MeetCriteria(False,"blonde"),a.MeetCriteria(True,"black"),a.MeetCriteria(False,"black"))','True False False False\n'),case('false-glasses-match','a=c.Avatar("Bea",False,"green",25)\nprint(a.MeetCriteria(False,"green"),a.MeetCriteria(True,"green"))','True False\n',False)],
 'Q2_bi':[case('load-classroom-avatars','import contextlib,io\na=None\nfor seed in [[],[None]*30]:\n    c.AvailableAvatars=seed\n    try:\n        with contextlib.redirect_stdout(io.StringIO()):c.LoadAvatars()\n        result=c.AvailableAvatars\n        if len(result)==30 and all(x is not None for x in result):a=result;break\n    except (IndexError,TypeError):pass\nif a is None:raise AssertionError("unpopulated avatar array")\nprint(len(a),a[0].GetName(),a[0].GetAge(),a[0].MeetCriteria(True,"blonde"))\nprint(a[-1].GetName(),a[-1].GetAge(),a[-1].MeetCriteria(True,"green"))\nprint(sum(v.MeetCriteria(False,"green") for v in a))','30 Kit 21 True\nCleo 46 True\n3\n'),case('avatar-read-error','import builtins,io,contextlib\ndef broken(*a,**k):raise OSError("unavailable")\nbuiltins.open=broken\nwith contextlib.redirect_stdout(io.StringIO()):c.LoadAvatars()\nprint("PASS")',public=False)],
 'Q3_bi':[case('follow-data-pointers',llreset+'c.PrintListItems()','1999 9512 5612 5541 6651\n')],
 'Q3_bii':[case('follow-free-pointers',llreset+'c.PrintEmptyList()','7 4 6\n')],
 'Q3_biii':[maincase('initial-headings-and-lists',[],'"Linked list 1999 9512 5612 5541 6651 Empty list 7 4 6" in " ".join(tokens)')],
 'Q3_ci':[case('append-to-tail',llreset+llhelper+'''c.AddItem(8451)
print(c.StartLinkedList,c.StartEmptyList,c.LinkedList[3][1],c.LinkedList[7])
print(*values())''','2 4 7 [8451, -1]\n1999 9512 5612 5541 6651 8451\n'),case('fill-and-reject',llreset+llhelper+'''import io,contextlib
for v in [8451,9000,1000]:c.AddItem(v)
before=[r[:] for r in c.LinkedList]
o=io.StringIO()
with contextlib.redirect_stdout(o):c.AddItem(1234)
print('PASS' if c.StartEmptyList==-1 and c.LinkedList==before and 'List is full' in o.getvalue() and values()==[1999,9512,5612,5541,6651,8451,9000,1000] else 'FAIL')''',public=False)],
 'Q3_cii':[maincase('updated-list-output',[],'"1999 9512 5612 5541 6651 8451" in " ".join(tokens) and tokens[-2:]==["4","6"]')]
}
paper(k,[q1,q2,q3],cs)
# 9618/43: strings by length, character criteria and a binary tree.
k='9618_s26_43'
q1=question('Q1','Input strings, word counts and length sorting',statement(k,'Q1'),[stage('Q1','(a)',1,'manual'),stage('Q1','(b)',4,'auto'),stage('Q1','(c)',2,'auto'),stage('Q1','(d)(i)',1,'auto'),stage('Q1','(d)(ii)',1,'evidence'),stage('Q1','(e)',5,'auto','Teacher reviews manual counting without an inbuilt count function.'),stage('Q1','(f)(i)',5,'auto','Check actual efficient bubble sort with early stopping, and no inbuilt sorting/order-checking function. Behavior permits any tie order because the paper does not prescribe one.'),stage('Q1','(f)(ii)',1,'auto'),stage('Q1','(f)(iii)',1,'evidence')])
q2=question('Q2','Character records and two criteria',statement(k,'Q2'),[stage('Q2','(a)(i)',4,'manual'),stage('Q2','(a)(ii)',3,'auto'),stage('Q2','(b)',7,'auto','Check new Character objects in a local array, field conversion/order and file exception handling.'),stage('Q2','(c)',3,'auto'),stage('Q2','(d)(i)',2,'manual'),stage('Q2','(d)(ii)',1,'evidence'),stage('Q2','(e)(i)',8,'manual','Review two criteria for different characteristics, conjunction of both criteria, new matching array, matching count and OutputCharacters call. The original leaves the choice menu and input representation open.'),stage('Q2','(e)(ii)',1,'evidence','Review black plus can-fly criteria against the labelled classroom dataset. The reference accepts Colour=Black then Fly=Yes; other clear interfaces are valid.')],SOURCE[k]['initialFiles'])
q3=question('Q3','An array binary tree and in-order traversal',statement(k,'Q3'),[stage('Q3','(a)',3,'manual'),stage('Q3','(b)',7,'auto'),stage('Q3','(c)',2,'auto'),stage('Q3','(d)(i)',3,'auto'),stage('Q3','(d)(ii)',1,'evidence'),stage('Q3','(e)(i)',7,'auto','Teacher checks recursive left/data/right traversal and conditional child calls.'),stage('Q3','(e)(ii)',1,'auto'),stage('Q3','(e)(iii)',1,'evidence')])
first_inputs=['1','One','2','TWO','three','??','house','99987','popping','green','eleven','12','Twenty','THIRTY','16']
second_inputs=['one','One','1','three','three','One','house','99987','popping','green','eleven','One','Twenty','THIRTY','One']
first_lower=[x.lower() for x in first_inputs];second_lower=[x.lower() for x in second_inputs]
reset='c.DataArray=[""]*15\n'
treereset='c.BinaryTree=[[-1,-1,-1] for i in range(100)]\nc.TreeRootPointer=-1\nc.FirstFreeNodePointer=0\n'
def make_tree(values):
    rows=[[-1,-1,-1] for _ in range(100)]
    for n,value in enumerate(values):
        rows[n][1]=value
        if n==0:continue
        p=0
        while True:
            col=0 if value<rows[p][1] else 2
            if rows[p][col]==-1:rows[p][col]=n;break
            p=rows[p][col]
    return rows
original=[50,26,120,236,2,16,67,49,165,15]
rows=make_tree(original)
chars=[line.split(',') for line in SOURCE[k]['initialFiles']['Characters.txt'].splitlines()]
cs={
 'Q1_b':[case('lower-case-inputs',reset+'import builtins\na=iter('+repr(first_inputs)+')\nbuiltins.input=lambda prompt="":next(a)\nc.CreateArray()\nprint(*c.DataArray)',' '.join(first_lower)+'\n'),case('preserve-punctuation',reset+'import builtins\na=iter(["AbC!", "", "123"]+["Z"]*12)\nbuiltins.input=lambda prompt="":next(a)\nc.CreateArray()\nprint(repr(c.DataArray[:3]),c.DataArray[-1])',"['abc!', '', '123'] z\n",False)],
 'Q1_c':[case('one-line-output',reset+'c.DataArray='+repr(first_lower)+'\nc.OutputArray()',' '.join(first_lower)+'\n')],
 'Q1_di':[maincase('first-original-inputs',first_inputs+['one'],f'lines[0]=={first_lower!r}',extra='lines=[line.split() for line in s.splitlines() if line.strip()]')],
 'Q1_e':[case('case-insensitive-word-count',reset+'import builtins,io,contextlib,re\nc.DataArray='+repr(second_lower)+'''\nbuiltins.input=lambda prompt='':'ONE'
o=io.StringIO()
with contextlib.redirect_stdout(o):c.FindWords()
print('PASS' if '5' in re.findall(r'\d+',o.getvalue()) else 'FAIL')'''),case('word-absent',reset+'''import builtins,io,contextlib,re
c.DataArray=['abc']*15
builtins.input=lambda prompt='':'def'
o=io.StringIO()
with contextlib.redirect_stdout(o):c.FindWords()
print('PASS' if '0' in re.findall(r'\d+',o.getvalue()) else 'FAIL')''',public=False)],
 'Q1_fi':[case('bubble-by-length',reset+'before='+repr(first_lower)+'''\nc.DataArray=before[:]
c.SortLength()
print('PASS' if sorted(c.DataArray)==sorted(before) and [len(x) for x in c.DataArray]==sorted(len(x) for x in before) else 'FAIL')'''),case('sorted-and-equal-length',reset+'''before=['a','b','cc','dd','eee','fff','gggg','hhhh','iiiii','jjjjj','kkkkkk','llllll','mmmmmmm','nnnnnnn','oooooooo']
c.DataArray=before[:];c.SortLength()
print('PASS' if sorted(c.DataArray)==sorted(before) and [len(x) for x in c.DataArray]==sorted(len(x) for x in before) else 'FAIL')''',public=False)],
 'Q1_fii':[maincase('count-then-sort',second_inputs+['one'],f'len(lines)>=3 and lines[0]=={second_lower!r} and "5" in re.findall(r"[0-9]+", " ".join(lines[1])) and sorted(lines[-1])==sorted({second_lower!r}) and [len(x) for x in lines[-1]]==sorted(len(x) for x in {second_lower!r})',extra='lines=[line.split() for line in s.splitlines() if line.strip()]')],
 'Q2_aii':[case('character-getters','a=c.Character("Jet","Black","Yes","No","No")\nprint(a.GetCharacterName(),a.GetColour(),a.GetSuperStrength(),a.GetFly(),a.GetInvisible())','Jet Black Yes No No\n'),case('character-different-values','a=c.Character("Fern","Green","No","Yes","Yes")\nprint(a.GetCharacterName(),a.GetColour(),a.GetSuperStrength(),a.GetFly(),a.GetInvisible())','Fern Green No Yes Yes\n',False)],
 'Q2_b':[case('read-classroom-characters','a=c.ReadData()\nprint(len(a),a[0].GetCharacterName(),a[0].GetColour(),a[0].GetSuperStrength(),a[0].GetFly(),a[0].GetInvisible())\nprint(a[-1].GetCharacterName(),a[-1].GetColour(),a[-1].GetFly())','15 Jet Black Yes No No\nRose Pink Yes\n'),case('characters-read-error','import builtins,contextlib,io\ndef broken(*a,**k):raise OSError("unavailable")\nbuiltins.open=broken\nwith contextlib.redirect_stdout(io.StringIO()):c.ReadData()\nprint("PASS")',public=False)],
 'Q2_c':[case('character-output-format','c.OutputCharacters([c.Character("Jet","Black","Yes","No","No"),c.Character("Sky","Black","No","Yes","No")])','Name: Jet Colour: Black Super strength: Yes Fly: No Invisible: No\nName: Sky Colour: Black Super strength: No Fly: Yes Invisible: No\n'),case('no-matching-characters','c.OutputCharacters([])','',False)],
 'Q3_b':[case('insert-parent-pointers',treereset+'''for v in [20,10,26,22,8]:c.AddNode(v)
print(c.TreeRootPointer,c.FirstFreeNodePointer)
for row in c.BinaryTree[:5]:print(*row)''','0 5\n1 20 2\n4 10 -1\n3 26 -1\n-1 22 -1\n-1 8 -1\n'),case('one-hundred-nodes-and-overflow',treereset+'''import io,contextlib
for i in range(1,101):c.AddNode(i)
before=[r[:] for r in c.BinaryTree]
o=io.StringIO()
with contextlib.redirect_stdout(o):c.AddNode(101)
print('PASS' if before==c.BinaryTree and c.FirstFreeNodePointer==100 and 'The tree is full' in o.getvalue() else 'FAIL')''',public=False)],
 'Q3_c':[case('first-ten-rows',treereset+'for v in [20,10,26,22,8]:c.AddNode(v)\nc.OutputArray()',''.join(' '.join(map(str,r))+'\n' for r in make_tree([20,10,26,22,8])[:10]))],
 'Q3_di':[maincase('original-insertion-main',list(map(str,original)),f'lines[:10]=={[[str(x) for x in r] for r in rows[:10]]!r}',extra='lines=[line.split() for line in s.splitlines() if line.strip()]')],
 'Q3_ei':[case('in-order-example',treereset+'for v in [20,12,26,5,18]:c.AddNode(v)\nc.InOrder(c.TreeRootPointer)','5 12 18 20 26\n'),case('unbalanced-traversal',treereset+'for v in [9,7,5,3,1]:c.AddNode(v)\nc.InOrder(c.TreeRootPointer)','1 3 5 7 9\n',False),case('single-node-traversal',treereset+'c.AddNode(42)\nc.InOrder(c.TreeRootPointer)','42\n',False)],
 'Q3_eii':[maincase('original-in-order-main',list(map(str,original)),f'tokens[-10:]=={list(map(str,[2,15,16,26,49,50,67,120,165,236]))!r}')]
}
paper(k,[q1,q2,q3],cs)
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

# Parse-only checks: all execution belongs to the production isolated judge.
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
        for item in cases:
            if item.get('driverCode'):ast.parse(item['driverCode'])
    assert set(p['runnerCases'])<=set(stages)
    for source in p['referenceSolutions'].values():ast.parse(source)
    text=json.dumps(p,indent=2,ensure_ascii=False)+'\n'
    assert len(text.encode())<=1024*1024
    (HERE/(key+'.json')).write_text(text)

lines=['# 2026 Paper 4 authoring coverage','',
'These three packages retain the supplied question-paper English requirements and75 marks per paper. The original candidate-file ZIPs were missing. The user explicitly approved synthetic classroom replacements. No original data file is claimed or recreated. Each Q2 statement and paper description labels its replacement, and file-dependent expected outputs refer only to that classroom data.','',
'## Rebuild and provenance','',
'Run `python3 content/paper4-pastpapers/2026/authoring.py`. Editable references are in refs/; source-data.json preserves extracted original question requirements, original QP/MS checksums and the clearly synthetic text attachments. The replacements contain16 toys,30 avatars and15 characters respectively, preserving original formats. Only the first example row in each file comes from the supplied question paper. No prototype files/assets/packages are used.','',
'## Current validation','',
'Authoring validation parses all reference/driver Python, checks3 questions and75 marks each, stage/case allocation, unique stage identifiers, byte limits and case limits. It does not run reference/candidate Python on the host/API/web. Central isolated-executor validation and deliberate wrong-answer checks must be reported separately.','',
'## Marking caveats','',
'- The v1 model supports the final edited program. s26_41 Q1(c) asks for an earlier11-input main; Q1(e) explicitly amends it to six inputs. The earlier main and its evidence are manually reviewed, while the final six-input FIFO behavior is tested automatically.',
'- Teachers review actual algorithms, recursion, early stopping, avoidance of prohibited built-ins, public/private attributes, comments, local/global declarations and required method calls. Automatic behavior passing does not award these marks.',
'- Toy-difficulty menus and the two character-criteria input representations remain manual because the question paper prescribes no exact numeric/text menu. The teacher reference accepts difficulty1/2/3 or Easy/Medium/Expert and character criteria such as Colour=Black then Fly=Yes. Students may use any clear equivalent interface.',
'- Avatar matching-array identifiers and hair-choice menus are unspecified, so EnterChoices and the final main are manually reviewed, including yes/invalid blue/black and no/green. Functional tests check constructor/getters, conjunction criteria and loading all30 records. Load-array tests accept both dynamic append and preallocated-index implementations, matching the original language flexibility.',
'- Function tests AST-load safe declarations and definitions wherever located without running the main. No main guard is imposed. Teacher drivers convert exceptions to FAIL and use independently specified expected outcomes.',
'- Hidden cases cover full/empty capacity, FIFO, lowercase conversion, absent counts, sort lengths/ties, both criteria, file errors, list pointers/free-list exhaustion, tree capacity and unbalanced traversal.',
'- File tests compare CSV fields and tolerate an optional final newline. Word evidence templates are not imported. Evidence stages preserve teacher review of code/run/file evidence, including SelectedToys.txt filename and content.','']
for key,p in sorted(PACKAGES.items()):
 lines+=['## '+p['paper']['title'],'',f"Cases: {sum(len(v) for v in p['runnerCases'].values())}. Marks:75. Synthetic attachment: "+', '.join(SOURCE[key]['initialFiles'])+'.','','| Original subpart | Marks | Mode | Cases / coverage |','| --- | ---: | --- | --- |']
 for q in p['questions']:
  for s in q['stages']:
   cases=p['runnerCases'].get(s['id'],[])
   names=', '.join(item['id']+(' (public)' if item['public'] else ' (hidden)') for item in cases)
   lines.append(f'| {s["title"]} | {s["maxMarks"]} | {s["judgeMode"]} | {names or s["description"]} |')
 lines+=['','Supplied source checksums: '+json.dumps(SOURCE[key]['sources'],ensure_ascii=False),'']
(HERE/'coverage.md').write_text('\n'.join(lines).rstrip()+'\n')
print(json.dumps({key:{'marks':75,'cases':sum(len(v) for v in p['runnerCases'].values()),'bytes':(HERE/(key+'.json')).stat().st_size} for key,p in sorted(PACKAGES.items())},indent=2))
