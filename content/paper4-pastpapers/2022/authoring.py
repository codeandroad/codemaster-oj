from pathlib import Path
import json, textwrap, ast
ROOT=Path(__file__).resolve().parent
CAT={r['key']:r for r in json.loads((ROOT/'sources.json').read_text())}
def code(s): return textwrap.dedent(s).strip()+'\n'
LOAD=code('''
import ast, types, contextlib, io, builtins, inspect, re, sys, __future__
source=open('/w/main.py',encoding='utf-8').read()
tree=ast.parse(source)
defined_functions={n.name for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
# Keep declarations and definitions wherever the student places them; omit main-program calls.
keep=[]
for n in tree.body:
    if isinstance(n,(ast.Import,ast.ImportFrom,ast.FunctionDef,ast.ClassDef)):
        keep.append(n)
    elif isinstance(n,(ast.Assign,ast.AnnAssign,ast.For,ast.While)):
        if not any(isinstance(x,ast.Call) and ((isinstance(x.func,ast.Name) and (x.func.id in defined_functions or x.func.id in ('input','open','print'))) or (isinstance(x.func,ast.Attribute) and x.func.attr in ('input','read','readline','readlines'))) for x in ast.walk(n)):
            keep.append(n)
c=types.ModuleType('candidate'); c.__file__='/w/main.py'
sys.modules['candidate']=c
future_flags=0
with contextlib.redirect_stdout(io.StringIO()):
    for declaration in keep:
        try:
            if isinstance(declaration,ast.ImportFrom) and declaration.module=='__future__':
                for feature in declaration.names:future_flags |= getattr(__future__,feature.name).compiler_flag
            unit=ast.fix_missing_locations(ast.Module(body=[declaration],type_ignores=[]))
            exec(compile(unit,'/w/main.py','exec',flags=future_flags),c.__dict__)
        except (NameError,IndexError,AttributeError,TypeError,ValueError):
            # Main-program assignments can depend on skipped user input or loops.
            # Missing declarations still cause the actual interface checks to fail.
            if not isinstance(declaration,(ast.Assign,ast.AnnAssign,ast.For,ast.While)):raise

''')
MAIN=code('''
import contextlib, io, builtins, re, runpy
values=iter(INPUTS)
original_input=builtins.input
builtins.input=lambda prompt='':next(values)
out=io.StringIO()
try:
    with contextlib.redirect_stdout(out): ns=runpy.run_path('/w/main.py',run_name='__main__')
finally: builtins.input=original_input
text=out.getvalue()
''')
def driver(body,load=True):
 s=(LOAD if load else '')+code(body)
 return 'try:\n'+textwrap.indent(s,'    ')+'except Exception:\n    print("FAIL")\n'
def main(body,inputs): return driver('INPUTS='+repr(list(map(str,inputs)))+'\n'+MAIN+code(body),False)
def test(id,body,expected='PASS\n',public=True,load=True,files=None):
 d={'id':id,'public':public,'driverCode':driver(body,load),'expectedStdout':expected}
 if files is not None:d['inputFiles']=files
 return d
def mt(id,body,inputs,public=True,files=None):
 d={'id':id,'public':public,'driverCode':main(body,inputs),'expectedStdout':'PASS\n'}
 if files is not None:d['inputFiles']=files
 return d
def stage(id,title,marks,mode='manual',desc=None):return dict(id=id,title=title,description=desc or ('Teacher reviews required declarations, algorithm structure and interfaces.' if mode=='manual' else 'Teacher reviews the specified saved run evidence.' if mode=='evidence' else 'Isolated functional checks; teacher also checks the original algorithm and source requirements.'),maxMarks=marks,judgeMode=mode)
def q(key,title,statement,stages,files=None,outputs=None):return dict(key=key,title=title,statement=code(statement),starterCode='# Write your Python program here.\n',initialFiles=files or {},outputFiles=outputs or [],stages=stages)
def pack(keys,questions,cases,refs,sourceQuestion=0):
 for key in keys:
  r=CAT[key];qs=json.loads(json.dumps(questions));files=r['files'].get('sf',{}).get('textFiles',{})
  qs[sourceQuestion]['initialFiles']=files
  m=dict(format='codemaster-paper4',version=1,paper=dict(title=f"9618 Paper 4 · {r['season']} {r['year']} · Paper {r['variant']}",description='Classroom Python adaptation of the supplied question paper, mark scheme and candidate text files. Original subpart marks are retained; automatic checks do not replace teacher marking.',examYear=r['year'],examSession='summer' if key[5]=='s' else 'autumn',examVariant=int(r['variant'])),questions=qs,runnerCases=cases,referenceSolutions=refs)
  assert sum(s['maxMarks'] for x in qs for s in x['stages'])==75
  assert sum(map(len,cases.values()))<=50
  for ref in refs.values():ast.parse(ref)
  for cs in cases.values():
   for ca in cs:ast.parse(ca['driverCode'])
  ROOT.mkdir(parents=True,exist_ok=True);(ROOT/(key+'.json')).write_text(json.dumps(m,indent=2,ensure_ascii=False)+'\n')

r1=code('''
HighScores=[['',0] for _ in range(11)] # Global player names and scores

def ReadHighScores():
    with open('HighScore.txt') as f:
        for i in range(10):HighScores[i]=[f.readline().strip(),int(f.readline())]

def OutputHighScores():
    for name,score in HighScores:print(name,score)

def InsertScore(name,score):
    HighScores[10]=[name,score]
    for i in range(1,11):
        item=HighScores[i];j=i-1
        while j>=0 and HighScores[j][1]<item[1]:
            HighScores[j+1]=HighScores[j];j-=1
        HighScores[j+1]=item

def WriteTopTen():
    with open('NewHighScore.txt','w') as f:
        for name,score in HighScores[:10]:f.write(str(name)+'\\n'+str(score)+'\\n')

if __name__=='__main__':
    ReadHighScores();OutputHighScores()
    name=input('Three-character player name: ')
    while len(name)!=3:name=input('Three-character player name: ')
    while True:
        try:
            score=int(input('Score 1 to 100000: '))
            if 1<=score<=100000:break
        except ValueError:pass
    InsertScore(name,score);OutputHighScores();WriteTopTen()
''')
r2=code('''
class Balloon:
    def __init__(self,defenceItem,colour):
        self.__DefenceItem=defenceItem # STRING
        self.__Colour=colour # STRING
        self.__Health=100 # INTEGER
    def GetDefenceItem(self):return self.__DefenceItem
    def ChangeHealth(self,change):self.__Health+=change
    def CheckHealth(self):return self.__Health<=0

def Defend(balloon):
    strength=int(input('Opponent strength: '))
    balloon.ChangeHealth(-strength)
    print(balloon.GetDefenceItem())
    print('No health remaining' if balloon.CheckHealth() else 'Health remaining')
    return balloon

if __name__=='__main__':
    defence=input('Defence item: ');colour=input('Colour: ')
    Balloon1=Balloon(defence,colour)
    Balloon1=Defend(Balloon1)
''')
r3=code('''
QueueArray=['']*10 # ARRAY[0:9] OF STRING
HeadPointer=0 # INTEGER
TailPointer=0 # INTEGER
NumberItems=0 # INTEGER

def Enqueue(DataToAdd):
    global TailPointer,NumberItems
    if NumberItems==10:return False
    QueueArray[TailPointer]=DataToAdd
    TailPointer=(TailPointer+1)%10
    NumberItems+=1
    return True

def Dequeue():
    global HeadPointer,NumberItems
    if NumberItems==0:return 'FALSE'
    value=QueueArray[HeadPointer]
    HeadPointer=(HeadPointer+1)%10
    NumberItems-=1
    return value

if __name__=='__main__':
    for _ in range(11):
        value=input('String: ')
        print('Successful' if Enqueue(value) else 'Unsuccessful')
    print(Dequeue());print(Dequeue())
''')
q1=q('Q1','Top-ten high scores','''
`HighScore.txt` stores ten players in descending score order, with a three-character name then an integer score on the next line. The program reads the list, considers a new score, and can write the top ten to `NewHighScore.txt`.

## 1(a) [2]
Declare global array(s) for eleven player names and scores: ten from the file and one spare entry for insertion.

## 1(b) [6]
Write `ReadHighScores()` to open `HighScore.txt` and load the ten names and scores.

## 1(c) [3]
Write `OutputHighScores()` to output all eleven array entries (including the spare/staging entry) in `PlayerName Score` format, one player per line. For example, the first entries are `FYI 10000` and `ABC 9092`.

## 1(d)(i) [2]
Call `ReadHighScores()` followed by `OutputHighScores()` in the main program.

## 1(d)(ii) [1]
Retain the run output as evidence.

## 1(e)(i) [3]
Ask for a player name of exactly three characters and an integer score from 1 to 100000 inclusive. Validate both inputs.

## 1(e)(ii) [5]
Write a procedure taking a name and score as parameters. Create a new descending top ten that includes the new player if their score belongs in it. The original paper does not prescribe this procedure's name.

## 1(e)(iii) [2]
Call that procedure. Output the array before and after inserting the new player.

## 1(e)(iv) [1]
Retain evidence for `JKL` with score `9999`.

## 1(f) [4]
Write `WriteTopTen()` to store the new ten names and scores in `NewHighScore.txt`, in the same alternating-line format as the source file. You may call it from the finished main program. Saved runs replace screenshots.
''',[stage('Q1_a','1(a) Eleven-place data structures',2),stage('Q1_b','1(b) Read high scores',6,'auto'),stage('Q1_c','1(c) Output high scores',3,'auto'),stage('Q1_di','1(d)(i) Initial main calls',2,'auto'),stage('Q1_dii','1(d)(ii) Initial evidence',1,'evidence'),stage('Q1_ei','1(e)(i) Validate user data',3),stage('Q1_eii','1(e)(ii) Top-ten insertion procedure',5,'manual','Teacher checks the named-by-student two-parameter procedure, descending insertion, low-score rejection and preservation of associated names.'),stage('Q1_eiii','1(e)(iii) Before and after insertion',2,'auto'),stage('Q1_eiv','1(e)(iv) Insertion evidence',1,'evidence'),stage('Q1_f','1(f) Save top ten',4,'auto')],outputs=['NewHighScore.txt'])
q2=q('Q2','Balloon health','''
## 2(a) [5]
Declare class `Balloon` with private attributes `Health: INTEGER`, `Colour: STRING`, `DefenceItem: STRING`. The constructor takes defence item and colour, assigns them and sets health to 100. Include Python declaration comments.

## 2(b) [2]
Write `GetDefenceItem()` returning the defence item.

## 2(c) [2]
Write `ChangeHealth(change)` to add its integer parameter to health.

## 2(d) [2]
Write `CheckHealth()` returning `True` when health is zero or less, otherwise `False`.

## 2(e) [3]
Read a defence item and colour in the main program and create `Balloon1` using them.

## 2(f) [8]
Write `Defend(balloon)`. Read an opponent's strength, subtract it from the balloon's health using `ChangeHealth()`, output the defence item, and output an appropriate message stating whether health remains using `CheckHealth()`. Return the amended balloon.

## 2(g)(i) [2]
Call `Defend()` from the main program.

## 2(g)(ii) [1]
Retain a test run using defence item `Shield`, colour `Red`, and strength `50`. Saved output replaces the original screenshot.
''',[stage('Q2_a','2(a) Private balloon class',5),stage('Q2_b','2(b) Defence item getter',2,'auto'),stage('Q2_c','2(c) Change health',2,'auto'),stage('Q2_d','2(d) Health boundary',2,'auto'),stage('Q2_e','2(e) Balloon1 creation',3),stage('Q2_f','2(f) Defend function',8,'auto'),stage('Q2_gi','2(g)(i) Main function call',2,'auto'),stage('Q2_gii','2(g)(ii) Defence evidence',1,'evidence')])
q3=q('Q3','A string circular queue','''
## 3(a) [2]
Declare `QueueArray` with ten string entries, and head pointer, tail pointer and item count all initially zero. Use Python declaration comments.

## 3(b) [7]
Write `Enqueue()` to add a string parameter at the tail. Return `False` when the item count is ten; otherwise store the string, advance the tail (wrapping from 9 to 0), increase the count and return `True`. The source pseudocode passes the array and state by reference; Python may use globals or return updated state.

## 3(c) [6]
Write `Dequeue()` to return the string `FALSE` if empty. Otherwise return the oldest string, advance the head with wraparound and decrease the count.

## 3(d)(i) [5]
Read eleven strings in the main program and call `Enqueue()` for each. Output a message for every addition stating whether it succeeded. Then call `Dequeue()` twice and output each returned string.

## 3(d)(ii) [1]
Retain evidence using `A B C D E F G H I J K` as the eleven inputs, in that order. Saved run output replaces the screenshot. Teachers review message meaning, including ten successful additions and one failure.
''',[stage('Q3_a','3(a) Queue declaration',2),stage('Q3_b','3(b) Circular enqueue',7,'auto'),stage('Q3_c','3(c) Circular dequeue',6,'auto'),stage('Q3_di','3(d)(i) Eleven additions and two removals',5,'manual','Teacher verifies exactly eleven attempted additions, per-attempt messages and two returned values; wording is not fixed by the source.'),stage('Q3_dii','3(d)(ii) Queue evidence',1,'evidence')])
orig=[('FYI',10000),('ABC',9092),('KEL',8500),('PAI',8203),('BBB',7980),('ACE',7246),('GKL',7001),('JSI',6490),('EIF',6003),('DIS',2000)]
rowscode="rows=[(n,int(s.replace(' ',''))) for n,s in re.findall(r'(?m)^\\s*([A-Za-z]{3})\\s+([0-9 ]+)\\s*$',text)]\n"
readout="c.ReadHighScores()\no=io.StringIO()\nwith contextlib.redirect_stdout(o):c.OutputHighScores()\ntext=o.getvalue()\n"+rowscode
queueadapt=code('''
def en(value):
    n=len(inspect.signature(c.Enqueue).parameters)
    if n==1:r=c.Enqueue(value)
    else:r=c.Enqueue(c.QueueArray,c.HeadPointer,c.TailPointer,c.NumberItems,value)
    if isinstance(r,tuple):
        arrays=[x for x in r if isinstance(x,list)];ints=[x for x in r if isinstance(x,int) and not isinstance(x,bool)]
        if arrays:c.QueueArray=arrays[0]
        if len(ints)>=3:c.HeadPointer,c.TailPointer,c.NumberItems=ints[-3:]
        r=next((x for x in r if isinstance(x,bool)),None)
    return r

def de():
    n=len(inspect.signature(c.Dequeue).parameters)
    r=c.Dequeue() if n==0 else c.Dequeue(c.QueueArray,c.HeadPointer,c.TailPointer,c.NumberItems)
    if isinstance(r,tuple):
        ints=[x for x in r if isinstance(x,int) and not isinstance(x,bool)]
        if len(ints)>=3:c.HeadPointer,c.TailPointer,c.NumberItems=ints[-3:]
        return next((x for x in r if isinstance(x,str)),None)
    return r
c.QueueArray=['']*10;c.HeadPointer=0;c.TailPointer=0;c.NumberItems=0
''')
cases={
'Q1_b':[test('read-original',readout+f"print('PASS' if rows[:10]=={orig!r} else 'FAIL')"),test('read-different-file',readout+"print('PASS' if rows[:10]==[(chr(65+i)*3,100-i) for i in range(10)] else 'FAIL')",public=False,files={'HighScore.txt':''.join(chr(65+i)*3+'\n'+str(100-i)+'\n' for i in range(10))})],
'Q1_c':[test('formatted-original-list',readout+f"print('PASS' if rows[:10]=={orig!r} else 'FAIL')"),test('formatted-small-scores',readout+"print('PASS' if rows[:10]==[(chr(65+i)*3,10-i) for i in range(10)] else 'FAIL')",public=False,files={'HighScore.txt':''.join(chr(65+i)*3+'\n'+str(10-i)+'\n' for i in range(10))})],
'Q1_di':[mt('initial-list-before-input',rowscode+f"print('PASS' if rows[:10]=={orig!r} else 'FAIL')",['JKL',9999])],
'Q1_eiii':[mt('insert-original-9999',rowscode+f"print('PASS' if rows[:10]=={orig!r} and rows[10:20]=={[orig[0],('JKL',9999)]+orig[1:9]!r} else 'FAIL')",['JKL',9999]),mt('score-below-top-ten',rowscode+f"print('PASS' if rows[:10]=={orig!r} and rows[10:20]=={orig!r} else 'FAIL')",['LOW',1],False),mt('new-highest-score',rowscode+f"print('PASS' if rows[10:20]=={[('TOP',100000)]+orig[:9]!r} else 'FAIL')",['TOP',100000],False)],
'Q1_f':[dict(test('write-original-top-ten',"c.ReadHighScores();c.WriteTopTen()\nprint('PASS')"),expectedFiles={'NewHighScore.txt':''.join(n+'\n'+str(s)+'\n' for n,s in orig)}),dict(test('overwrite-not-append',"c.ReadHighScores();c.WriteTopTen()\nprint('PASS')",public=False,files={'NewHighScore.txt':'old content\n'}),expectedFiles={'NewHighScore.txt':''.join(n+'\n'+str(s)+'\n' for n,s in orig)})],
'Q2_b':[test('shield-getter',"print(c.Balloon('Shield','Red').GetDefenceItem())",'Shield\n'),test('other-item',"print(c.Balloon('Umbrella','Blue').GetDefenceItem())",'Umbrella\n',False)],
'Q2_c':[test('successive-damage-and-healing',"b=c.Balloon('Shield','Red')\nb.ChangeHealth(-60);print(b.CheckHealth())\nb.ChangeHealth(-40);print(b.CheckHealth())\nb.ChangeHealth(1);print(b.CheckHealth())",'False True False\n'),test('negative-health',"b=c.Balloon('X','Y');b.ChangeHealth(-101);print(b.CheckHealth());b.ChangeHealth(2);print(b.CheckHealth())",'True False\n',False)],
'Q2_d':[test('zero-health-is-dead',"b=c.Balloon('X','Y');print(b.CheckHealth());b.ChangeHealth(-100);print(b.CheckHealth())",'False True\n'),test('one-positive-one-negative',"b=c.Balloon('X','Y');b.ChangeHealth(-99);print(b.CheckHealth());b.ChangeHealth(-2);print(b.CheckHealth())",'False True\n',False)],
'Q2_f':[test('defend-fifty',"b=c.Balloon('Shield','Red');builtins.input=lambda prompt='':'50'\no=io.StringIO()\nwith contextlib.redirect_stdout(o):r=c.Defend(b)\nr.ChangeHealth(-50)\nprint('PASS' if r.CheckHealth() and 'Shield' in o.getvalue() else 'FAIL')"),test('defend-lethal',"b=c.Balloon('Mirror','Blue');builtins.input=lambda prompt='':'101'\no=io.StringIO()\nwith contextlib.redirect_stdout(o):r=c.Defend(b)\nr.ChangeHealth(1);dead=r.CheckHealth();r.ChangeHealth(1)\nprint('PASS' if dead and not r.CheckHealth() and 'Mirror' in o.getvalue() else 'FAIL')",public=False)],
'Q2_gi':[mt('defend-main',"b=ns.get('Balloon1')\nprint('PASS' if b is not None and not b.CheckHealth() and b.GetDefenceItem()=='Shield' and 'Shield' in text else 'FAIL')",['Shield','Red',50])],
'Q3_b':[test('ten-accepted-one-refused',queueadapt+"print(*[en(chr(65+i)) for i in range(11)])\nprint(c.HeadPointer,c.TailPointer,c.NumberItems)\nprint(*c.QueueArray)",'True True True True True True True True True True False\n0 0 10\nA B C D E F G H I J\n'),test('tail-wrap-around',queueadapt+"c.HeadPointer=9;c.TailPointer=9\nprint(en('last'),en('first'));print(c.TailPointer,c.QueueArray[9],c.QueueArray[0])",'True True\n1 last first\n',False)],
'Q3_c':[test('fifo-and-wrap',queueadapt+"for n in range(10):en(str(n))\nprint(de(),de());en('10');en('11')\nprint(*[de() for _ in range(11)])",'0 1\n2 3 4 5 6 7 8 9 10 11 FALSE\n'),test('empty-then-single',queueadapt+"print(de());en('only');print(de(),de(),c.NumberItems)",'FALSE\nonly FALSE 0\n',False)]}

# The published OutputHighScores loop visits all eleven array positions; only the first ten are saved.
# File tests compare logical lines so an optional terminal newline is not an extra requirement.
write_cases=[]
for case_id,pairs,public,overrides in [
    ('write-original-top-ten',orig,True,{}),
    ('overwrite-alternate-top-ten',[(chr(65+i)*3,100-i) for i in range(10)],False,{'NewHighScore.txt':'old content\n','HighScore.txt':''.join(chr(65+i)*3+'\n'+str(100-i)+'\n' for i in range(10))})
]:
    lines=[str(value) for pair in pairs for value in pair]
    body="with contextlib.redirect_stdout(io.StringIO()):c.ReadHighScores();c.WriteTopTen()\n"
    body+="actual=open('NewHighScore.txt').read().splitlines()\nprint('PASS' if actual=="+repr(lines)+" else 'FAIL')"
    write_cases.append(test(case_id,body,public=public,files=overrides))
cases['Q1_f']=write_cases

pack(['9618_s22_41','9618_s22_43'],[q1,q2,q3],cases,dict(Q1=r1,Q2=r2,Q3=r3))
s42r1=code('''
StackData=[0]*10 # ARRAY[0:9] OF INTEGER
StackPointer=0 # INTEGER

def OutputStack():
    for value in StackData:print(value)
    print(StackPointer)

def Push(value):
    global StackPointer
    if StackPointer==10:return False
    StackData[StackPointer]=value;StackPointer+=1
    return True

def Pop():
    global StackPointer
    if StackPointer==0:return -1
    StackPointer-=1
    return StackData[StackPointer]

if __name__=='__main__':
    for _ in range(11):
        value=int(input('Integer: '))
        print('Added' if Push(value) else 'Stack full: not added')
    OutputStack()
    Pop();Pop();OutputStack()
''')
s42r2=code('''
import random
ArrayData=[[random.randint(1,100) for _ in range(10)] for _ in range(10)]

def OutputArray():
    for row in ArrayData:print(*row)

def BinarySearch(SearchArray,Lower,Upper,SearchValue):
    if Upper<Lower:return -1
    Mid=(Lower+Upper)//2
    if SearchArray[0][Mid]==SearchValue:return Mid
    if SearchArray[0][Mid]>SearchValue:return BinarySearch(SearchArray,Lower,Mid-1,SearchValue)
    return BinarySearch(SearchArray,Mid+1,Upper,SearchValue)

if __name__=='__main__':
    OutputArray()
    for X in range(10):
        for Y in range(9):
            for Z in range(8-Y+1):
                if ArrayData[X][Z]>ArrayData[X][Z+1]:
                    ArrayData[X][Z],ArrayData[X][Z+1]=ArrayData[X][Z+1],ArrayData[X][Z]
    OutputArray()
    print(BinarySearch(ArrayData,0,9,ArrayData[0][0]))
    print(BinarySearch(ArrayData,0,9,101))
''')
s42r3=code('''
class Card:
    def __init__(self,number,colour):
        self.__Number=number # INTEGER
        self.__Colour=colour # STRING
    def GetNumber(self):return self.__Number
    def GetColour(self):return self.__Colour

Cards=[] # ARRAY[0:29] OF Card
Selected=[False]*30 # ARRAY[0:29] OF BOOLEAN

def ChooseCard():
    while True:
        try:value=int(input('Card index 1 to 30: '))
        except ValueError:continue
        if 1<=value<=30 and not Selected[value-1]:
            Selected[value-1]=True
            return value

if __name__=='__main__':
    with open('CardValues.txt') as f:
        for _ in range(30):Cards.append(Card(int(f.readline()),f.readline().strip()))
    Player1=[] # ARRAY OF Card
    for _ in range(4):Player1.append(Cards[ChooseCard()-1])
    for card in Player1:print(card.GetNumber(),card.GetColour())
''')
s42q1=q('Q1','A ten-element integer stack','''
## 1(a) [3]
Declare global `StackData`, a ten-place integer array, and `StackPointer = 0`, pointing to the next available space.

## 1(b) [3]
Write a procedure to output all ten array elements and `StackPointer`. The original paper does not prescribe its name.

## 1(c) [6]
Write `Push(integer)`. Return `False` if full; otherwise store the parameter, update the pointer and return `True`.

## 1(d)(i) [5]
Read eleven integers in the main program and attempt to push each one. Output an appropriate success/full message for each attempt. Then output the stack contents.

## 1(d)(ii) [1]
Retain evidence using `11 12 13 14 15 16 17 18 19 20 21`.

## 1(e)(i) [5]
Write `Pop()`. Return `-1` if empty; otherwise return the top element and update the pointer.

## 1(e)(ii) [2]
After the eleven attempts, call `Pop()` twice and output the updated stack contents. Retain the test output as evidence; saved output replaces the original screenshot.
''',[stage('Q1_a','1(a) Stack declarations',3),stage('Q1_b','1(b) Output procedure',3),stage('Q1_c','1(c) Push',6,'auto'),stage('Q1_di','1(d)(i) Eleven push attempts',5,'manual','Teacher reviews the eleven input attempts, per-attempt success/full messages and the call to the student-named output procedure.'),stage('Q1_dii','1(d)(ii) Push evidence',1,'evidence'),stage('Q1_ei','1(e)(i) Pop',5,'auto'),stage('Q1_eii','1(e)(ii) Pop twice and show evidence',2,'evidence')])
s42q2=q('Q2','Sorting rows and recursive binary search','''
## 2(a) [4]
Declare a 10 by 10 integer array and initialise every element with a random integer from 1 to 100 inclusive.

## 2(b)(i) [5]
After initialisation, implement the supplied ascending bubble-sort algorithm on every row. For each row `X`, make nine passes and compare adjacent columns `Z` and `Z+1`, exchanging them when out of order. Reduce the final compared column by one after each pass. Do not use a built-in sorting function.

## 2(b)(ii) [3]
Write an output procedure showing the entire array as a grid of ten rows and ten columns. Call it before and after sorting.

## 2(b)(iii) [1]
Retain the output as evidence.

## 2(c)(i) [8]
Write recursive `BinarySearch(SearchArray, Lower, Upper, SearchValue)` to search the sorted first row. Bounds are inclusive. If the current interval is empty, return `-1`. Otherwise compare its midpoint with the search value and return the index for a match, or recurse into the appropriate half. Use integer division to obtain a midpoint within the current interval. The printed paper's midpoint expression has an off-by-one ambiguity; this classroom version requires a terminating search for every inclusive interval.

## 2(c)(ii) [2]
In the main program test `BinarySearch()` twice and output both return values: once for a number present in row one and once for a number absent from it. Retain evidence. Teachers also check recursion and the prohibition on built-in sorting.
''',[stage('Q2_a','2(a) Random integer grid',4),stage('Q2_bi','2(b)(i) Row bubble sort',5,'auto'),stage('Q2_bii','2(b)(ii) Before and after grids',3,'auto'),stage('Q2_biii','2(b)(iii) Sort evidence',1,'evidence'),stage('Q2_ci','2(c)(i) Recursive binary search',8,'auto'),stage('Q2_cii','2(c)(ii) Found and absent evidence',2,'evidence')])
s42q3=q('Q3','Selecting distinct playing cards','''
## 3(a) [5]
Declare class `Card` with private `Number: INTEGER` and `Colour: STRING`; its constructor takes these two values. Add Python declaration comments.

## 3(b) [3]
Write getters `GetNumber()` and `GetColour()`.

## 3(c) [7]
In the main program declare an array of thirty `Card` objects. Read the thirty cards from `CardValues.txt`, which stores alternating lines of number and colour, and create the objects in file order.

## 3(d) [6]
The game permits up to five players with four cards each, with no card chosen twice. Record which cards have been selected. Write `ChooseCard()` to read an integer index from 1 to 30, validate the range, reject an already selected card, and repeat until an available card is selected. Mark the card selected and return its index. Python may return the user index or its zero-based equivalent, provided the main program uses it consistently.

## 3(e)(i) [5]
For one player, create an array `Player1` of `Card`. Call `ChooseCard()` four times, store the chosen cards in `Player1` and output each chosen card's number and colour.

## 3(e)(ii) [1]
Retain evidence for two separate runs: `1 5 9 10`, and `2 2 3 4 4 5`. Duplicate choices in the second run must be rejected, leaving four different selected cards. Saved run output replaces screenshots.
''',[stage('Q3_a','3(a) Card class',5),stage('Q3_b','3(b) Card getters',3,'auto'),stage('Q3_c','3(c) Load thirty cards',7,'auto'),stage('Q3_d','3(d) Valid available card selection',6,'auto'),stage('Q3_ei','3(e)(i) Four-card hand',5,'auto'),stage('Q3_eii','3(e)(ii) Selection evidence',1,'evidence')])
gridbody=code('''
rows=[]
for line in text.splitlines():
    values=line.split()
    if len(values)==10:
        try:rows.append(list(map(int,values)))
        except ValueError:pass
ok=len(rows)==20 and all(1<=x<=100 for row in rows[:10] for x in row)
ok=ok and all(rows[10+i]==sorted(rows[i]) for i in range(10))
print('PASS' if ok else 'FAIL')
''')
def gridcase(id,seed,public=True):
 return {'id':id,'public':public,'driverCode':driver('INPUTS=[]\nimport random\nrandom.seed('+str(seed)+')\n'+MAIN+gridbody,False),'expectedStdout':'PASS\n'}
carddata=CAT['9618_s22_42']['files']['sf']['textFiles']['CardValues.txt'].splitlines()
cardpairs=[(int(carddata[i]),carddata[i+1]) for i in range(0,60,2)]
cardrows="rows=[(int(n),co.lower()) for n,co in re.findall(r'(?mi)^\\s*(\\d+)\\s+([a-z]+)\\s*$',text)]\n"
s42cases={
'Q1_c':[test('ten-pushes-and-overflow',"c.StackData=[0]*10;c.StackPointer=0\nprint(*[c.Push(n) for n in range(11,22)]);print(c.StackPointer);print(*c.StackData)",'True True True True True True True True True True False\n10\n11 12 13 14 15 16 17 18 19 20\n'),test('last-free-slot',"c.StackData=[0]*10;c.StackPointer=9\nprint(c.Push(-8),c.StackPointer,c.StackData[9]);print(c.Push(99),c.StackData[9])",'True 10 -8\nFalse -8\n',False)],
'Q1_ei':[test('lifo-and-empty',"c.StackData=[0]*10;c.StackPointer=0\nprint(c.Pop());c.Push(12);c.Push(99);print(c.Pop(),c.Pop(),c.Pop(),c.StackPointer)",'-1\n99 12 -1 0\n'),test('refill-after-pop',"c.StackData=list(range(10));c.StackPointer=10\nprint(c.Pop());print(c.Push(55));print(c.Pop(),c.StackPointer)",'9 True 55 9\n',False)],
'Q2_bi':[gridcase('random-rows-seed-17',17),gridcase('random-rows-seed-82',82,False)],
'Q2_bii':[gridcase('two-complete-grids',13),gridcase('two-grids-other-random-data',71,False)],
'Q2_ci':[test('first-row-found-and-absent',"a=[[1,4,7,10,13,16,19,22,25,28] for _ in range(10)]\nprint(c.BinarySearch(a,0,9,1),c.BinarySearch(a,0,9,28),c.BinarySearch(a,0,9,13),c.BinarySearch(a,0,9,14))",'0 9 4 -1\n'),test('single-empty-and-duplicates',"print(c.BinarySearch([[42,43,44,45,46,47,48,49,50,51] for _ in range(10)],0,0,42),c.BinarySearch([[42,43,44,45,46,47,48,49,50,51] for _ in range(10)],0,0,1),c.BinarySearch([[42,43,44,45,46,47,48,49,50,51] for _ in range(10)],1,0,42))\na=[[2,2,2,8,9,12,15,20,21,22] for _ in range(10)];r=c.BinarySearch(a,0,4,2);print('PASS' if r in [0,1,2] else 'FAIL')",'0 -1 -1\nPASS\n',False)],
'Q3_b':[test('number-and-colour',"x=c.Card(1,'red');print(x.GetNumber(),x.GetColour())",'1 red\n'),test('other-card',"x=c.Card(10,'orange');print(x.GetNumber(),x.GetColour())",'10 orange\n',False)],
'Q3_c':[mt('all-thirty-loaded',f"arrays=[a for a in ns.values() if isinstance(a,list) and len(a)==30 and all(hasattr(x,'GetNumber') for x in a)]\nprint('PASS' if any([(x.GetNumber(),x.GetColour().lower()) for x in a]=={cardpairs!r} for a in arrays) else 'FAIL')",[1,5,9,10]),mt('different-thirty-card-file',"arrays=[a for a in ns.values() if isinstance(a,list) and len(a)==30 and all(hasattr(x,'GetNumber') for x in a)]\nprint('PASS' if any([(x.GetNumber(),x.GetColour().lower()) for x in a]==[((i+4)%10+1,'red' if i%2==0 else 'blue') for i in range(30)] for a in arrays) else 'FAIL')",[1,2,3,4],False,files={'CardValues.txt':''.join(str((i+4)%10+1)+'\n'+('red' if i%2==0 else 'blue')+'\n' for i in range(30))})],
'Q3_d':[mt('original-repeated-selections',cardrows+f"print('PASS' if rows=={[cardpairs[i-1] for i in [2,3,4,5]]!r} else 'FAIL')",[2,2,3,4,4,5]),mt('invalid-range-and-repeat',cardrows+f"print('PASS' if rows=={[cardpairs[i-1] for i in [1,30,5,6]]!r} else 'FAIL')",[0,-1,31,1,1,30,5,5,6],False)],
'Q3_ei':[mt('original-four-card-selection',cardrows+f"print('PASS' if rows=={[cardpairs[i-1] for i in [1,5,9,10]]!r} else 'FAIL')",[1,5,9,10]),mt('end-of-array-selection',cardrows+f"print('PASS' if rows=={[cardpairs[i-1] for i in [27,28,29,30]]!r} else 'FAIL')",[27,28,29,30],False)]}
pack(['9618_s22_42'],[s42q1,s42q2,s42q3],s42cases,dict(Q1=s42r1,Q2=s42r2,Q3=s42r3),2)
w41r1=code('''
DataArray=[0]*100 # ARRAY[0:99] OF INTEGER

def ReadFile():
    global DataArray
    try:
        with open('IntegerData.txt') as f:
            for i in range(100):DataArray[i]=int(f.readline())
    except OSError:print('IntegerData.txt not found')

def FindValues():
    while True:
        try:
            value=int(input('Whole number 1 to 100: '))
            if 1<=value<=100:break
        except ValueError:pass
    return sum(1 for item in DataArray if item==value)

def BubbleSort():
    for i in range(99):
        for j in range(99-i):
            if DataArray[j]>DataArray[j+1]:DataArray[j],DataArray[j+1]=DataArray[j+1],DataArray[j]
    print(*DataArray)

if __name__=='__main__':
    ReadFile()
    print('Number of occurrences:',FindValues())
    BubbleSort()
''')
w41r2=code('''
class Card:
    def __init__(self,number,colour):
        self.__Number=number # INTEGER 1..5
        self.__Colour=colour # STRING red,blue,yellow
    def GetNumber(self):return self.__Number
    def GetColour(self):return self.__Colour

class Hand:
    def __init__(self,c1,c2,c3,c4,c5):
        self.__Cards=[c1,c2,c3,c4,c5]+[None]*5 # ARRAY[0:9] OF Card
        self.__FirstCard=0 # INTEGER
        self.__NumberCards=5 # INTEGER
    def GetCard(self,index):return self.__Cards[index]

def CalculateValue(hand):
    total=0
    for i in range(5):
        card=hand.GetCard(i)
        total+=card.GetNumber()
        if card.GetColour()=='red':total+=5
        elif card.GetColour()=='blue':total+=10
        elif card.GetColour()=='yellow':total+=15
    return total

if __name__=='__main__':
    Red1=Card(1,'red');Red2=Card(2,'red');Red3=Card(3,'red');Red4=Card(4,'red');Red5=Card(5,'red')
    Blue1=Card(1,'blue');Blue2=Card(2,'blue');Blue3=Card(3,'blue');Blue4=Card(4,'blue');Blue5=Card(5,'blue')
    Yellow1=Card(1,'yellow');Yellow2=Card(2,'yellow');Yellow3=Card(3,'yellow');Yellow4=Card(4,'yellow');Yellow5=Card(5,'yellow')
    Player1=Hand(Red1,Red2,Red3,Red4,Yellow1)
    Player2=Hand(Yellow2,Yellow3,Yellow4,Yellow5,Blue1)
    score1=CalculateValue(Player1);score2=CalculateValue(Player2)
    if score1>score2:print('Player 1 wins')
    elif score2>score1:print('Player 2 wins')
    else:print('Draw')
''')
w41r3=code('''
ArrayNodes=[[-1,-1,-1] for _ in range(20)] # ARRAY[0:19,0:2] OF INTEGER
ArrayNodes[0]=[1,20,5]
ArrayNodes[1]=[2,15,-1]
ArrayNodes[2]=[-1,3,3]
ArrayNodes[3]=[-1,9,4]
ArrayNodes[4]=[-1,10,-1]
ArrayNodes[5]=[-1,58,-1]
FreeNode=6 # INTEGER
RootPointer=0 # INTEGER

def SearchValue(Root,ValueToFind):
    if Root==-1 or ArrayNodes[Root][1]==-1:return -1
    if ArrayNodes[Root][1]==ValueToFind:return Root
    if ArrayNodes[Root][1]>ValueToFind:return SearchValue(ArrayNodes[Root][0],ValueToFind)
    return SearchValue(ArrayNodes[Root][2],ValueToFind)

def PostOrder(root):
    if root==-1:return
    if ArrayNodes[root][0]!=-1:PostOrder(ArrayNodes[root][0])
    if ArrayNodes[root][2]!=-1:PostOrder(ArrayNodes[root][2])
    print(ArrayNodes[root][1])

if __name__=='__main__':
    result=SearchValue(RootPointer,15)
    print(result if result!=-1 else 'Value not found')
    PostOrder(RootPointer)
''')
w41q1=q('Q1','Integer data searching and sorting','''
`IntegerData.txt` contains one hundred integers, each from 1 to 100 inclusive.

## 1(a) [2]
Declare global integer array `DataArray` with one hundred places.

## 1(b) [6]
Write `ReadFile()` to read the numbers into the array, with appropriate exception handling.

## 1(c) [7]
Write `FindValues()` to ask for a whole number from 1 to 100 inclusive, repeating until valid, and return the number of occurrences of that value in `DataArray`.

## 1(d)(i) [3]
Call `ReadFile()` and `FindValues()` in the main program and output the returned count with an appropriate message.

## 1(d)(ii) [1]
Retain evidence for search value `61`.

## 1(e) [4]
Write `BubbleSort()` using adjacent comparisons and swaps to sort the array and print its sorted contents. Call it from the main program. The question paper does not specify the sort direction; either consistent numerical direction is accepted in this classroom package. Teacher review checks bubble sort and the main call. Saved run output replaces screenshots.
''',[stage('Q1_a','1(a) Data array',2),stage('Q1_b','1(b) Read integers',6,'auto'),stage('Q1_c','1(c) Validated occurrence count',7,'auto'),stage('Q1_di','1(d)(i) Read and count in main',3,'manual','Teacher checks reader and finder calls and the correctly labelled returned count; message wording is not specified.'),stage('Q1_dii','1(d)(ii) Search evidence',1,'evidence'),stage('Q1_e','1(e) Bubble sort and output',4,'auto')])
w41q2=q('Q2','Cards, hands and scoring','''
## 2(a)(i) [5]
Declare class `Card` with private integer `Number` (1 to 5) and string `Colour` (`red`, `blue` or `yellow`). Its constructor takes the number and colour. Include Python declaration comments.

## 2(a)(ii) [3]
Write `GetNumber()` and `GetColour()`.

## 2(a)(iii) [2]
In the main program declare each of the fifteen possible cards as a `Card` variable: numbers 1 to 5 for each of red, blue and yellow.

## 2(b)(i) [6]
Declare class `Hand` with private `Cards`, an array of ten `Card` objects, `FirstCard: INTEGER` and `NumberCards: INTEGER`. Its constructor takes five card objects, assigns them to the array, sets `FirstCard = 0` and `NumberCards = 5`. Include Python declaration comments.

## 2(b)(ii) [2]
Write `GetCard(index)` to return the card stored at that array index.

## 2(b)(iii) [2]
Create two `Hand` objects. Player 1 holds `1 red, 2 red, 3 red, 4 red, 1 yellow`. Player 2 holds `2 yellow, 3 yellow, 4 yellow, 5 yellow, 1 blue`.

## 2(c)(i) [6]
Write `CalculateValue(hand)` returning the score for the five cards in a hand. For each card add its number, plus 5 if red, 10 if blue or 15 if yellow. Assume exactly five cards for this function.

## 2(c)(ii) [4]
Call `CalculateValue()` for both players in the main program. Output an appropriate message identifying the player with the greater score, or a draw when the scores are equal.

## 2(c)(iii) [1]
Retain test output as evidence. Saved output replaces screenshots.
''',[stage('Q2_ai','2(a)(i) Private card class',5),stage('Q2_aii','2(a)(ii) Card getters',3,'auto'),stage('Q2_aiii','2(a)(iii) Fifteen card variables',2),stage('Q2_bi','2(b)(i) Private hand class',6),stage('Q2_bii','2(b)(ii) Get card by index',2,'auto'),stage('Q2_biii','2(b)(iii) Both specified hands',2),stage('Q2_ci','2(c)(i) Calculate hand score',6,'auto'),stage('Q2_cii','2(c)(ii) Winner or draw',4,'manual','Teacher reviews both score calls, both winning branches and the equal-score branch without fixing the message wording.'),stage('Q2_ciii','2(c)(iii) Winner evidence',1,'evidence')])
w41q3=q('Q3','Tree search and postorder traversal','''
## 3(a) [3]
Declare global `ArrayNodes`, a 20 by 3 integer array. Initially set every field to `-1`, denoting a null pointer or unused data. Columns are left pointer, data, right pointer.

## 3(b) [2]
Store the following rows, leaving all remaining rows `[-1,-1,-1]`. Set `FreeNode = 6` and `RootPointer = 0`.

|Index|Left pointer|Data|Right pointer|
|---|---|---|---|
|0|1|20|5|
|1|2|15|-1|
|2|-1|3|3|
|3|-1|9|4|
|4|-1|10|-1|
|5|-1|58|-1|
|6|-1|-1|-1|

## 3(c) [5]
Write recursive `SearchValue(Root, ValueToFind)`. Return the matching node index or `-1` if absent. Return `-1` for a null root or unused data. Search left when the current data exceeds the target; search right when it is less.

## 3(d) [7]
Write recursive `PostOrder(root)` using the global tree. Visit the left child if present, then the right child if present, then output the current node's data. For the illustrative tree with root 50, children 25 and 60, and 25's children 3 and 9, the output is `3 9 25 60 50`.

## 3(e)(i) [3]
In the main program search for `15`; output its index if found or an appropriate not-found message. Then call `PostOrder()`.

## 3(e)(ii) [1]
Retain the run output as evidence. Saved output replaces the screenshot. Teachers also check recursion and the original declarations.
''',[stage('Q3_a','3(a) Null-initialised array',3),stage('Q3_b','3(b) Given tree and pointers',2),stage('Q3_c','3(c) Recursive tree search',5,'auto'),stage('Q3_d','3(d) Recursive postorder',7,'auto'),stage('Q3_ei','3(e)(i) Search and traversal main',3,'auto'),stage('Q3_eii','3(e)(ii) Tree evidence',1,'evidence')])
ints=list(map(int,CAT['9618_w22_41']['files']['sf']['textFiles']['IntegerData.txt'].splitlines()))
sortcheck="o=io.StringIO()\nwith contextlib.redirect_stdout(o):c.BubbleSort()\nnums=list(map(int,re.findall(r'[-+]?\\d+',o.getvalue())))\nprint('PASS' if nums in [sorted(values),sorted(values,reverse=True)] and c.DataArray in [sorted(values),sorted(values,reverse=True)] else 'FAIL')"
w41cases={
'Q1_b':[test('one-hundred-original-integers',f"c.ReadFile()\nprint('PASS' if c.DataArray=={ints!r} else 'FAIL')"),test('alternate-integer-file',"c.ReadFile()\nprint('PASS' if c.DataArray==list(range(100,0,-1)) else 'FAIL')",public=False,files={'IntegerData.txt':'\n'.join(map(str,range(100,0,-1)))+'\n'}),test('missing-integer-file',"import os\nos.remove('IntegerData.txt')\no=io.StringIO()\nwith contextlib.redirect_stdout(o):c.ReadFile()\nprint('PASS' if o.getvalue().strip() else 'FAIL')",public=False)],
'Q1_c':[test('original-sixty-one',"c.ReadFile();builtins.input=lambda prompt='':'61'\nprint(c.FindValues())",str(ints.count(61))+'\n'),test('reject-out-of-range-and-count',"c.DataArray=[1]*30+[100]*20+[50]*50\nv=iter(['0','101','100']);builtins.input=lambda prompt='':next(v)\nprint(c.FindValues())",'20\n',False),test('absent-value',"c.DataArray=[1]*100;builtins.input=lambda prompt='':'2'\nprint(c.FindValues())",'0\n',False)],
'Q1_e':[test('sort-original-and-output',"c.ReadFile();values=c.DataArray[:]\n"+sortcheck),test('duplicates-and-reverse',"values=[100,1,50,50,2]*20;c.DataArray=values[:]\n"+sortcheck,public=False)],
'Q2_aii':[test('red-card',"x=c.Card(1,'red');print(x.GetNumber(),x.GetColour())",'1 red\n'),test('yellow-card',"x=c.Card(5,'yellow');print(x.GetNumber(),x.GetColour())",'5 yellow\n',False)],
'Q2_bii':[test('hand-card-order',"cards=[c.Card(i,'red') for i in range(1,6)];h=c.Hand(*cards)\nprint(*[h.GetCard(i).GetNumber() for i in range(5)])",'1 2 3 4 5\n'),test('hand-colour-association',"cards=[c.Card(5,'blue'),c.Card(3,'yellow'),c.Card(1,'red'),c.Card(2,'blue'),c.Card(4,'yellow')];h=c.Hand(*cards)\nprint(*[h.GetCard(i).GetColour() for i in range(5)])",'blue yellow red blue yellow\n',False)],
'Q2_ci':[test('both-original-scores',"a=c.Hand(c.Card(1,'red'),c.Card(2,'red'),c.Card(3,'red'),c.Card(4,'red'),c.Card(1,'yellow'))\nb=c.Hand(c.Card(2,'yellow'),c.Card(3,'yellow'),c.Card(4,'yellow'),c.Card(5,'yellow'),c.Card(1,'blue'))\nprint(c.CalculateValue(a),c.CalculateValue(b))",'46 85\n'),test('all-colours-and-card-values',"a=c.Hand(*[c.Card(5,'blue') for _ in range(5)]);b=c.Hand(*[c.Card(1,'yellow') for _ in range(5)]);d=c.Hand(*[c.Card(2,'red') for _ in range(5)])\nprint(c.CalculateValue(a),c.CalculateValue(b),c.CalculateValue(d))",'75 80 35\n',False)],
'Q3_c':[test('given-tree-indices',"print(*[c.SearchValue(0,v) for v in [20,15,3,9,10,58,16]])",'0 1 2 3 4 5 -1\n'),test('null-and-unused-roots',"print(c.SearchValue(-1,20),c.SearchValue(6,20),c.SearchValue(2,10),c.SearchValue(2,15))",'-1 -1 4 -1\n',False)],
'Q3_d':[test('given-tree-postorder',"c.PostOrder(0)",'10 9 3 15 58 20\n'),test('single-node-and-subtree',"c.PostOrder(4);c.PostOrder(2)",'10 10 9 3\n',False)],
'Q3_ei':[mt('search-fifteen-and-postorder',"nums=list(map(int,re.findall(r'[-+]?\\d+',text)))\nprint('PASS' if nums==[1,10,9,3,15,58,20] else 'FAIL')",[])]}
pack(['9618_w22_41','9618_w22_43'],[w41q1,w41q2,w41q3],w41cases,dict(Q1=w41r1,Q2=w41r2,Q3=w41r3))
w42r1=code('''
Jobs=[[-1,-1] for _ in range(100)] # ARRAY[0:99,0:1] OF INTEGER
NumberOfJobs=0 # INTEGER

def Initialise():
    global Jobs,NumberOfJobs
    Jobs=[[-1,-1] for _ in range(100)];NumberOfJobs=0

def AddJob(number,priority):
    global NumberOfJobs
    if NumberOfJobs==100:print('Not added');return
    Jobs[NumberOfJobs]=[number,priority];NumberOfJobs+=1
    print('Added')

def InsertionSort():
    for i in range(1,NumberOfJobs):
        value=Jobs[i][:];j=i-1
        while j>=0 and Jobs[j][1]>value[1]:
            Jobs[j+1]=Jobs[j][:];j-=1
        Jobs[j+1]=value

def PrintArray():
    for i in range(NumberOfJobs):print(Jobs[i][0],'priority',Jobs[i][1])

if __name__=='__main__':
    Initialise()
    AddJob(12,10);AddJob(526,9);AddJob(33,8);AddJob(12,9);AddJob(78,1)
    InsertionSort();PrintArray()
''')
w42r2=code('''
class Character:
    def __init__(self,name,x,y):
        self.__Name=name # STRING
        self.__XCoordinate=x # INTEGER
        self.__YCoordinate=y # INTEGER
    def GetName(self):return self.__Name
    def GetX(self):return self.__XCoordinate
    def GetY(self):return self.__YCoordinate
    def ChangePosition(self,XChange,YChange):
        self.__XCoordinate+=XChange;self.__YCoordinate+=YChange

if __name__=='__main__':
    Characters=[] # ARRAY[0:9] OF Character
    with open('Characters.txt') as f:
        for _ in range(10):Characters.append(Character(f.readline().strip(),int(f.readline()),int(f.readline())))
    index=-1
    while index==-1:
        name=input('Character name: ').lower()
        for i,character in enumerate(Characters):
            if character.GetName().lower()==name:index=i;break
    move=input('Direction A,W,S,D: ').upper()
    while move not in ('A','W','S','D'):move=input('Direction A,W,S,D: ').upper()
    delta={'A':(-1,0),'W':(0,1),'S':(0,-1),'D':(1,0)}
    Characters[index].ChangePosition(*delta[move])
    character=Characters[index]
    print(character.GetName(),'has changed coordinates to X =',character.GetX(),'and Y =',character.GetY())
''')
w42r3=code('''
Queue=[0]*100 # ARRAY[0:99] OF INTEGER
HeadPointer=0 # INTEGER
TailPointer=0 # INTEGER

def Enqueue(value):
    global TailPointer
    if TailPointer>=100:return False
    Queue[TailPointer]=value;TailPointer+=1
    return True

def RecursiveOutput(Start):
    if Start<=HeadPointer:return 0
    return Queue[Start-1]+RecursiveOutput(Start-1)

if __name__=='__main__':
    successful=True
    for n in range(1,21):
        if not Enqueue(n):successful=False
    print('Successful' if successful else 'Unsuccessful')
    print(RecursiveOutput(TailPointer))
''')
w42q1=q('Q1','Priority jobs and insertion sort','''
Jobs have an integer job number and priority from 1 (highest) to 10 (lowest).

## 1(a) [3]
Declare global integer `Jobs`, a 100 by 2 array with job number in column 0 and priority in column 1, and global `NumberOfJobs`.

## 1(b) [3]
Write `Initialise()` to set every array element to `-1` and `NumberOfJobs` to zero.

## 1(c) [5]
Write `AddJob(jobNumber, priority)` to store the job in the next free row. Output `Added` on success or `Not added` if full.

## 1(d) [2]
In the main program call `Initialise()` then `AddJob()` for these pairs, in this order: `(12,10), (526,9), (33,8), (12,9), (78,1)`.

## 1(e) [5]
Write `InsertionSort()` to order the stored jobs by ascending numerical priority, preserving each job number's association with its priority. Use insertion sort, not a built-in sort.

## 1(f) [3]
Write `PrintArray()` to output every stored job on its own line in the format `123 priority 1`.

## 1(g)(i) [1]
Call `InsertionSort()` then `PrintArray()` in the main program.

## 1(g)(ii) [1]
Retain output evidence. Saved run output replaces the screenshot, and teachers review the required algorithm and call sequence.
''',[stage('Q1_a','1(a) Global jobs storage',3),stage('Q1_b','1(b) Initialise jobs',3,'auto'),stage('Q1_c','1(c) Add jobs and full boundary',5,'auto'),stage('Q1_d','1(d) Five main insertions',2,'auto'),stage('Q1_e','1(e) Insertion sort by priority',5,'auto'),stage('Q1_f','1(f) Formatted jobs',3,'auto'),stage('Q1_gi','1(g)(i) Sorted main output',1,'auto'),stage('Q1_gii','1(g)(ii) Jobs evidence',1,'evidence')])
w42q2=q('Q2','Moving game characters','''
## 2(a) [4]
Declare class `Character` with private `Name: STRING`, `XCoordinate: INTEGER` and `YCoordinate: INTEGER`. Its constructor takes those three values. Include Python declaration comments.

## 2(b) [3]
Write getters `GetName()`, `GetX()` and `GetY()`.

## 2(c) [2]
Write `ChangePosition(XChange,YChange)` to add the two integer changes to the respective coordinates.

## 2(d) [7]
In the main program declare an array for a maximum of ten `Character` objects. Read all ten from `Characters.txt`, whose records are three lines: name, x coordinate, y coordinate. For example, Amal starts at `(0,2)`.

## 2(e) [5]
Ask for a character name, search the array and store its index. Repeat until a name exists. The original test uses lowercase `qui` to select `Qui`; perform case-insensitive matching.

## 2(f) [7]
Ask for a move letter, repeating until valid: `A` moves left (x minus 1), `W` moves up (y plus 1), `S` moves down (y minus 1), and `D` moves right (x plus 1). Use `ChangePosition()`.

## 2(g)(i) [2]
Output the selected character's name and its new coordinates, following the format `Qui has changed coordinates to X = 83 and Y = 9`. Use the actual file values: the supplied file has Qui at `(84,9)` before moving left.

## 2(g)(ii) [1]
Retain evidence using these four inputs in order: `THOMAS`, `qui`, `X`, `A`. Saved run output replaces the screenshot. The printed paper's illustrative output uses Y = 0; that is a format example, not the coordinate in the supplied file.
''',[stage('Q2_a','2(a) Private character class',4),stage('Q2_b','2(b) Character getters',3,'auto'),stage('Q2_c','2(c) Change position',2,'auto'),stage('Q2_d','2(d) Load ten characters',7,'auto'),stage('Q2_e','2(e) Find a valid name',5,'auto'),stage('Q2_f','2(f) Validate and apply movement',7,'auto'),stage('Q2_gi','2(g)(i) Coordinates message',2,'auto'),stage('Q2_gii','2(g)(ii) Movement evidence',1,'evidence')])
w42q3=q('Q3','A linear queue and recursive total','''
## 3(a) [3]
Declare global integer `Queue` with 100 places. Declare and initialise a head pointer for the first stored item and a tail pointer for the next free place. Use suitable values for an empty linear queue.

## 3(b) [6]
Write `Enqueue(value)` to store an integer at the tail and return `True` if successful or `False` when no space remains. This is a linear queue with no wraparound.

## 3(c) [4]
In the main program enqueue each integer from 1 to 20 inclusive in ascending order. Output `Successful` if all twenty additions succeeded, otherwise `Unsuccessful`.

## 3(d) [6]
Rewrite this iterative calculation as a recursive function. The original paper does not require a function name.

```text
FUNCTION IterativeOutput(Start: INTEGER) RETURNS INTEGER
    Total = 0
    FOR Count = Start - 1 TO HeadPointer STEP -1
        Total = Total + Queue[Count]
    NEXT Count
    RETURN Total
ENDFUNCTION
```

The parameter shown is an exclusive upper bound. A consistently documented last-index convention is also accepted when the main call is adjusted accordingly. Teachers check that the solution is recursive.

## 3(e)(i) [1]
Call the recursive function from the main program and output the returned total.

## 3(e)(ii) [1]
Retain output evidence. Saved run output replaces the screenshot.
''',[stage('Q3_a','3(a) Linear queue declarations',3),stage('Q3_b','3(b) Linear enqueue',6,'auto'),stage('Q3_c','3(c) Enqueue one to twenty',4,'auto'),stage('Q3_d','3(d) Recursive queue total',6,'auto'),stage('Q3_ei','3(e)(i) Output total in main',1,'auto'),stage('Q3_eii','3(e)(ii) Queue evidence',1,'evidence')])
jobvalues=[(12,10),(526,9),(33,8),(12,9),(78,1)]
jobparse="rows=[(int(a),int(b)) for a,b in re.findall(r'(?mi)^\\s*(\\d+)\\s+priority\\s+(\\d+)\\s*$',text)]\n"
charlines=CAT['9618_w22_42']['files']['sf']['textFiles']['Characters.txt'].splitlines()
chardata=[(charlines[i],int(charlines[i+1]),int(charlines[i+2])) for i in range(0,30,3)]
charcheck=lambda name,x,y:"print('PASS' if re.search("+repr(r'(?is)'+name+r'\s+has changed coordinates to\s+X\s*=\s*'+str(x)+r'\s+and\s+Y\s*=\s*'+str(y)+r'\b')+",text) else 'FAIL')"
recurhelper=code('''
functions=[]
for node in tree.body:
    if isinstance(node,ast.FunctionDef) and node.name!='Enqueue' and len(node.args.args)==1:
        if any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id==node.name for n in ast.walk(node)):
            functions.append(getattr(c,node.name))
if not functions:raise ValueError('recursive function missing')
fn=functions[0]
''')
w42cases={
'Q1_b':[test('all-one-hundred-cleared',"c.Jobs=[[1,2] for _ in range(100)];c.NumberOfJobs=88;c.Initialise()\nprint('PASS' if c.NumberOfJobs==0 and len(c.Jobs)==100 and all(row==[-1,-1] for row in c.Jobs) else 'FAIL')"),test('reinitialise-used-jobs',"c.Initialise()\nwith contextlib.redirect_stdout(io.StringIO()):c.AddJob(7,4)\nc.Initialise()\nprint('PASS' if c.NumberOfJobs==0 and all(row==[-1,-1] for row in c.Jobs) else 'FAIL')",public=False)],
'Q1_c':[test('first-and-second-job',"c.Initialise();c.AddJob(12,10);c.AddJob(78,1);print(c.NumberOfJobs);print(c.Jobs[:2])",'Added Added 2\n[[12, 10], [78, 1]]\n'),test('capacity-and-refusal',"c.Initialise();c.Jobs[:99]=[[i+1,i%10+1] for i in range(99)];c.NumberOfJobs=99;c.AddJob(999,3);before=[r[:] for r in c.Jobs];c.AddJob(1,1);print(c.NumberOfJobs);print('PASS' if c.Jobs==before and c.Jobs[99]==[999,3] else 'FAIL')",'Added Not added 100 PASS\n',False)],
'Q1_d':[mt('five-original-jobs',f"print('PASS' if ns.get('NumberOfJobs')==5 and sorted(map(tuple,ns.get('Jobs',[])[:5]))==sorted({jobvalues!r}) and text.splitlines()[:5]==['Added']*5 else 'FAIL')",[])],
'Q1_e':[test('original-priorities',f"c.Jobs=[list(x) for x in {jobvalues!r}]+[[-1,-1] for _ in range(95)];c.NumberOfJobs=5;c.InsertionSort()\nprint('PASS' if [r[1] for r in c.Jobs[:5]]==[1,8,9,9,10] and sorted(map(tuple,c.Jobs[:5]))==sorted({jobvalues!r}) else 'FAIL')"),test('empty-single-and-reverse',"c.Initialise();c.InsertionSort();c.Jobs[:4]=[[4,10],[3,7],[2,4],[1,1]];c.NumberOfJobs=4;c.InsertionSort();print(c.Jobs[:4])",'[[1, 1], [2, 4], [3, 7], [4, 10]]\n',False)],
'Q1_f':[test('two-formatted-jobs',"c.Initialise();c.Jobs[:2]=[[123,1],[39,3]];c.NumberOfJobs=2;c.PrintArray()",'123 priority 1\n39 priority 3\n'),test('empty-array-no-rows',"c.Initialise();c.PrintArray()",'',False)],
'Q1_gi':[mt('sorted-main-job-output',jobparse+f"print('PASS' if sorted(rows)==sorted({jobvalues!r}) and [p for n,p in rows]==[1,8,9,9,10] else 'FAIL')",[])],
'Q2_b':[test('get-name-and-coordinates',"x=c.Character('Amal',0,2);print(x.GetName(),x.GetX(),x.GetY())",'Amal 0 2\n'),test('negative-coordinates',"x=c.Character('Z',-7,12);print(x.GetName(),x.GetX(),x.GetY())",'Z -7 12\n',False)],
'Q2_c':[test('independent-coordinate-changes',"x=c.Character('Amal',0,2);x.ChangePosition(-1,3);print(x.GetX(),x.GetY());x.ChangePosition(4,-8);print(x.GetX(),x.GetY())",'-1 5 3 -3\n'),test('zero-change',"x=c.Character('X',2,-5);x.ChangePosition(0,0);print(x.GetX(),x.GetY())",'2 -5\n',False)],
'Q2_d':[mt('all-ten-file-characters',f"arrays=[a for a in ns.values() if isinstance(a,list) and len(a)==10 and all(hasattr(x,'GetName') for x in a)]\nexpected={[(n,x-1 if n=='Amal' else x,y) for n,x,y in chardata]!r}\nprint('PASS' if any([(x.GetName(),x.GetX(),x.GetY()) for x in a]==expected for a in arrays) else 'FAIL')",['Amal','A']),mt('last-character-loaded',charcheck('Qui',85,9),['qui','D'],False)],
'Q2_e':[mt('original-invalid-name-then-qui',charcheck('Qui',83,9),['THOMAS','qui','X','A']),mt('repeated-missing-name-and-uppercase',charcheck('Amal',0,3),['absent','nobody','AMAL','W'],False)],
'Q2_f':[mt('move-left-after-invalid-letter',charcheck('Qui',83,9),['qui','X','A']),mt('move-up',charcheck('Qui',84,10),['Qui','W'],False),mt('move-down',charcheck('Qui',84,8),['Qui','S'],False),mt('move-right',charcheck('Qui',85,9),['Qui','D'],False)],
'Q2_gi':[mt('specified-coordinate-format',charcheck('Qui',83,9),['THOMAS','qui','X','A']),mt('different-character-coordinate-format',charcheck('Karl',50,23),['Karl','S'],False)],
'Q3_b':[test('linear-capacity',"c.Queue=[0]*100;c.HeadPointer=0;c.TailPointer=0\nr=[c.Enqueue(i) for i in range(1,102)]\nprint('PASS' if r==[True]*100+[False] and c.TailPointer==100 and c.Queue==list(range(1,101)) else 'FAIL')"),test('last-slot-and-no-wrap',"c.Queue=[0]*100;c.HeadPointer=20;c.TailPointer=99\nprint(c.Enqueue(-7),c.Enqueue(3),c.TailPointer,c.Queue[99],c.Queue[0])",'True False 100 -7 0\n',False)],
'Q3_c':[mt('one-to-twenty-success',"a=ns.get('Queue',[])\nprint('PASS' if a[:20]==list(range(1,21)) and ns.get('TailPointer')==20 and text.split()[0]=='Successful' else 'FAIL')",[])],
'Q3_d':[test('recursive-total-original',recurhelper+"c.Queue=list(range(1,21))+[0]*80;c.HeadPointer=0;c.TailPointer=20\nprint('PASS' if fn(20)==210 or fn(19)==210 else 'FAIL')"),test('recursive-total-nonzero-head',recurhelper+"c.Queue=[999,999,4,-2,8,3]+[0]*94;c.HeadPointer=2;c.TailPointer=6\nprint('PASS' if fn(6)==13 or fn(5)==13 else 'FAIL')",public=False)],
'Q3_ei':[mt('main-total-two-hundred-ten',"print('PASS' if text.split()==['Successful','210'] else 'FAIL')",[])]}
pack(['9618_w22_42'],[w42q1,w42q2,w42q3],w42cases,dict(Q1=w42r1,Q2=w42r2,Q3=w42r3),1)

(ROOT/'coverage.md').write_text('''# 2022 source and assessment coverage\n\nSix supplied papers are included as four substantive task sets. Normalised QP body comparison verified s22 41/43 identical and w22 41/43 identical; printer/header differences are immaterial. Their respective HighScore.txt and IntegerData.txt bytes also match. Every manifest embeds its own supplied source text unchanged. s22 42 and w22 42 are distinct.\n\n|Set|Question|Original subparts: marks / mode (A automatic, M manual, E evidence)|\n|---|---|---|\n|s22 41/43|Q1|a 2M, b 6A, c 3A, d(i) 2A, d(ii) 1E, e(i) 3M, e(ii) 5M, e(iii) 2A, e(iv) 1E, f 4A|\n|s22 41/43|Q2|a 5M, b 2A, c 2A, d 2A, e 3M, f 8A, g(i) 2A, g(ii) 1E|\n|s22 41/43|Q3|a 2M, b 7A, c 6A, d(i) 5M, d(ii) 1E|\n|s22 42|Q1|a 3M, b 3M, c 6A, d(i) 5M, d(ii) 1E, e(i) 5A, e(ii) 2E|\n|s22 42|Q2|a 4M, b(i) 5A, b(ii) 3A, b(iii) 1E, c(i) 8A, c(ii) 2E|\n|s22 42|Q3|a 5M, b 3A, c 7A, d 6A, e(i) 5A, e(ii) 1E|\n|w22 41/43|Q1|a 2M, b 6A, c 7A, d(i) 3M, d(ii) 1E, e 4A|\n|w22 41/43|Q2|a(i) 5M, a(ii) 3A, a(iii) 2M, b(i) 6M, b(ii) 2A, b(iii) 2M, c(i) 6A, c(ii) 4M, c(iii) 1E|\n|w22 41/43|Q3|a 3M, b 2M, c 5A, d 7A, e(i) 3A, e(ii) 1E|\n|w22 42|Q1|a 3M, b 3A, c 5A, d 2A, e 5A, f 3A, g(i) 1A, g(ii) 1E|\n|w22 42|Q2|a 4M, b 3A, c 2A, d 7A, e 5A, f 7A, g(i) 2A, g(ii) 1E|\n|w22 42|Q3|a 3M, b 6A, c 4A, d 6A, e(i) 1A, e(ii) 1E|\n\nEvery paper totals 75. Stage IDs preserve the original subpart identity. Every automatic stage has a real output/state/file oracle. Public representative tests are accompanied by useful hidden boundary, alternate-input or alternate-file tests. Source-structure marks (private attributes, comments, required sorts, recursion, procedure calls) remain teacher-reviewed even for automatic stages. Appropriate-message branches with no prescribed wording, unnamed user procedures and evidence are not replaced with canned PASS programs. Original screenshot tasks use saved-run evidence.\n\nSource clarifications are explicit in student text:\n- s22 41/43 Q1 OutputHighScores visits all eleven array entries, as confirmed visually on mark-scheme page 7; the new file contains only the top ten. File checks allow an optional terminal newline.\n- s22 42 QP page 6 was rendered and visually inspected: the printed midpoint `(Lower + (Upper - 1)) DIV ...` can fail to terminate at inclusive single-element intervals. The classroom adaptation specifies correct inclusive bounds and an in-range midpoint; its reference uses `(Lower + Upper)//2`. Hidden tests cover the last index, one element and an empty interval. This is an identified source correction, not a silent change.\n- s22 42 ChooseCard accepts user indices 1..30; the driver accepts a consistent one-based or zero-based return by checking selected actual cards in the completed program.\n- w22 41/43 Q1 does not state the sorting direction. Both monotone numerical directions are accepted; the reference follows the ascending mark-scheme example.\n- w22 42 QP example says Qui Y=0, but supplied Characters.txt says Qui=(84,9). The adapted statement retains the output format and uses actual post-left-move coordinates (83,9).\n- w22 42 Q3 pseudocode uses an exclusive Start; mark-scheme RecursiveOutput instead takes the final occupied index. Both consistent conventions are accepted, including a nonzero-head boundary case.\n\nNo required source text files are missing. The capacity/domain audit keeps high-score files at ten records, card files at thirty valid numbered/coloured cards, integer files at one hundred values in 1..100, character files at ten records, binary-search arrays at ten by ten, and near-full job queues with ninety-nine real occupied rows. Empty ADT operations and deliberately invalid user inputs are tested only where the original contract requires them. Images/PDFs and evidence.doc are not imported as runtime files. NewHighScore.txt is declared as a collected output; source data files are kept in initialFiles.\n\nAuthoring verification parses all JSON, Python references and drivers and checks marks and case limits without executing student/reference programs on the host. Declaration loading retains safe array-initializer loops, preserves future annotations, and supports dataclass records without running input-driven main routines. Central isolated reference/mutation validation is a separate current-implementation step and must be reported independently.\n''')
print('Built six 2022 manifests; no candidate/reference code executed.')
