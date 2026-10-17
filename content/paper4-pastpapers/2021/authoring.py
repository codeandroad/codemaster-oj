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
def pack(keys,questions,cases,refs):
 for key in keys:
  r=CAT[key];qs=json.loads(json.dumps(questions));files=r['files'].get('sf',{}).get('textFiles',{})
  if key[5]=='s':qs[2]['initialFiles']=files
  else:qs[1]['initialFiles']=files
  m=dict(format='codemaster-paper4',version=1,paper=dict(title=f"9618 Paper 4 · {r['season']} {r['year']} · Paper {r['variant']}",description='Classroom Python adaptation of the supplied question paper, mark scheme and candidate text files. Original subpart marks are retained; automatic checks do not replace teacher marking.',examYear=r['year'],examSession='summer' if key[5]=='s' else 'autumn',examVariant=int(r['variant'])),questions=qs,runnerCases=cases,referenceSolutions=refs)
  assert sum(s['maxMarks'] for x in qs for s in x['stages'])==75
  assert sum(map(len,cases.values()))<=50
  for ref in refs.values():ast.parse(ref)
  for cs in cases.values():
   for ca in cs:ast.parse(ca['driverCode'])
  ROOT.mkdir(parents=True,exist_ok=True);(ROOT/(key+'.json')).write_text(json.dumps(m,indent=2,ensure_ascii=False)+'\n')

sref1=code('''
class node:
    def __init__(self, data, nextNode):
        self.data = data       # INTEGER
        self.nextNode = nextNode  # INTEGER

linkedList = [node(1,1),node(5,4),node(6,7),node(7,-1),node(2,2),node(0,6),node(0,8),node(56,3),node(0,9),node(0,-1)]
startPointer = 0
emptyList = 5

def outputNodes(linkedList, startPointer):
    current = startPointer
    while current != -1:
        print(linkedList[current].data)
        current = linkedList[current].nextNode

def addNode(linkedList, startPointer, emptyList):
    global emptyListPointer
    if emptyList == -1:
        return False
    value = int(input('Enter data: '))
    newNode = emptyList
    emptyListPointer = linkedList[newNode].nextNode
    globals()['emptyList'] = emptyListPointer
    linkedList[newNode].data = value
    linkedList[newNode].nextNode = -1
    if startPointer == -1:
        return False  # Original main program begins with a non-empty linked list.
    current = startPointer
    while linkedList[current].nextNode != -1:
        current = linkedList[current].nextNode
    linkedList[current].nextNode = newNode
    return True

if __name__ == '__main__':
    outputNodes(linkedList, startPointer)
    success = addNode(linkedList, startPointer, emptyList)
    if success:
        emptyList = emptyListPointer
    print('Added successfully' if success else 'List full')
    outputNodes(linkedList, startPointer)
''')
# Return-value function requirement uses global pointer updates because Python integers are immutable.
sref1=sref1.replace('global emptyListPointer','global emptyListPointer\n    global startPointerUpdated').replace("if startPointer == -1:\n        return False  # Original main program begins with a non-empty linked list.","if startPointer == -1:\n        startPointerUpdated = newNode\n        return True")
sref2=code('''
arrayData = [10,5,6,7,1,12,13,15,21,8] # ARRAY[0:9] OF INTEGER

def linearSearch(value):
    for item in arrayData:
        if item == value:
            return True
    return False

def bubbleSort():
    for x in range(len(arrayData)-1):
        for y in range(len(arrayData)-1-x):
            if arrayData[y] < arrayData[y+1]:
                arrayData[y],arrayData[y+1] = arrayData[y+1],arrayData[y]

if __name__ == '__main__':
    value=int(input('Enter search value: '))
    print('Found' if linearSearch(value) else 'Not found')
    bubbleSort()
''')
sref3=code('''
class TreasureChest:
    def __init__(self, question, answer, points):
        self.__question = question # STRING
        self.__answer = answer     # INTEGER
        self.__points = points     # INTEGER
    def getQuestion(self):
        return self.__question
    def checkAnswer(self, answer):
        return answer == self.__answer
    def getPoints(self, attempts):
        if attempts == 1: return self.__points
        if attempts == 2: return self.__points // 2
        if attempts in (3,4): return self.__points // 4
        return 0

arrayTreasure=[]
def readData():
    global arrayTreasure
    arrayTreasure=[] # ARRAY OF TreasureChest
    try:
        with open('TreasureChestData.txt') as f:
            question=f.readline().strip()
            while question != '':
                answer=int(f.readline());points=int(f.readline())
                arrayTreasure.append(TreasureChest(question,answer,points))
                question=f.readline().strip()
    except OSError:
        print('TreasureChestData.txt not found')

if __name__ == '__main__':
    readData()
    choice=int(input('Enter a question number 1 to 5: '))
    chest=arrayTreasure[choice-1]
    attempts=0
    while True:
        print(chest.getQuestion())
        answer=int(input('Answer: '));attempts+=1
        if chest.checkAnswer(answer):break
    print(chest.getPoints(attempts))
''')
sref1=sref1.replace('startPointerUpdated = newNode\n        return True', "startPointerUpdated = newNode\n        globals()['startPointer'] = newNode\n        return True")
sq1=q('Q1','An array-based linked list','''
An unordered linked list uses records of type `node`, with integer fields `data` and `nextNode`. `-1` is a null pointer. Initially `startPointer = 0` and `emptyList = 5`.

| Index | data | nextNode |
|---|---|---|
|0|1|1|
|1|5|4|
|2|6|7|
|3|7|-1|
|4|2|2|
|5|0|6|
|6|0|8|
|7|56|3|
|8|0|9|
|9|0|-1|

## 1(a) [2]
Declare the record type `node`.

## 1(b) [4]
Declare `linkedList`, a 1D array of `node`, initialise it using the table, and declare the two pointers.

## 1(c)(i) [6]
Write `outputNodes(linkedList, startPointer)`. Follow `nextNode` from the start pointer and output each node's data until the null pointer.

## 1(c)(ii) [1]
Call `outputNodes()` in the main program and retain the run output as evidence.

## 1(d)(i) [7]
Write `addNode()` taking the linked list and the two pointers as parameters. Read an integer from the user, allocate the next free node, append it to the linked list, and update the pointers. Return `True` on success, or `False` when no free nodes remain. In Python, arrange for changes to integer pointers to remain available to the main program.

## 1(d)(ii) [3]
In the main program call `outputNodes()` before insertion, call `addNode()`, output an appropriate message for its Boolean result, then call `outputNodes()` again.

## 1(d)(iii) [1]
Test with the data value `5`; retain the input and output for teacher review. Saved run output replaces the original screenshot evidence.
''',[stage('Q1_a','1(a) Record',2),stage('Q1_b','1(b) Initial list and pointers',4),stage('Q1_ci','1(c)(i) Linked traversal',6,'auto'),stage('Q1_cii','1(c)(ii) Traversal evidence',1,'evidence'),stage('Q1_di','1(d)(i) Append node',7,'auto'),stage('Q1_dii','1(d)(ii) Main program',3,'auto'),stage('Q1_diii','1(d)(iii) Insertion evidence',1,'evidence')])
sq2=q('Q2','Linear search and descending bubble sort','''
A program stores the integers `10 5 6 7 1 12 13 15 21 8` in `arrayData`.

## 2(a) [2]
Declare a global 1D integer array `arrayData` with ten elements and initialise it in the main program with these values.

## 2(b)(i) [6]
Write `linearSearch(value)`. Perform a linear search on `arrayData`; return `True` when the integer parameter occurs and `False` otherwise.

## 2(b)(ii) [4]
Read an integer in the main program, pass it to `linearSearch()`, and output an appropriate message saying whether it was found.

## 2(b)(iii) [2]
Test once with a value present and once with a value absent. Retain both run outputs for teacher review.

## 2(c) [6]
Write `bubbleSort()` to sort `arrayData` in descending numerical order using adjacent comparisons and swaps in nested loops. Complete the descending bubble-sort algorithm; teacher review checks the required sorting method as well as its result.
''',[stage('Q2_a','2(a) Global array',2),stage('Q2_bi','2(b)(i) Linear search',6,'auto'),stage('Q2_bii','2(b)(ii) User search',4,'manual','Teacher checks the user input, function call and truthful found/not-found messages without imposing an exact message wording.'),stage('Q2_biii','2(b)(iii) Both search outcomes',2,'evidence'),stage('Q2_c','2(c) Descending bubble sort',6,'auto')])
sq3=q('Q3','Treasure chests','''
A treasure chest contains a mathematics question. Award points according to the number of attempts needed to answer it.

## 3(a) [5]
Declare class `TreasureChest`. Its private attributes are `question: STRING`, `answer: INTEGER`, and `points: INTEGER`. The constructor takes these three values and initialises the attributes. Include attribute declaration comments in Python.

## 3(b) [8]
Write `readData()` to read the supplied `TreasureChestData.txt`. Each three lines are question, answer, points. Create one `TreasureChest` per record and append it to an array named `arrayTreasure`. Use exception handling to output a suitable message if the file cannot be found. The supplied file contains five chests.

## 3(c)(i) [1]
Write `getQuestion()` to return the question.

## 3(c)(ii) [3]
Write `checkAnswer(answer)` to return `True` for the correct integer answer, otherwise `False`.

## 3(c)(iii) [5]
Write `getPoints(attempts)`. Return all points for one attempt, integer division by 2 for two attempts, integer division by 4 for three or four attempts, and zero for every other number of attempts.

## 3(c)(iv) [7]
Call `readData()`. Ask for a question number from 1 to 5 and output the selected question. Repeatedly ask for an answer and check it using `checkAnswer()` until correct. Count attempts, call `getPoints()`, and output the awarded points.

## 3(c)(v) [2]
Retain evidence for question 1 answered correctly first time and question 5 answered correctly second time. Saved run output replaces the screenshot requirement.
''',[stage('Q3_a','3(a) Private class and constructor',5),stage('Q3_b','3(b) Read chest data',8,'auto'),stage('Q3_ci','3(c)(i) Question getter',1,'auto'),stage('Q3_cii','3(c)(ii) Answer check',3,'auto'),stage('Q3_ciii','3(c)(iii) Awarded points',5,'auto'),stage('Q3_civ','3(c)(iv) Play selected question',7,'auto'),stage('Q3_cv','3(c)(v) Play evidence',2,'evidence')])
scases={
'Q1_ci':[test('table-traversal',"o=io.StringIO()\nwith contextlib.redirect_stdout(o):c.outputNodes(c.linkedList,0)\nprint('PASS' if list(map(int,re.findall(r'[-+]?\\d+',o.getvalue())))==[1,5,2,6,56,7] else 'FAIL')"),test('null-and-alternate-start',"o=io.StringIO()\nwith contextlib.redirect_stdout(o):c.outputNodes(c.linkedList,-1);c.outputNodes(c.linkedList,7)\nprint('PASS' if list(map(int,re.findall(r'[-+]?\\d+',o.getvalue())))==[56,7] else 'FAIL')",public=False)],
'Q1_di':[test('append-five',"builtins.input=lambda prompt='':'5'\nwith contextlib.redirect_stdout(io.StringIO()):r=c.addNode(c.linkedList,0,5)\nif isinstance(r,tuple): r=next((v for v in r if isinstance(v,bool)),None)\nprint('PASS' if r is True and c.linkedList[3].nextNode==5 and c.linkedList[5].data==5 and c.linkedList[5].nextNode==-1 else 'FAIL')"),test('no-free-node',"before=[(x.data,x.nextNode) for x in c.linkedList]\nbuiltins.input=lambda prompt='':'999'\nwith contextlib.redirect_stdout(io.StringIO()):r=c.addNode(c.linkedList,0,-1)\nif isinstance(r,tuple):r=next((v for v in r if isinstance(v,bool)),None)\nprint('PASS' if r is False and before==[(x.data,x.nextNode) for x in c.linkedList] else 'FAIL')",public=False)],
'Q1_dii':[mt('before-and-after-five',"nums=[int(n) for n in re.findall(r'(?<![A-Za-z])[-+]?\\d+',text)]\nprint('PASS' if nums==[1,5,2,6,56,7,1,5,2,6,56,7,5] and re.search('[A-Za-z]',text) else 'FAIL')",[5]),mt('before-and-after-negative',"nums=[int(n) for n in re.findall(r'(?<![A-Za-z])[-+]?\\d+',text)]\nprint('PASS' if nums==[1,5,2,6,56,7,1,5,2,6,56,7,-12] else 'FAIL')",[-12],False)],
'Q2_bi':[test('present-and-missing',"c.arrayData=[10,5,6,7,1,12,13,15,21,8]\nprint(c.linearSearch(10),c.linearSearch(8),c.linearSearch(99))",'True True False\n'),test('boundary-and-duplicates',"c.arrayData=[-5,0,0,9,3,6,1,2,7,42]\nprint(c.linearSearch(-5),c.linearSearch(42),c.linearSearch(0),c.linearSearch(5))",'True True True False\n',False)],
'Q2_c':[test('original-descending',"c.arrayData=[10,5,6,7,1,12,13,15,21,8]\nc.bubbleSort()\nprint(*c.arrayData)",'21 15 13 12 10 8 7 6 5 1\n'),test('negative-and-equal',"c.arrayData=[0,-3,7,7,1,-9,2,0,8,4]\nc.bubbleSort()\nprint(*c.arrayData)",'8 7 7 4 2 1 0 0 -3 -9\n',False)],
'Q3_b':[test('five-original-records',"r=c.readData();a=r if isinstance(r,list) else c.arrayTreasure\nprint(len(a))\nprint(a[0].getQuestion(),a[4].getQuestion())\nprint(a[0].checkAnswer(4),a[4].checkAnswer(7000))",'5\n2*2 3000+4000\nTrue True\n'),test('different-records',"r=c.readData();a=r if isinstance(r,list) else c.arrayTreasure\nprint(len(a))\nprint(a[0].getQuestion(),a[0].checkAnswer(-7),a[0].getPoints(2))",'5\n3-10 True 5\n',False,files={'TreasureChestData.txt':'3-10\n-7\n11\n2+2\n4\n10\n5*5\n25\n15\n1-1\n0\n3\n7+8\n15\n21\n'}),test('missing-data-file',"import os\nos.remove('TreasureChestData.txt')\no=io.StringIO()\nwith contextlib.redirect_stdout(o):c.readData()\nprint('PASS' if o.getvalue().strip() else 'FAIL')",public=False)],
'Q3_ci':[test('question-text',"print(c.TreasureChest('7*8',56,11).getQuestion())",'7*8\n'),test('other-question',"print(c.TreasureChest('12-15',-3,7).getQuestion())",'12-15\n',False)],
'Q3_cii':[test('answer-match',"x=c.TreasureChest('7*8',56,11)\nprint(x.checkAnswer(56),x.checkAnswer(55))",'True False\n'),test('negative-answer',"x=c.TreasureChest('12-15',-3,7)\nprint(x.checkAnswer(-3),x.checkAnswer(3))",'True False\n',False)],
'Q3_ciii':[test('attempt-categories',"x=c.TreasureChest('7*8',56,100)\nprint(*[x.getPoints(n) for n in range(1,6)])",'100 50 25 25 0\n'),test('integer-division-and-other-attempts',"x=c.TreasureChest('x',0,11)\nprint(*[x.getPoints(n) for n in [0,1,2,3,4,5,10]])",'0 11 5 2 2 0 0\n',False)],
'Q3_civ':[mt('question-one-first-attempt',"print('PASS' if '2*2' in text and re.findall(r'[-+]?\\d+',text)[-1]=='10' else 'FAIL')",[1,4]),mt('question-five-second-attempt',"print('PASS' if '3000+4000' in text and re.findall(r'[-+]?\\d+',text)[-1]=='9' else 'FAIL')",[5,0,7000],False),mt('question-four-five-attempts',"print('PASS' if '125/25' in text and re.findall(r'[-+]?\\d+',text)[-1]=='0' else 'FAIL')",[4,1,2,3,4,5],False)]}

# Main-program messages are deliberately not restricted to fixed wording or number-free text.
for case,value in zip(scases['Q1_dii'],[5,-12]):
    expected=[1,5,2,6,56,7,1,5,2,6,56,7,value]
    body="nums=list(map(int,re.findall(r'[-+]?\\d+',text)))\nit=iter(nums)\nok=all(any(n==want for n in it) for want in "+repr(expected)+")\n"
    body+="a=ns.get('linkedList',[]);ptr=ns.get('startPointer',-1);actual=[]\nfor _ in range(11):\n    if ptr==-1:break\n    actual.append(a[ptr].data);ptr=a[ptr].nextNode\n"
    body+="print('PASS' if ok and ptr==-1 and actual=="+repr([1,5,2,6,56,7,value])+" else 'FAIL')"
    case['driverCode']=main(body,[value])

pack(['9618_s21_41','9618_s21_42','9618_s21_43'],[sq1,sq2,sq3],scases,dict(Q1=sref1,Q2=sref2,Q3=sref3))

wref1=code('''
def Unknown(X,Y):
    if X<Y:
        print(X+Y)
        return Unknown(X+1,Y)*2
    if X==Y:return 1
    print(X+Y)
    return Unknown(X-1,Y)//2

def IterativeUnknown(X,Y):
    result=1
    if X<Y:
        while X<Y:
            print(X+Y);result*=2;X+=1
    else:
        while X>Y:
            print(X+Y);result//=2;X-=1
    return result

if __name__=='__main__':
    for function in (Unknown,IterativeUnknown):
        for X,Y in ((10,15),(10,10),(15,10)):
            print(X,Y)
            print(function(X,Y))
''')
wref2=code('''
class Picture:
    def __init__(self, description, frameColour, height, width):
        self.__Description=description # STRING
        self.__FrameColour=frameColour # STRING
        self.__Height=height # INTEGER
        self.__Width=width # INTEGER
    def GetDescription(self):return self.__Description
    def GetHeight(self):return self.__Height
    def GetWidth(self):return self.__Width
    def GetColour(self):return self.__FrameColour
    def SetDescription(self,description):self.__Description=description

PictureArray=[None]*100 # ARRAY[0:99] OF Picture

def ReadData(PictureArray):
    count=0
    try:
        with open('Pictures.txt') as f:
            description=f.readline().strip()
            while description!='':
                width=int(f.readline());height=int(f.readline());colour=f.readline().strip()
                PictureArray[count]=Picture(description,colour,height,width)
                count+=1;description=f.readline().strip()
    except OSError:
        print('Pictures.txt not found')
    return count,PictureArray

if __name__=='__main__':
    count,PictureArray=ReadData(PictureArray)
    colour=input('Frame colour: ').lower()
    width=int(input('Maximum width: '));height=int(input('Maximum height: '))
    for picture in PictureArray[:count]:
        if picture.GetColour().lower()==colour and picture.GetWidth()<=width and picture.GetHeight()<=height:
            print(picture.GetDescription(),picture.GetWidth(),picture.GetHeight())
''')
wref3=code('''
ArrayNodes=[[-1,0,-1] for _ in range(20)] # ARRAY[0:19,0:2] OF INTEGER
RootPointer=-1 # INTEGER
FreeNode=0 # INTEGER

def AddNode(ArrayNodes,RootPointer,FreeNode):
    data=int(input('Enter the data: '))
    if FreeNode>19:
        print('Tree is full')
        return ArrayNodes,RootPointer,FreeNode
    ArrayNodes[FreeNode]=[-1,data,-1]
    if RootPointer==-1:RootPointer=FreeNode
    else:
        current=RootPointer
        while True:
            side=0 if data<ArrayNodes[current][1] else 2
            if ArrayNodes[current][side]==-1:
                ArrayNodes[current][side]=FreeNode;break
            current=ArrayNodes[current][side]
    return ArrayNodes,RootPointer,FreeNode+1

def PrintAll(ArrayNodes):
    for row in ArrayNodes:print(*row)

def InOrder(ArrayNodes,RootNode):
    if RootNode!=-1:
        InOrder(ArrayNodes,ArrayNodes[RootNode][0])
        print(ArrayNodes[RootNode][1])
        InOrder(ArrayNodes,ArrayNodes[RootNode][2])

if __name__=='__main__':
    for _ in range(10):ArrayNodes,RootPointer,FreeNode=AddNode(ArrayNodes,RootPointer,FreeNode)
    PrintAll(ArrayNodes)
    InOrder(ArrayNodes,RootPointer)
''')
wq1=q('Q1','Recursive and iterative Unknown','''
## 1(a) [3]
Implement recursive `Unknown(X, Y)` using this algorithm:

```text
IF X < Y:
    OUTPUT X + Y
    RETURN Unknown(X + 1, Y) * 2
ELSE IF X = Y:
    RETURN 1
ELSE:
    OUTPUT X + Y
    RETURN Unknown(X - 1, Y) DIV 2
```
`DIV` means integer division.

## 1(b)(i) [3]
For `Unknown(10,15)`, `Unknown(10,10)` and `Unknown(15,10)`, output both parameter values, call the function, and output the return value.

## 1(b)(ii) [2]
Retain run evidence for these three calls.

## 1(c) [7]
Rewrite the same function as the iterative function `IterativeUnknown(X,Y)`. Preserve its intermediate output and return value. Teacher review checks that this function is iterative.

## 1(d)(i) [1]
Extend the main program to call `IterativeUnknown()` with the same three pairs, again outputting the two parameters and returned value for each call.

## 1(d)(ii) [1]
Retain output evidence from both functions for each parameter pair. Saved run output replaces the original screenshots.
''',[stage('Q1_a','1(a) Recursive function',3,'auto'),stage('Q1_bi','1(b)(i) Recursive main calls',3,'auto'),stage('Q1_bii','1(b)(ii) Recursive evidence',2,'evidence'),stage('Q1_c','1(c) Iterative function',7,'auto'),stage('Q1_di','1(d)(i) Iterative main calls',1,'auto'),stage('Q1_dii','1(d)(ii) Combined evidence',1,'evidence')])
wq2=q('Q2','Picture objects and file search','''
A `Picture` stores a private description (STRING), width (INTEGER), height (INTEGER) and frame colour (STRING).

## 2(a) [5]
Declare class `Picture` and its constructor. The question paper lists constructor parameters in the order description, frame colour, height, width. Assign all four private attributes; add declaration comments in Python.

## 2(b) [3]
Write `GetDescription()`, `GetHeight()`, `GetWidth()` and `GetColour()` to return the associated attributes.

## 2(c) [2]
Write `SetDescription(newDescription)` to replace the description.

## 2(d) [1]
Declare an array of 100 `Picture` objects, accessible to the main program and file reader.

## 2(e) [8]
Write `ReadData()` to open `Pictures.txt`. Each four lines contain description, width, height, frame colour. Read to the end, create and store each `Picture` in the array, and count and return the number of pictures. Include appropriate exception handling if the file cannot be found. A Python array may be passed as a parameter, or shared globally.

## 2(f) [2]
Call `ReadData()` in the main program.

## 2(g) [7]
Ask for frame colour, maximum width and maximum height. Search the loaded pictures and output the description, width and height of every picture with the requested colour and dimensions no larger than the limits. Colour matching must ignore case.

## 2(h) [2]
Retain evidence for the searches `BLACK, 100, 100` and `silver, 25, 25`. Saved run output replaces screenshots.
''',[stage('Q2_a','2(a) Private class and constructor',5),stage('Q2_b','2(b) Get methods',3,'auto'),stage('Q2_c','2(c) Set description',2,'auto'),stage('Q2_d','2(d) Picture array',1),stage('Q2_e','2(e) Read picture file',8,'auto'),stage('Q2_f','2(f) Reader call',2),stage('Q2_g','2(g) Picture search',7,'auto'),stage('Q2_h','2(h) Search evidence',2,'evidence')])
wq3=q('Q3','An ordered binary tree','''
Store an ascending binary search tree in a 20-row 2D integer array `ArrayNodes`. Each row is `[LeftPointer, Data, RightPointer]`; `-1` is null. For illustration, a tree with root 10 and children 5 and 16 uses rows `[1,10,2]`, `[-1,5,-1]`, `[-1,16,-1]`.

## 3(a) [4]
Declare `ArrayNodes` with 20 nodes, `RootPointer = -1` and `FreeNode = 0`. Include declaration comments in Python.

## 3(b) [8]
Write `AddNode(ArrayNodes, RootPointer, FreeNode)`. Read an integer. If `FreeNode <= 19`, store it in that free row with both child pointers `-1`. If the tree was empty, make the new node the root. Otherwise follow the tree, taking the left branch for a smaller value and right branch otherwise, until a null link is found; link the new row there. Increment `FreeNode`. Output `Tree is full` if no row remains. Python must return updated pointers (and optionally the array), or otherwise retain their changes for the caller.

## 3(c) [4]
Write `PrintAll()` to output all rows of `ArrayNodes` in storage order, one row per line, with left pointer, data and right pointer in that order.

## 3(d)(i) [3]
The main program calls `AddNode()` ten times, then calls `PrintAll()`.

## 3(d)(ii) [1]
Test using `10, 5, 15, 8, 12, 6, 20, 11, 9, 4` in that order and retain the output evidence.

## 3(e)(i) [7]
Write recursive `InOrder()` to visit the left subtree, output the root data, then visit the right subtree. Use it to output the tree in ascending order.

## 3(e)(ii) [1]
Retain evidence of `InOrder()` using the same data. Saved run output replaces screenshots.
''',[stage('Q3_a','3(a) Tree declarations',4),stage('Q3_b','3(b) Add node and pointers',8,'auto'),stage('Q3_c','3(c) Print stored rows',4,'auto'),stage('Q3_di','3(d)(i) Ten insertions and output',3,'auto'),stage('Q3_dii','3(d)(ii) Tree evidence',1,'evidence'),stage('Q3_ei','3(e)(i) Recursive inorder traversal',7,'auto'),stage('Q3_eii','3(e)(ii) Inorder evidence',1,'evidence')])
pichelper=code('''
def newpic(d,w,h,col):
    params=list(inspect.signature(c.Picture).parameters)
    vals=[]
    for p in params:
        p=p.lower()
        if 'desc' in p:vals.append(d)
        elif 'width' in p:vals.append(w)
        elif 'height' in p:vals.append(h)
        elif 'col' in p or 'frame' in p:vals.append(col)
        else: return c.Picture(d,col,h,w)
    return c.Picture(*vals)
''')
readpic=code('''
def readpictures():
    a=[None]*100
    if len(inspect.signature(c.ReadData).parameters): r=c.ReadData(a)
    else:r=c.ReadData()
    if isinstance(r,tuple):
        count=next(x for x in r if isinstance(x,int))
        a=next((x for x in r if isinstance(x,list)),a)
    else:
        count=r
        if not len(inspect.signature(c.ReadData).parameters):
            a=next(x for x in c.__dict__.values() if isinstance(x,list) and any(isinstance(v,c.Picture) for v in x))
    return count,a
''')
addtree=code('''
def insert(a,root,free,value):
    c.ArrayNodes=a;c.RootPointer=root;c.FreeNode=free
    builtins.input=lambda prompt='':str(value)
    with contextlib.redirect_stdout(io.StringIO()):r=c.AddNode(a,root,free)
    if isinstance(r,tuple):
        ints=[v for v in r if isinstance(v,int)]
        lists=[v for v in r if isinstance(v,list)]
        if len(ints)>=2:root,free=ints[-2:]
        if lists:a=lists[0]
    else:root,free=c.RootPointer,c.FreeNode
    return a,root,free
''')
unknown='25 26 27 28 29 32 1 25 24 23 22 21 0\n'
mainunknown=[10,15,25,26,27,28,29,32,10,10,1,15,10,25,24,23,22,21,0]
whole=mainunknown*2
wcases={
'Q1_a':[test('three-original-calls',"print(c.Unknown(10,15));print(c.Unknown(10,10));print(c.Unknown(15,10))",unknown),test('equal-and-one-step',"print(c.Unknown(3,3));print(c.Unknown(2,3));print(c.Unknown(4,3))",'1 5 2 7 0\n',False)],
'Q1_bi':[mt('original-recursive-main',f"nums=list(map(int,re.findall(r'[-+]?\\d+',text)))\nexpected={mainunknown!r}\nprint('PASS' if nums[:len(expected)]==expected else 'FAIL')",[])],
'Q1_c':[test('three-original-iterative-calls',"print(c.IterativeUnknown(10,15));print(c.IterativeUnknown(10,10));print(c.IterativeUnknown(15,10))",unknown),test('iterative-boundaries',"print(c.IterativeUnknown(3,3));print(c.IterativeUnknown(-2,1));print(c.IterativeUnknown(4,3))",'1 -1 0 1 8 7 0\n',False)],
'Q1_di':[mt('both-main-functions',f"nums=list(map(int,re.findall(r'[-+]?\\d+',text)))\nprint('PASS' if nums=={whole!r} else 'FAIL')",[])],
'Q2_b':[test('four-getters',pichelper+"x=newpic('Flowers',45,50,'black')\nprint(x.GetDescription(),x.GetWidth(),x.GetHeight(),x.GetColour())",'Flowers 45 50 black\n'),test('asymmetric-dimensions',pichelper+"x=newpic('Night sky',1,99,'Silver')\nprint(x.GetDescription(),x.GetWidth(),x.GetHeight(),x.GetColour())",'Night sky 1 99 Silver\n',False)],
'Q2_c':[test('replace-description',pichelper+"x=newpic('Old',3,8,'red');x.SetDescription('New view')\nprint(x.GetDescription(),x.GetWidth(),x.GetHeight(),x.GetColour())",'New view 3 8 red\n'),test('empty-description',pichelper+"x=newpic('Old',3,8,'red');x.SetDescription('')\nprint(repr(x.GetDescription()))","''\n",False)],
'Q2_e':[test('single-record',readpic+"n,a=readpictures()\nprint(n,a[0].GetDescription().lower(),a[0].GetWidth(),a[0].GetHeight(),a[0].GetColour().lower())",'1 flowers 45 50 black\n',files={'Pictures.txt':'Flowers\n45\n50\nblack\n'}),test('two-records-and-eof',readpic+"n,a=readpictures()\nprint(n)\nprint(a[1].GetDescription().lower(),a[1].GetWidth(),a[1].GetHeight(),a[1].GetColour().lower())",'2\nsecond 2 13 silver\n',False,files={'Pictures.txt':'First\n5\n7\nred\nSecond\n2\n13\nsilver\n'}),test('missing-picture-file',readpic+"import os\nos.remove('Pictures.txt')\no=io.StringIO()\nwith contextlib.redirect_stdout(o):\n    try:readpictures()\n    except OSError:print('missing')\nprint('PASS' if o.getvalue().strip() else 'FAIL')",public=False)],
'Q2_g':[mt('case-and-inclusive-limits',"words=text.lower().split()\nprint('PASS' if words==['edge','25','30','inside','10','10'] else 'FAIL')",['SILVER',25,30],files={'Pictures.txt':'Edge\n25\n30\nsilver\nTooWide\n26\n30\nsilver\nInside\n10\n10\nSilver\nWrongColour\n1\n1\nblack\n'}),mt('height-and-no-match',"print('PASS' if 'excludedtallrecord' not in text.lower() and 'excludedcolourrecord' not in text.lower() else 'FAIL')",['black',100,10],False,files={'Pictures.txt':'ExcludedTallRecord\n2\n11\nblack\nExcludedColourRecord\n1\n1\nred\n'})],
'Q3_b':[test('root-left-right-and-duplicate',addtree+"a=[[-1,0,-1] for _ in range(20)];r=-1;f=0\nfor value in [10,5,15,10]:a,r,f=insert(a,r,f,value)\nprint(r,f);print(a[:4])",'0 4\n[[1, 10, 2], [-1, 5, -1], [3, 15, -1], [-1, 10, -1]]\n'),test('capacity-boundary',addtree+"a=[[-1,0,-1] for _ in range(20)];r=-1;f=0\nfor value in range(20):a,r,f=insert(a,r,f,value)\nbefore=[x[:] for x in a];a,r,f=insert(a,r,f,999)\nprint('PASS' if f==20 and r==0 and a==before else 'FAIL')",public=False)],
'Q3_c':[test('storage-order',"a=[[2,10,1],[-1,20,-1],[-1,5,-1]]+[[-1,0,-1] for _ in range(17)]\nc.ArrayNodes=a\nif len(inspect.signature(c.PrintAll).parameters):c.PrintAll(a)\nelse:c.PrintAll()",'2 10 1 -1 20 -1 -1 5 -1\n'),test('null-pointer-rows',"a=[[-1,-8,-1],[-1,0,-1]]\nc.ArrayNodes=a\nif len(inspect.signature(c.PrintAll).parameters):c.PrintAll(a)\nelse:c.PrintAll()",'-1 -8 -1 -1 0 -1\n',False)],
'Q3_di':[mt('ten-original-insertions',"a=ns.get('ArrayNodes',[])\nexpected=[[1,10,2],[9,5,3],[4,15,6],[5,8,8],[7,12,-1],[-1,6,-1],[-1,20,-1],[-1,11,-1],[-1,9,-1],[-1,4,-1]]\nnums=list(map(int,re.findall(r'[-+]?\\d+',text)))\nflat=[v for row in expected for v in row]\nprint('PASS' if a[:10]==expected and ns.get('FreeNode')==10 and nums[:30]==flat else 'FAIL')",[10,5,15,8,12,6,20,11,9,4])],
'Q3_ei':[test('inorder-not-array-order',"a=[[2,10,1],[-1,20,-1],[-1,5,-1]]+[[-1,0,-1] for _ in range(17)]\nc.ArrayNodes=a;c.RootPointer=0\nn=len(inspect.signature(c.InOrder).parameters)\nif n==2:c.InOrder(a,0)\nelif n==1:c.InOrder(0)\nelse:c.InOrder()",'5 10 20\n'),test('empty-and-single-tree',"a=[[-1,42,-1]]+[[-1,0,-1] for _ in range(19)]\nc.ArrayNodes=a;c.RootPointer=-1\nn=len(inspect.signature(c.InOrder).parameters)\nif n==2:c.InOrder(a,-1);c.InOrder(a,0)\nelif n==1:c.InOrder(-1);c.InOrder(0)\nelse:\n    c.InOrder();c.RootPointer=0;c.InOrder()",'42\n',False)]}

# PrintAll may include harmless textual headings; the original numeric field order is still checked.
for case,rows,expected in zip(wcases['Q3_c'],[[[2,10,1],[-1,20,-1],[-1,5,-1]],[[-1,-8,-1],[-1,0,-1]]],[[2,10,1,-1,20,-1,-1,5,-1],[-1,-8,-1,-1,0,-1]]):
    expected=expected+[-1,0,-1]*(20-len(rows))
    rows=rows+[[-1,0,-1] for _ in range(20-len(rows))]
    body="a="+repr(rows)+"\nc.ArrayNodes=a\no=io.StringIO()\nwith contextlib.redirect_stdout(o):\n    if len(inspect.signature(c.PrintAll).parameters):c.PrintAll(a)\n    else:c.PrintAll()\n"
    body+="print('PASS' if list(map(int,re.findall(r'[-+]?\\d+',o.getvalue())))=="+repr(expected)+" else 'FAIL')"
    case['driverCode']=driver(body);case['expectedStdout']='PASS\n'
# Main-program layout still has to contain the stored rows, but descriptive headings are harmless.
body=code("a=ns.get('ArrayNodes',[])\nexpected=[[1,10,2],[9,5,3],[4,15,6],[5,8,8],[7,12,-1],[-1,6,-1],[-1,20,-1],[-1,11,-1],[-1,9,-1],[-1,4,-1]]\nnums=[]\nfor line in text.splitlines():\n    fields=re.findall(r'[-+]?\\d+',line)\n    if len(fields)==3:nums.extend(map(int,fields))\nflat=[v for row in expected for v in row]\nprint('PASS' if a[:10]==expected and ns.get('FreeNode')==10 and nums[:30]==flat else 'FAIL')\n")
wcases['Q3_di'][0]['driverCode']=main(body,[10,5,15,8,12,6,20,11,9,4])

pack(['9618_w21_41','9618_w21_42'],[wq1,wq2,wq3],wcases,dict(Q1=wref1,Q2=wref2,Q3=wref3))

coverage='''# 2021 source and assessment coverage\n\nFive supplied papers are included. After normalising the paper-number header and printer code, s21 41/42/43 have identical question content and identical TreasureChestData.txt bytes. w21 41/42 have identical question content apart from parentheses around one pseudocode OUTPUT; Pictures.txt bytes match. Each manifest independently preserves its supplied source data and metadata.\n\nThe linked-list table on QP page 2 was rendered and visually checked. The s21 mark scheme has image-only question pages; its page 7 was visually checked for the traversal rubric. All subpart marks were read from the QP.\n\n| Series | Question | Subparts (marks; mode A=auto M=manual E=evidence) |\n|---|---|---|\n|s21|Q1|a 2 M; b 4 M; c(i) 6 A; c(ii) 1 E; d(i) 7 A; d(ii) 3 A; d(iii) 1 E|\n|s21|Q2|a 2 M; b(i) 6 A; b(ii) 4 M; b(iii) 2 E; c 6 A|\n|s21|Q3|a 5 M; b 8 A; c(i) 1 A; c(ii) 3 A; c(iii) 5 A; c(iv) 7 A; c(v) 2 E|\n|w21|Q1|a 3 A; b(i) 3 A; b(ii) 2 E; c 7 A; d(i) 1 A; d(ii) 1 E|\n|w21|Q2|a 5 M; b 3 A; c 2 A; d 1 M; e 8 A; f 2 M; g 7 A; h 2 E|\n|w21|Q3|a 4 M; b 8 A; c 4 A; d(i) 3 A; d(ii) 1 E; e(i) 7 A; e(ii) 1 E|\n\nAll manifests total exactly 75. Automatic stages have representative public tests plus hidden boundary/alternative-data checks wherever useful. Exact output wording is not imposed where the QP asks only for an appropriate message: s21 Q2(b)(ii) is manually reviewed. Structural requirements (record declarations, private attributes, bubble-sort method, recursion/iteration, pointer persistence) still need teacher source review even when functional checks pass. Screenshots map to evidence review of saved runs; no unavailable screenshot uploader is claimed.\n\nKnown source ambiguity: w21 QP 2(a) lists constructor order description, frame colour, height, width; the published example code uses description, width, height, frame colour. The reference follows the QP. Getter tests recognise descriptive parameter names to permit both orders. The QP says ReadData raises an exception for a missing file, while the mark-scheme example catches IOError and outputs a message; the test accepts either explicit OSError propagation or handled diagnostic output. No source text files are missing. A capacity audit keeps every alternate TreasureChestData file at five records and every supplied tree array at twenty rows, including traversal tests; valid fixed-capacity loops are accepted.\n\nPython immutable-pointer convention: original by-reference pseudocode permits equivalent Python handling; references return tree pointers and use persistent linked-list pointer variables. Test adapters accept returned tuples or global tree-pointer updates. Linked-list allocation tests inspect the real nextNode chain and full-list refusal, not a canned success string. Teachers must additionally check repeated insertion pointer persistence.\n\nVerification at authoring time: JSON totals/limits and Python syntax parsed without running candidate/reference programs on the host. Full isolated reference and mutation runs are performed centrally and must be recorded separately; no earlier result is represented as rerun validation.\n'''
(ROOT/'coverage.md').write_text(coverage)
print('Built five 2021 manifests, no candidate/reference code executed.')
