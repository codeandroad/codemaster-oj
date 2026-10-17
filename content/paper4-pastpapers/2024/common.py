import json, textwrap, ast
from pathlib import Path

def code(s): return textwrap.dedent(s).strip()+'\n'
LOAD=code('''
import ast, types, sys
candidate = types.ModuleType('candidate')
candidate.__file__ = '/w/main.py'
sys.modules['candidate'] = candidate
with open('/w/main.py', encoding='utf-8') as f:
    tree = ast.parse(f.read(), '/w/main.py')
safe_calls={'list','tuple','dict','set','range','int','float','str','bool','len'}
for node in tree.body:
    include=isinstance(node,(ast.Import,ast.ImportFrom,ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))
    if isinstance(node,(ast.Assign,ast.AnnAssign)):
        include=all(isinstance(n.func,ast.Name) and n.func.id in safe_calls for n in ast.walk(node.value) if isinstance(n,ast.Call)) if node.value is not None else True
    if include:
        try:
            exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])), '/w/main.py', 'exec'),candidate.__dict__)
        except NameError:
            if not isinstance(node,(ast.Assign,ast.AnnAssign)):raise
''')
def driver(s, load=True):
 return 'try:\n'+textwrap.indent((LOAD if load else '')+code(s),'    ')+'except Exception:\n    print("__CHECK_FAILED__")\n'
def case(i,body,expected,public=True,files=None,load=True):
 d={'id':i,'public':public,'driverCode':driver(body,load),'expectedStdout':expected}
 if files:d['inputFiles']=files
 return d

def stage(part,title,marks,mode='manual',description=None):
 return {'id':'Q'+part.replace(')(','').replace('(','_').replace(')','').replace('.','_'), 'title':part+' '+title, 'description':description or ('Functional checks of the specified interface; teacher also checks the required algorithm and source structure.' if mode=='auto' else 'Teacher reviews the original requirement in the editable source and saved run output.' if mode=='manual' else 'Teacher reviews saved run output for the original test data; screenshots are represented by this evidence stage.'),'maxMarks':marks,'judgeMode':mode}

def question(key,title,statement,stages,reference,tests=None,files=None):
 return {'question':{'key':key,'title':title,'statement':statement.strip()+'\n\nUse Python 3. Keep the functions, classes and identifiers specified above. Complete the main program in the same editable file; no particular main-program guard is required. Saved run output supplies the original screenshot evidence for teacher review.','starterCode':'# Complete all parts of this question in Python 3.\n','initialFiles':files or {},'outputFiles':[],'stages':stages},'reference':code(reference),'tests':{'Q'+k:v for k,v in (tests or {}).items()}}

def assemble(source,qs):
 key=source['key'];year=source['year']; variant=int(source['variant']); summer='_s' in key
 out={'format':'codemaster-paper4','version':1,'paper':{'title':f"9618 Paper 4 · {'May/June' if summer else 'October/November'} {year} · Paper {variant}",'description':f"Classroom adaptation of user-supplied {key} question paper, marking scheme and candidate text files. Original subparts and 75 marks retained; automatic functionality is supplemented by teacher source/evidence review.",'examYear':year,'examSession':'summer' if summer else 'autumn','examVariant':variant},'questions':[q['question'] for q in qs],'runnerCases':{},'referenceSolutions':{q['question']['key']:q['reference'] for q in qs}}
 for q in qs:out['runnerCases'].update(q['tests'])
 assert sum(s['maxMarks'] for q in out['questions'] for s in q['stages'])==75,key
 assert sum(map(len,out['runnerCases'].values()))<=50
 for q in qs:
  ast.parse(q['reference'])
  for s in q['question']['stages']:
   if s['judgeMode']=='auto':
    tests=q['tests'][s['id']];assert 2<=len(tests)<=12
    assert any(t['public'] for t in tests) and any(not t['public'] for t in tests)
  for cases in q['tests'].values():
   for c in cases:ast.parse(c['driverCode'])
 return out

# Supplemental whole-program cases observe the original main outputs as well
# as the interface cases. Input prompts are captured by the stub, so phrasing
# chosen by the student does not alter the numeric/output observations.
def main_observation(inputs,observe):
 return code('''
 import runpy, builtins, contextlib, io, re
 values=iter(INPUTS)
 builtins.input=lambda prompt='':next(values)
 output=io.StringIO()
 with contextlib.redirect_stdout(output):
     runpy.run_path('/w/main.py',run_name='__main__')
 raw=output.getvalue()
 ''').replace('INPUTS',repr([str(x) for x in inputs]))+code(observe)

def integration(source,qs):
 tag=source['key'][5:8]+'_'+('41' if source['variant']=='43' else source['variant'])
 numeric="numbers=[float(n) for n in re.findall(r'(?<![A-Za-z0-9_])-?\\d+(?:\\.\\d+)?(?![A-Za-z0-9_])',raw)]\n"
 def nums(inputs,expected,sort=False,extra=''):
     if sort:expected=sorted(expected)
     observe=numeric+extra+("numbers.sort()\n" if sort else '')+"expected="+repr(expected)+"\nposition=0\nmatched=[]\nfor target in expected:\n    while position<len(numbers) and abs(numbers[position]-target)>0.011:position+=1\n    if position==len(numbers):raise AssertionError('Required result missing')\n    matched.append(format(target,'.2f'));position+=1\nprint(*matched)\n"
     return (inputs,observe,' '.join(format(float(x),'.2f') for x in expected)+'\n')
 f=source['files']['sf']['textFiles']
 if tag=='s23_41':
     data=[int(x) for x in f['Data.txt'].splitlines()]
     specs=[nums([12],data+[12,4]),nums([],[60,40,120,80,6],True),([],"print(*raw.split())",'pink hamster blue elephant white eagle yellow rabbit\n')]
 elif tag=='s23_42':
     records=[['ADF',10],['OOP',1],['BXW',5],['XXZ',22],['HQR',6],['LLP',3],['LLP',3]]
     employee=[12452,730.56,21548,890,2586,674.915625,65912,475,42004,768.5955,82610,502.075,51947,1216.1409,51847,339.5925]
     specs=[([],"print(*[w for w in raw.split() if w in ['horse','lion','rabbit','mouse','bird','deer','whale','elephant','kangaroo','tiger']])",'whale tiger rabbit mouse lion kangaroo horse elephant deer bird\n'),([v for r in records for v in r],"observed=[w for w in re.findall(r'[A-Za-z]+|-?\\d+',raw) if w in ['ADF','OOP','BXW','XXZ','HQR','LLP'] or w.lstrip('-').isdigit()]\nexpected=['ADF','10','LLP','3','OOP','1','BXW','5','XXZ','22','HQR','6']\nposition=0\nfor token in observed:\n    if position<len(expected) and token==expected[position]:position+=1\nif position!=len(expected):raise AssertionError('Required records missing')\nprint(*expected)",'ADF 10 LLP 3 OOP 1 BXW 5 XXZ 22 HQR 6\n'),nums([],employee)]
 elif tag=='w23_41':
     from collections import Counter
     counts=Counter(f['QueueData.txt'].splitlines())
     specs=[nums([],[3,4]),nums([],[v for k,n in counts.items() for v in [int(k),n]]),nums(['jack','right'],[60,50],True)]
 elif tag=='w23_42':
     vowels=[x for x in f['StackData.txt'].splitlines() if x in 'aeiou'];cons=[x for x in f['StackData.txt'].splitlines() if x not in 'aeiou']
     letters=vowels[-1]+cons[-1]+cons[-2]+vowels[-2]+vowels[-3]
     specs=[(['vowel','consonant','consonant','vowel','vowel'],"print(raw.split()[-1])",letters+'\n'),nums([],[18,93]),nums([],[4,77,5,90],True)]
 elif tag=='s24_41':
     inputs=['999999X','1251484','5500212','0033585','9845788','6666666','3258746','8111022','7568557','0012353']
     specs=[nums([5,1,6,2,8,10,2],[1,6,2,8,10,1,2,6,8,10,1]),nums([400,200,'Yes','Blue Conifer',100],[400,200,30,250,50,40,300,150,40,3.75],extra="if numbers and numbers[-1] in [3,4]:numbers[-1]=3.75\n"),nums(inputs,[4,999999])]
 elif tag=='s24_42':
     specs=[(['easy','she','out','no'],numeric+"answers=['hues','hose','hoes','shoe','sou','ohs','ose','oes','sue','use','hue','hoe','hes']\nprint(sum(bool(re.search(r'\\b'+word+r'\\b',raw)) for word in answers))\nprint(any(abs(x-100/14)<0.5 for x in numbers))",'13\nTrue\n'),nums([],[2,10,1,-1,11,4,3,5,5,-1,1,-1,6,20,-1,-1,7,-1,-1,15,-1]),nums([],[1,8,15,22,85,100,644]*2+[6])]
 elif tag=='w24_41':
     original=f['Data.txt'].splitlines()
     chances=[14.4,72,57.6,50.4,39,65,52,45.5]
     numeric_chances=[v for i,chance in enumerate(chances) for v in [i%4+1,chance]]+[48.6,50.375]
     specs=[([],"words=re.findall(r'[A-Za-z]+',raw)\nprint(*[w for w in words if w in "+repr(original)+"])",' '.join(original+sorted(original))+'\n'),nums([152,5,121,1,130,3,145,4],numeric_chances,True),nums([5,1,2,3,8],[8,3,2,1,5,8,3,2,1])]
 elif tag=='w24_42':
     rows=[f['HighScoreTable.txt'].splitlines()[i:i+3] for i in range(0,21,3)]
     sortedrows=sorted(rows,key=lambda r:(int(r[1]),int(r[2])),reverse=True)
     specs=[([],"observed=re.findall(r'\\b(?:Tarz|Geni)\\b',raw)\nexpected=['Tarz','Tarz','Tarz','Geni','Tarz','Tarz']\nposition=0\nfor name in observed:\n    if position<len(expected) and name==expected[position]:position+=1\nif position!=len(expected):raise AssertionError('Required winners missing')\nprint(*expected)\nlines=[line for line in raw.splitlines() if line.strip()]\nprint(re.findall(r'\\d+',lines[-1])[-1])",'Tarz Tarz Tarz Geni Tarz Tarz\n4\n'),nums([10,9,8,7,6,5,4,3,2,1],list(range(10,0,-1))+[10,9]+list(range(8,0,-1))),nums([],[int(v) for r in rows+sortedrows for v in r[1:]])]
 else:raise ValueError(tag)
 for q,spec in zip(qs,specs):
     sid=next(s['id'] for s in q['question']['stages'] if s['judgeMode']=='auto')
     inputs,observe,expected=spec
     q['tests'][sid].append(case('full-main-program',main_observation(inputs,observe),expected,load=False))
 return qs

# Keep all generated outputs based on the same reproducible integration rules.
_base_assemble=assemble
def assemble(source,qs):return _base_assemble(source,integration(source,qs))

LOAD += code('''
def _employee(pay,number,title):
    for args in [(pay,number,title),(number,pay,title)]:
        try:
            obj=candidate.Employee(*args)
            if obj.GetEmployeeNumber()==number:return obj
        except (TypeError,ValueError):pass
    raise ValueError('Employee interface')
def _manager(bonus,pay,number,title):
    for args in [(bonus,pay,number,title),(number,pay,title,bonus),(pay,number,title,bonus),(pay,number,bonus,title)]:
        try:
            obj=candidate.Manager(*args)
            if obj.GetEmployeeNumber()==number:return obj
        except (TypeError,ValueError):pass
    raise ValueError('Manager interface')
def _sale(ID='',Quantity=-1):
    try:obj=candidate.SaleData(ID,Quantity)
    except TypeError:
        obj=candidate.SaleData()
        if hasattr(obj,'SaleID'):obj.SaleID=ID
        else:obj.ID=ID
        obj.Quantity=Quantity
    return obj
def _sid(record):
    return getattr(record,'ID',getattr(record,'SaleID',None))
def _record():
    try:return candidate.RecordData('',0)
    except TypeError:return candidate.RecordData()
def _construct_date(cls,args):
    if None not in args:return cls(*args)
    import datetime
    dates=[datetime.date(2019,1,1),datetime.datetime(2019,1,1),'2019-01-01','01/01/2019','1/1/2019','01-01-2019','20190101']
    for date in dates:
        try:return cls(*[date if x is None else x for x in args])
        except (TypeError,ValueError,AttributeError):pass
    raise ValueError('Date representation')
def _character(*args):return _construct_date(candidate.Character,args)
def _magic(*args):return _construct_date(candidate.MagicCharacter,args)
''')
_base_case=case
def case(i,body,expected,public=True,files=None,load=True):
 if load:
     body=body.replace('candidate.Employee(','_employee(').replace('candidate.Manager(','_manager(')
     body=body.replace('candidate.SaleData(','_sale(').replace('candidate.RecordData()','_record()')
     body=body.replace('candidate.CircularQueue[0].ID','_sid(candidate.CircularQueue[0])').replace('r.ID','_sid(r)')
     body=body.replace('candidate.Character(','_character(').replace('candidate.MagicCharacter(','_magic(')
 return _base_case(i,body,expected,public,files,load)
LOAD += code('''
def _iterative(array):
    import inspect
    fn=candidate.IterativeInsertion
    return fn(array,len(array)) if len(inspect.signature(fn).parameters)>=2 else fn(array)
''')
_compatible_case=case
def case(i,body,expected,public=True,files=None,load=True):
 if load:body=body.replace('candidate.IterativeInsertion(','_iterative(')
 return _compatible_case(i,body,expected,public,files,load)

LOAD += code("""
def _quiet_call(function, *args):
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):return function(*args)
""")
_prompt_compatible_case=case
def case(i,body,expected,public=True,files=None,load=True):
 if load:
     body=body.replace('candidate.Initialise()','_quiet_call(candidate.Initialise)')
     body=body.replace('candidate.InsertData()','_quiet_call(candidate.InsertData)')
 return _prompt_compatible_case(i,body,expected,public,files,load)
