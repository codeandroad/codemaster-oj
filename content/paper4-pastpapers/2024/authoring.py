from common import *

def summer41(src):
 f=src['files']['sf']['textFiles']
 setup='candidate.DataStored=[0]*20\ncandidate.NumberItems=0\n'
 q1=question('Q1','Input, bubble sort and binary search','''## 1(a) Declare global integer array `DataStored` for up to 20 integers, and integer `NumberItems` storing its occupied count. (1)
## 1(b) Initialise (5)
`Initialise()` prompts for the quantity, repeatedly reads it until in 1 to 20 inclusive, then inputs that many integers into DataStored, updating NumberItems.
## 1(c)
(i) Main program sets NumberItems to 0, calls Initialise and outputs the occupied data. (2)
(ii) Test with 30,5,3,9,4,1,2 (30 is an invalid quantity) and retain output. (2)
## 1(d)
(i) Write `BubbleSort()` to sort the occupied elements in ascending order using bubble sort. (4)
(ii) Main calls BubbleSort and outputs the occupied sorted data. (1)
(iii) Test with 5,3,9,4,1,2 and retain output. (1)
## 1(e)
(i) Write iterative `BinarySearch(DataToFind)` on DataStored, returning a matching index or -1 if absent. (6)
(ii) Main inputs a search number, calls BinarySearch and outputs its return value. (3)
(iii) Run twice: `5 1 6 2 8 10 2` and `5 1 6 2 8 10 7`; retain both outputs. (2)''',[
 stage('1(a)','Array state',1),stage('1(b)','Validated Initialise',5,'auto'),stage('1(c)(i)','Initial main output',2),stage('1(c)(ii)','Invalid quantity evidence',2,'evidence'),stage('1(d)(i)','BubbleSort',4,'auto'),stage('1(d)(ii)','Sorted main output',1),stage('1(d)(iii)','Sort evidence',1,'evidence'),stage('1(e)(i)','Iterative BinarySearch',6,'auto'),stage('1(e)(ii)','Main search',3),stage('1(e)(iii)','Two search runs',2,'evidence')],'''
 DataStored=[0]*20
 NumberItems=0
 def Initialise():
     global NumberItems
     quantity=0
     while not 1<=quantity<=20:
         try:quantity=int(input('Quantity (1 to 20): '))
         except ValueError:quantity=0
     for i in range(quantity):DataStored[i]=int(input('Number: '))
     NumberItems=quantity
 def BubbleSort():
     for x in range(NumberItems-1):
         for y in range(NumberItems-x-1):
             if DataStored[y]>DataStored[y+1]:DataStored[y],DataStored[y+1]=DataStored[y+1],DataStored[y]
 def BinarySearch(DataToFind):
     low=0;high=NumberItems-1
     while low<=high:
         middle=(low+high)//2
         if DataStored[middle]==DataToFind:return middle
         if DataStored[middle]<DataToFind:low=middle+1
         else:high=middle-1
     return -1
 def main():
     global NumberItems
     NumberItems=0;Initialise();print(*DataStored[:NumberItems])
     BubbleSort();print(*DataStored[:NumberItems])
     print(BinarySearch(int(input('Search number: '))))
 if __name__ == '__main__':main()
 ''',{
 '1_b':[case('quantity-retry',setup+"import builtins\nvalues=iter(['30','5','3','9','4','1','2'])\nbuiltins.input=lambda prompt='':next(values)\ncandidate.Initialise()\nprint(candidate.NumberItems,*candidate.DataStored[:candidate.NumberItems])",'5 3 9 4 1 2\n'),case('minimum-quantity',setup+"import builtins\nvalues=iter(['0','1','-99'])\nbuiltins.input=lambda prompt='':next(values)\ncandidate.Initialise()\nprint(candidate.NumberItems,*candidate.DataStored[:candidate.NumberItems])",'1 -99\n',False)],
 '1_di':[case('sort-five',setup+"candidate.DataStored[:5]=[3,9,4,1,2];candidate.NumberItems=5\ncandidate.BubbleSort()\nprint(*candidate.DataStored[:5])",'1 2 3 4 9\n'),case('occupied-prefix',"candidate.DataStored=[4,4,-2,0,99,88]+[0]*14;candidate.NumberItems=4\ncandidate.BubbleSort()\nprint(*candidate.DataStored)",'-2 0 4 4 99 88 '+'0 '*13+'0\n',False)],
 '1_ei':[case('original-searches',"candidate.DataStored=[1,2,6,8,10]+[0]*15;candidate.NumberItems=5\nprint(candidate.BinarySearch(2),candidate.BinarySearch(7))",'1 -1\n'),case('edge-searches',"candidate.DataStored=[-9,0,3,100]+[0]*16;candidate.NumberItems=4\nprint(candidate.BinarySearch(-9),candidate.BinarySearch(100),candidate.BinarySearch(101))",'0 3 -1\n',False)]})
 q2=question('Q2','Choosing a suitable tree','''## 2(a) Tree
(i) Declare `Tree(TreeName, HeightGrowth, MaxHeight, MaxWidth, Evergreen)` with private attributes: string name, integer annual growth in cm, integer maximum height/width in cm, and string Evergreen (`"Yes"` or `"No"`). Initialise all from parameters and include declaration comments. (4)
(ii) Implement getters `GetTreeName`, `GetGrowth`, `GetMaxHeight`, `GetMaxWidth`, `GetEvergreen`. (3)
## 2(b) ReadData (7)
Read 9 CSV rows from `Trees.txt`, each `name,growth,maxHeight,maxWidth,evergreen`. Create a local Tree array, append an object for each row, and return it. Include a file-not-found exception path.
## 2(c) PrintTrees (4)
`PrintTrees(tree)` outputs `TreeName has a maximum height MaxHeight a maximum width MaxWidth and grows HeightGrowth cm a year.` Then, if evergreen, `It does not lose its leaves.` Otherwise `It loses its leaves each year.` Replace placeholders with attribute values.
## 2(d)
(i) Main calls ReadData, saves the array and calls PrintTrees for the first object. (2)
(ii) Run and retain output. (1)
## 2(e) ChooseTree
(i) `ChooseTree(array)` inputs maximum acceptable height, maximum acceptable width, and evergreen preference. Build a new array of trees whose maximum height and width are each **at most** the input and whose Evergreen value matches. Print each matching tree with PrintTrees; output a suitable message if no matches. (6)
(ii) After listing matches, input the selected matching tree's name and its current height; calculate and output the years to its maximum height. For Beech at 40 cm, (400-40)/30 = 12 years. (2)
(iii) Call the selection procedure from main (the original final instruction spells it ChooseTrees). Test with height 400, width 200, evergreen Yes, selected Blue Conifer, starting height 100; retain output. (2)''',[
 stage('2(a)(i)','Tree constructor and privacy',4),stage('2(a)(ii)','Tree getters',3,'auto'),stage('2(b)','ReadData',7,'auto'),stage('2(c)','PrintTrees messages',4,'auto'),stage('2(d)(i)','First tree main output',2),stage('2(d)(ii)','Evidence',1,'evidence'),stage('2(e)(i)','Filter matching trees',6),stage('2(e)(ii)','Growth years',2),stage('2(e)(iii)','Required selection run',2,'evidence')],'''
 class Tree:
     # TreeName,Evergreen: str; HeightGrowth,MaxHeight,MaxWidth: int
     def __init__(self,TreeName,HeightGrowth,MaxHeight,MaxWidth,Evergreen):
         self.__TreeName=TreeName;self.__HeightGrowth=HeightGrowth;self.__MaxHeight=MaxHeight;self.__MaxWidth=MaxWidth;self.__Evergreen=Evergreen
     def GetTreeName(self):return self.__TreeName
     def GetGrowth(self):return self.__HeightGrowth
     def GetMaxHeight(self):return self.__MaxHeight
     def GetMaxWidth(self):return self.__MaxWidth
     def GetEvergreen(self):return self.__Evergreen
 def ReadData():
     trees=[]
     try:
         with open('Trees.txt') as f:
             for line in f:
                 name,growth,height,width,evergreen=line.strip().split(',')
                 trees.append(Tree(name,int(growth),int(height),int(width),evergreen))
     except FileNotFoundError:
         print('Trees file not found')
     return trees
 def PrintTrees(tree):
     print(tree.GetTreeName(),'has a maximum height',tree.GetMaxHeight(),'a maximum width',tree.GetMaxWidth(),'and grows',tree.GetGrowth(),'cm a year.',end=' ')
     print('It does not lose its leaves.' if tree.GetEvergreen()=='Yes' else 'It loses its leaves each year.')
 def ChooseTree(trees):
     height=int(input('Maximum height: '));width=int(input('Maximum width: '));evergreen=input('Evergreen (Yes/No): ')
     matches=[t for t in trees if t.GetMaxHeight()<=height and t.GetMaxWidth()<=width and t.GetEvergreen()==evergreen]
     if not matches:print('No trees meet the requirements');return
     for t in matches:PrintTrees(t)
     selected=input('Tree name: ');start=int(input('Starting height: '))
     for t in matches:
         if t.GetTreeName()==selected:print('Years to maximum height:',(t.GetMaxHeight()-start)/t.GetGrowth());return
 def main():
     trees=ReadData()
     if trees:PrintTrees(trees[0])
     ChooseTree(trees)
 if __name__ == '__main__':main()
 ''',{
 '2_aii':[case('beech-getters',"t=candidate.Tree('Beech',30,400,200,'No')\nprint(t.GetTreeName(),t.GetGrowth(),t.GetMaxHeight(),t.GetMaxWidth(),t.GetEvergreen())",'Beech 30 400 200 No\n'),case('evergreen-getters',"t=candidate.Tree('Blue Conifer',40,250,50,'Yes')\nprint(t.GetTreeName(),t.GetGrowth(),t.GetMaxHeight(),t.GetMaxWidth(),t.GetEvergreen())",'Blue Conifer 40 250 50 Yes\n',False)],
 '2_b':[case('read-nine',"a=candidate.ReadData()\nprint(len(a),a[0].GetTreeName(),a[0].GetGrowth(),a[-1].GetMaxWidth())",'9 Beech 30 150\n'),case('csv-values',"a=candidate.ReadData()\nprint(len(a),a[0].GetTreeName(),a[0].GetGrowth(),a[0].GetMaxHeight(),a[0].GetMaxWidth(),a[0].GetEvergreen())",'9 Test Tree 2 3 4 Yes\n',False,{'Trees.txt':'Test Tree,2,3,4,Yes\n'+'\n'.join(f['Trees.txt'].splitlines()[1:])+'\n'})],
 '2_c':[case('deciduous-message',"candidate.PrintTrees(candidate.Tree('Beech',30,400,200,'No'))",'Beech has a maximum height 400 a maximum width 200 and grows 30 cm a year. It loses its leaves each year.\n'),case('evergreen-message',"candidate.PrintTrees(candidate.Tree('Blue Conifer',40,250,50,'Yes'))",'Blue Conifer has a maximum height 250 a maximum width 50 and grows 40 cm a year. It does not lose its leaves.\n',False)]},f)
 setup="candidate.QueueData=['']*20\ncandidate.QueueHead=-1;candidate.QueueTail=-1\n"
 q3=question('Q3','Queue strings with a check digit','''## 3(a) Initialise global string array `QueueData` with 20 null entries, `QueueHead=-1` and `QueueTail=-1`; these point to first and last occupied slots. (1)
## 3(b) Enqueue (4)
`Enqueue(data)` inserts into the linear queue, updates pointers and returns True; if full return False.
## 3(c) Dequeue (3)
`Dequeue()` returns string `"false"` if empty; otherwise returns the next data and updates pointers.
## 3(d) Validated records
The input is a 7-character string. The first 6 characters are digits, with multipliers 1,3,1,3,1,3. Sum the products and divide by 10, rounding down. This is the check digit, except 10 is represented by `X`. For example 954123 has total 42, check digit 4, so `9541234` is valid and `9541235` is invalid.
(i) Write `StoreItems()` (procedure or function) to read ten 7-character strings. Validate their check digit. For valid records remove the last character and call Enqueue; output a suitable inserted/full message. Do not store invalid records. Count and output the number of invalid records. (6)
(ii) Main calls StoreItems then Dequeue, and outputs the returned data or a suitable empty-queue message. (1)
(iii) Run with these ten strings in order and retain output: 999999X, 1251484, 5500212, 0033585, 9845788, 6666666, 3258746, 8111022, 7568557, 0012353. (2)''',[
 stage('3(a)','Initial queue',1),stage('3(b)','Enqueue',4,'auto'),stage('3(c)','Dequeue',3,'auto'),stage('3(d)(i)','Check digit and StoreItems',6,'auto'),stage('3(d)(ii)','Main dequeue',1),stage('3(d)(iii)','Evidence',2,'evidence')],'''
 QueueData=['']*20
 QueueHead=-1
 QueueTail=-1
 def Enqueue(Data):
     global QueueHead,QueueTail
     if QueueTail==19:return False
     QueueTail+=1;QueueData[QueueTail]=Data
     if QueueHead==-1:QueueHead=0
     return True
 def Dequeue():
     global QueueHead
     if QueueHead==-1 or QueueHead>QueueTail:return 'false'
     data=QueueData[QueueHead];QueueHead+=1;return data
 def StoreItems():
     invalid=0
     for _ in range(10):
         data=input('Seven-character record: ')
         valid=len(data)==7 and data[:6].isdigit()
         if valid:
             digit=sum(int(data[i])*(1 if i%2==0 else 3) for i in range(6))//10
             check='X' if digit==10 else str(digit)
             valid=data[6]==check
         if valid:print('Inserted' if Enqueue(data[:6]) else 'Queue full')
         else:invalid+=1
     print('Invalid items:',invalid)
 def main():
     StoreItems();value=Dequeue()
     print('Queue empty' if value=='false' else value)
 if __name__ == '__main__':main()
 ''',{
 '3_b':[case('first-value',setup+"print(candidate.Enqueue('954123'),candidate.QueueHead,candidate.QueueTail,candidate.QueueData[0])",'True 0 0 954123\n'),case('full-queue',setup+"print(sum(candidate.Enqueue(str(i)) for i in range(21)),candidate.QueueTail)",'20 19\n',False)],
 '3_c':[case('fifo',setup+"candidate.Enqueue('001235');candidate.Enqueue('999999')\nprint(candidate.Dequeue(),candidate.Dequeue())",'001235 999999\n'),case('empty',setup+"print(candidate.Dequeue())\ncandidate.Enqueue('123456');candidate.Dequeue();print(candidate.Dequeue())",'false\nfalse\n',False)],
 '3_di':[case('paper-check-digits',setup+"import builtins,io,contextlib\nvalues=iter(['999999X','1251484','5500212','0033585','9845788','6666666','3258746','8111022','7568557','0012353'])\nbuiltins.input=lambda prompt='':next(values)\nwith contextlib.redirect_stdout(io.StringIO()):candidate.StoreItems()\nprint(*candidate.QueueData[:candidate.QueueTail+1])",'999999 125148 550021 984578 811102 756855\n'),case('check-zero-and-invalid',setup+"import builtins,io,contextlib\nvalues=iter(['0000000','999999X','9541234','9541235','1111111','1111112','0000001','0033585','6666666','0012353'])\nbuiltins.input=lambda prompt='':next(values)\nwith contextlib.redirect_stdout(io.StringIO()):candidate.StoreItems()\nprint(*candidate.QueueData[:candidate.QueueTail+1])",'000000 999999 954123 111111\n',False)]})
 return [q1,q2,q3]

def summer42(src):
 f=src['files']['sf']['textFiles']
 q1=question('Q1','Words made from a main word','''A word game uses files `Easy.txt`, `Medium.txt`, `Hard.txt`. The first line is the main word; each remaining line is an answer of at least 3 letters that can be made from its letters.
## 1(a) ReadWords (6)
`ReadWords(filename)` opens and reads the file into global `WordArray`, main word at index 0 and answers afterwards. Global `NumberWords` counts answers, excluding the main word.
## 1(b) Main program (4)
Prompt for easy, medium or hard and call ReadWords with the matching capitalised filename, for example easy uses Easy.txt.
## 1(c) Play
(i) `Play()` outputs the main word and answer count. Repeatedly input a word until `no`. Output whether each input is an answer, count correct answers, and replace each correctly guessed answer in WordArray with a null value so it cannot be counted twice. (6)
(ii) When the user stops, output the percentage of answers guessed correctly, then all unguessed answers. (3)
## 1(d)
(i) Extend ReadWords to call Play after loading the file. (1)
(ii) Run with easy, she, out, no; retain output. (1)
(iii) Run with hard, fine, fined, idea, no; retain output. (1)''',[
 stage('1(a)','ReadWords and answer count',6,'auto'),stage('1(b)','Difficulty selection',4),stage('1(c)(i)','Play and remove correct answers',6,'auto'),stage('1(c)(ii)','Percentage and missed answers',3),stage('1(d)(i)','ReadWords calls Play',1),stage('1(d)(ii)','Easy evidence',1,'evidence'),stage('1(d)(iii)','Hard evidence',1,'evidence')],'''
 WordArray=[]
 NumberWords=0
 def ReadWords(FileName):
     global WordArray,NumberWords
     with open(FileName) as f:WordArray=[line.strip() for line in f]
     NumberWords=len(WordArray)-1
     Play()
 def Play():
     correct=0
     print('Main word:',WordArray[0],'Answers:',NumberWords)
     while True:
         word=input('Answer or no: ')
         if word=='no':break
         found=False
         for i in range(1,NumberWords+1):
             if WordArray[i]==word:
                 WordArray[i]='';found=True;correct+=1;break
         print('An answer' if found else 'Not an answer')
     print('Percentage:',100*correct/NumberWords if NumberWords else 0)
     for word in WordArray[1:]:
         if word!='':print(word)
 def main():
     level=''
     while level not in ['easy','medium','hard']:level=input('Difficulty: ').lower()
     ReadWords(level.title()+'.txt')
 if __name__ == '__main__':main()
 ''',{
 '1_a':[case('easy-data',"candidate.WordArray=[];candidate.NumberWords=0;candidate.Play=lambda:None\ncandidate.ReadWords('Easy.txt')\nprint(candidate.WordArray[0],candidate.NumberWords,candidate.WordArray[1],candidate.WordArray[-1])",'house 14 hues she\n'),case('hard-data',"candidate.WordArray=[];candidate.NumberWords=0;candidate.Play=lambda:None\ncandidate.ReadWords('Hard.txt')\nprint(candidate.WordArray[0],candidate.NumberWords,candidate.WordArray[1],candidate.WordArray[-1])",'fainted 97 defiant tie\n',False)],
 '1_ci':[case('guess-once',f"import builtins,contextlib,io\ncandidate.WordArray={f['Easy.txt'].splitlines()!r};candidate.NumberWords=14\nvalues=iter(['she','out','no']);builtins.input=lambda prompt='':next(values)\nwith contextlib.redirect_stdout(io.StringIO()):candidate.Play()\nprint(sum(x is None or str(x).strip()=='' for x in candidate.WordArray[1:]),*candidate.WordArray[1:3])",'1 hues hose\n'),case('duplicate-no-extra-credit',f"import builtins,contextlib,io\ncandidate.WordArray={f['Hard.txt'].splitlines()!r};candidate.NumberWords=97\nvalues=iter(['fine','fine','idea','no']);builtins.input=lambda prompt='':next(values)\nwith contextlib.redirect_stdout(io.StringIO()):candidate.Play()\nprint(sum(x is None or str(x).strip()=='' for x in candidate.WordArray[1:]),candidate.WordArray[1],candidate.WordArray[{f['Hard.txt'].splitlines().index('fined')}])",'2 defiant fined\n',False)]},f)
 q2=question('Q2','Objects in an array binary tree','''The tree uses an array of up to 20 nodes. A missing child has pointer -1.
## 2(a) Node
(i) Declare `Node(Data)` with integer LeftPointer, Data, RightPointer; set Data from its parameter and both pointers to -1, with declaration comments. (4)
(ii) `GetLeft`, `GetRight`, `GetData` return their attributes. (3)
(iii) `SetLeft`, `SetRight`, `SetData` each assign their parameter. (3)
## 2(b) TreeClass
(i) Constructor creates array Tree of 20 Node(-1) objects, sets FirstNode=-1 and NumberNodes=0. (4)
(ii) `InsertNode(NewNode)` stores the Node at index NumberNodes. If empty set FirstNode=0. Otherwise start at FirstNode, compare values and follow left/right pointers until the correct ascending binary-tree position is reached; set the parent's pointer and increment NumberNodes. Nodes cannot be deleted. (6)
(iii) `OutputTree()` outputs left pointer, data, right pointer for each inserted node in physical array order. If empty output `No nodes`. (4)
## 2(c) Main program
(i) Create `TheTree`, a TreeClass instance. (1)
(ii) Insert Nodes with data 10,11,5,1,20,7,15 in that order, then call OutputTree. (4)
(iii) Run and retain output. (1)''',[
 stage('2(a)(i)','Node constructor',4),stage('2(a)(ii)','Node getters',3,'auto'),stage('2(a)(iii)','Node setters',3,'auto'),stage('2(b)(i)','TreeClass constructor',4),stage('2(b)(ii)','InsertNode and tree links',6,'auto'),stage('2(b)(iii)','OutputTree',4,'auto'),stage('2(c)(i)','TheTree instance',1),stage('2(c)(ii)','Seven insertions',4),stage('2(c)(iii)','Evidence',1,'evidence')],'''
 class Node:
     # LeftPointer,Data,RightPointer: int
     def __init__(self,Data):self.LeftPointer=-1;self.Data=Data;self.RightPointer=-1
     def GetLeft(self):return self.LeftPointer
     def GetRight(self):return self.RightPointer
     def GetData(self):return self.Data
     def SetLeft(self,Value):self.LeftPointer=Value
     def SetRight(self,Value):self.RightPointer=Value
     def SetData(self,Value):self.Data=Value
 class TreeClass:
     # Tree: list[Node]; FirstNode,NumberNodes: int
     def __init__(self):self.Tree=[Node(-1) for _ in range(20)];self.FirstNode=-1;self.NumberNodes=0
     def InsertNode(self,NewNode):
         index=self.NumberNodes
         if index==20:return
         self.Tree[index]=NewNode
         if self.FirstNode==-1:self.FirstNode=index
         else:
             current=self.FirstNode
             while True:
                 if NewNode.GetData()<self.Tree[current].GetData():
                     if self.Tree[current].GetLeft()==-1:self.Tree[current].SetLeft(index);break
                     current=self.Tree[current].GetLeft()
                 else:
                     if self.Tree[current].GetRight()==-1:self.Tree[current].SetRight(index);break
                     current=self.Tree[current].GetRight()
         self.NumberNodes+=1
     def OutputTree(self):
         if self.NumberNodes==0:print('No nodes')
         for i in range(self.NumberNodes):print(self.Tree[i].GetLeft(),self.Tree[i].GetData(),self.Tree[i].GetRight())
 def main():
     TheTree=TreeClass()
     for number in [10,11,5,1,20,7,15]:TheTree.InsertNode(Node(number))
     TheTree.OutputTree()
 if __name__ == '__main__':main()
 ''',{
 '2_aii':[case('node-initial',"n=candidate.Node(10);print(n.GetLeft(),n.GetData(),n.GetRight())",'-1 10 -1\n'),case('different-data',"n=candidate.Node(-1);print(n.GetLeft(),n.GetData(),n.GetRight())",'-1 -1 -1\n',False)],
 '2_aiii':[case('all-setters',"n=candidate.Node(10);n.SetLeft(2);n.SetRight(3);n.SetData(17)\nprint(n.GetLeft(),n.GetData(),n.GetRight())",'2 17 3\n'),case('reset-pointers',"n=candidate.Node(1);n.SetLeft(0);n.SetRight(4);n.SetLeft(-1);n.SetRight(-1)\nprint(n.GetLeft(),n.GetData(),n.GetRight())",'-1 1 -1\n',False)],
 '2_bii':[case('original-tree',"t=candidate.TreeClass()\nfor n in [10,11,5,1,20,7,15]:t.InsertNode(candidate.Node(n))\nt.OutputTree()",'2 10 1\n-1 11 4\n3 5 5\n-1 1 -1\n6 20 -1\n-1 7 -1\n-1 15 -1\n'),case('left-right-subtrees',"t=candidate.TreeClass()\nfor n in [5,2,8,3,7]:t.InsertNode(candidate.Node(n))\nt.OutputTree()",'1 5 2\n-1 2 3\n4 8 -1\n-1 3 -1\n-1 7 -1\n',False)],
 '2_biii':[case('one-node',"t=candidate.TreeClass();t.InsertNode(candidate.Node(8));t.OutputTree()",'-1 8 -1\n'),case('no-nodes',"candidate.TreeClass().OutputTree()",'No nodes\n',False)]})
 nums=[100,85,644,22,15,8,1]
 q3=question('Q3','Recursive insertion sort and binary search','''## 3(a) Declare local `NumberArray` in main with 100,85,644,22,15,8,1 in that order. (1)
## 3(b) RecursiveInsertion
(i) Implement `RecursiveInsertion(IntegerArray, NumberElements)` to sort the first NumberElements items in ascending order using recursive insertion sort and return the array. Base case NumberElements<=1 returns unchanged. Otherwise recursively sort the preceding prefix, save the last item and shift greater/equal preceding values right until the saved item can be inserted. (4)
(ii) Call it from main using the initial array and count; output `Recursive` and the returned array. (2)
(iii) Run and retain output. (1)
## 3(c) IterativeInsertion
(i) Implement `IterativeInsertion(IntegerArray, NumberElements)` (or derive the count from the array) using iterative insertion sort and returning the ascending array. (4)
(ii) Call it with the original unsorted array; output `iterative` then the returned array. (1)
(iii) Run and retain output. (1)
## 3(d) Recursive BinarySearch
(i) `BinarySearch(IntegerArray, First, Last, ToFind)` recursively searches the inclusive First..Last range and returns a matching index or -1. (6)
(ii) Main calls it on the sorted array for 644; output the returned index or `Not found`. (2)
(iii) Run and retain output. (1)''',[
 stage('3(a)','Original local data',1),stage('3(b)(i)','RecursiveInsertion',4,'auto'),stage('3(b)(ii)','Recursive main output',2),stage('3(b)(iii)','Evidence',1,'evidence'),stage('3(c)(i)','IterativeInsertion',4,'auto'),stage('3(c)(ii)','Iterative main output',1),stage('3(c)(iii)','Evidence',1,'evidence'),stage('3(d)(i)','Recursive BinarySearch',6,'auto'),stage('3(d)(ii)','Search main output',2),stage('3(d)(iii)','Evidence',1,'evidence')],'''
 def RecursiveInsertion(IntegerArray,NumberElements):
     if NumberElements<=1:return IntegerArray
     RecursiveInsertion(IntegerArray,NumberElements-1)
     LastItem=IntegerArray[NumberElements-1];CheckItem=NumberElements-2
     while CheckItem>=0 and IntegerArray[CheckItem]>=LastItem:
         IntegerArray[CheckItem+1]=IntegerArray[CheckItem];CheckItem-=1
     IntegerArray[CheckItem+1]=LastItem
     return IntegerArray
 def IterativeInsertion(IntegerArray,NumberElements=None):
     if NumberElements is None:NumberElements=len(IntegerArray)
     for index in range(1,NumberElements):
         item=IntegerArray[index];check=index-1
         while check>=0 and IntegerArray[check]>item:
             IntegerArray[check+1]=IntegerArray[check];check-=1
         IntegerArray[check+1]=item
     return IntegerArray
 def BinarySearch(IntegerArray,First,Last,ToFind):
     if First>Last:return -1
     middle=(First+Last)//2
     if IntegerArray[middle]==ToFind:return middle
     if IntegerArray[middle]>ToFind:return BinarySearch(IntegerArray,First,middle-1,ToFind)
     return BinarySearch(IntegerArray,middle+1,Last,ToFind)
 def main():
     NumberArray=[100,85,644,22,15,8,1]
     recursive=RecursiveInsertion(NumberArray.copy(),len(NumberArray));print('Recursive');print(*recursive)
     iterative=IterativeInsertion(NumberArray.copy());print('iterative');print(*iterative)
     found=BinarySearch(iterative,0,len(iterative)-1,644);print('Not found' if found==-1 else found)
 if __name__ == '__main__':main()
 ''',{
 '3_bi':[case('original-recursive',f"print(*candidate.RecursiveInsertion({nums!r},7))",'1 8 15 22 85 100 644\n'),case('prefix-duplicates',"print(*candidate.RecursiveInsertion([4,-1,4,0,99,88,77],4))\nprint(*candidate.RecursiveInsertion([7,6,5,4,3,2,1],1))",'-1 0 4 4 99 88 77\n7 6 5 4 3 2 1\n',False)],
 '3_ci':[case('original-iterative',f"print(*candidate.IterativeInsertion({nums!r}))",'1 8 15 22 85 100 644\n'),case('iterative-boundaries',"print(*candidate.IterativeInsertion([3,3,-1,0,5,2,1]))",'-1 0 1 2 3 3 5\n',False)],
 '3_di':[case('search-644',"print(candidate.BinarySearch([1,8,15,22,85,100,644],0,6,644))",'6\n'),case('recursive-range',"a=[-9,-2,0,1,3,5,9]\nprint(candidate.BinarySearch(a,0,6,-9),candidate.BinarySearch(a,0,6,6),candidate.BinarySearch(a,2,6,-9),candidate.BinarySearch(a,4,3,2))",'0 -1 -1 -1\n',False)]})
 return [q1,q2,q3]

def autumn41(src):
 f=src['files']['sf']['textFiles']
 q1=question('Q1','Read and sort colour strings','''## 1(a) ReadData (6)
`ReadData()` creates a local string array for 45 items, reads each line from `Data.txt` into it and returns the array.
## 1(b) FormatArray
(i) `FormatArray(array)` concatenates the items into one string separated by spaces and returns it. (2)
(ii) Main calls ReadData, stores its return, calls FormatArray and outputs the returned string. (3)
(iii) Run and retain output. (1)
## 1(c) CompareStrings (4)
`CompareStrings(first, second)` compares lower-case strings one character at a time. If characters are equal continue to the next pair. Return 1 if first comes alphabetically before second, or 2 if second comes before first. Assume a difference occurs before either string ends. Do not use a built-in whole-string comparison function.
## 1(d) Bubble
(i) `Bubble(array)` bubble-sorts the strings in ascending alphabetical order using CompareStrings and returns the sorted array. (3)
(ii) Main calls Bubble on the unsorted array, then outputs FormatArray of the sorted array. (2)
(iii) Run and retain output. (1)''',[
 stage('1(a)','ReadData',6,'auto'),stage('1(b)(i)','FormatArray',2,'auto'),stage('1(b)(ii)','Unsorted main output',3),stage('1(b)(iii)','Evidence',1,'evidence'),stage('1(c)','Character comparison',4,'auto'),stage('1(d)(i)','Bubble',3,'auto'),stage('1(d)(ii)','Sorted main output',2),stage('1(d)(iii)','Evidence',1,'evidence')],'''
 def ReadData():
     data=['']*45
     with open('Data.txt') as f:
         for i in range(45):data[i]=f.readline().strip()
     return data
 def FormatArray(Data):return ' '.join(Data)
 def CompareStrings(First,Second):
     index=0
     while First[index]==Second[index]:index+=1
     return 1 if First[index]<Second[index] else 2
 def Bubble(Data):
     for x in range(len(Data)-1):
         for y in range(len(Data)-x-1):
             if CompareStrings(Data[y],Data[y+1])==2:Data[y],Data[y+1]=Data[y+1],Data[y]
     return Data
 def main():
     data=ReadData();print(FormatArray(data))
     data=Bubble(data);print(FormatArray(data))
 if __name__ == '__main__':main()
 ''',{
 '1_a':[case('read-colours',"a=candidate.ReadData();print(len(a),a[0],a[-1])",'45 beige sage\n'),case('read-order',"a=candidate.ReadData();print(len(a),*a[:3],a[-1])",'45 zzz yyy xxx item44\n',False,{'Data.txt':'\n'.join(['zzz','yyy','xxx']+[f'item{i}' for i in range(3,45)])+'\n'})],
 '1_bi':[case('format-original',f"print(candidate.FormatArray({f['Data.txt'].splitlines()!r}).strip())",' '.join(f['Data.txt'].splitlines())+'\n'),case('format-reversed',f"print(candidate.FormatArray({list(reversed(f['Data.txt'].splitlines()))!r}).strip())",' '.join(reversed(f['Data.txt'].splitlines()))+'\n',False)],
 '1_c':[case('simple-comparison',"print(candidate.CompareStrings('red','blue'),candidate.CompareStrings('blue','red'))",'2 1\n'),case('later-difference',"print(candidate.CompareStrings('mango','maroon'),candidate.CompareStrings('silver','scarlet'),candidate.CompareStrings('aabb','aabc'))",'1 2 1\n',False)],
 '1_di':[case('colour-sort',f"print(*candidate.Bubble({f['Data.txt'].splitlines()!r}))",' '.join(sorted(f['Data.txt'].splitlines()))+'\n'),case('reverse-order',f"print(*candidate.Bubble({list(reversed(sorted(f['Data.txt'].splitlines())))!r}))",' '.join(sorted(f['Data.txt'].splitlines()))+'\n',False)]},f)
 q2=question('Q2','Horses and show-jumping fences','''## 2(a) Horse
(i) Declare `Horse(Name,MaxFenceHeight,PercentageSuccess)` with private string Name and integer maximum fence height and base success percentage. Initialise from parameters and include attribute comments. (4)
(ii) Implement `GetName()` and `GetMaxFenceHeight()`. (3)
## 2(b)
(i) Main declares local array Horses for two objects: Beauty, max height 150, base success 72%; Jet, max height 160, base success 65%. Output both names from the array. (5)
(ii) Run and retain output. (1)
## 2(c) Fence
(i) Declare `Fence(Height,Risk)` with private integer attributes and `GetHeight`, `GetRisk`. (4)
(ii) Main declares local Course for four Fence objects. Input height (70..180 inclusive) and risk (1..5 inclusive) for each, repeatedly inputting until valid before creating the object. (5)
## 2(d) Success (5)
`Horse.Success(height,risk)` returns a real percentage. If the fence is higher than the horse's maximum, return 20% of the horse's base PercentageSuccess, regardless of risk. Otherwise multiply base success by the risk modifier: risk 1=>1.0, 2=>0.9, 3=>0.8, 4=>0.7, 5=>0.6. Jet at height 140, risk 3 therefore has a 52% chance.
## 2(e) Main calculation
(i) Output each horse's success percentage for each of the four fences, with messages including horse name and fence number. (3)
(ii) Output each horse's arithmetic mean percentage over all four fences, then output the horse with the higher average. Assume the averages differ. (2)
(iii) Run using fence (height,risk) values (152,5),(121,1),(130,3),(145,4); retain output. (2)''',[
 stage('2(a)(i)','Horse constructor/privacy',4),stage('2(a)(ii)','Horse getters',3,'auto'),stage('2(b)(i)','Beauty and Jet objects',5),stage('2(b)(ii)','Evidence',1,'evidence'),stage('2(c)(i)','Fence constructor and getters',4,'auto'),stage('2(c)(ii)','Four validated fences',5),stage('2(d)','Success calculation',5,'auto'),stage('2(e)(i)','Eight individual chances',3),stage('2(e)(ii)','Averages and winner',2),stage('2(e)(iii)','Evidence',2,'evidence')],'''
 class Horse:
     # Name: str; MaxFenceHeight,PercentageSuccess: int
     def __init__(self,Name,MaxFenceHeight,PercentageSuccess):
         self.__Name=Name;self.__MaxFenceHeight=MaxFenceHeight;self.__PercentageSuccess=PercentageSuccess
     def GetName(self):return self.__Name
     def GetMaxFenceHeight(self):return self.__MaxFenceHeight
     def Success(self,Height,Risk):
         if Height>self.__MaxFenceHeight:return self.__PercentageSuccess*0.2
         return self.__PercentageSuccess*(1-(Risk-1)*0.1)
 class Fence:
     # Height,Risk: int
     def __init__(self,Height,Risk):self.__Height=Height;self.__Risk=Risk
     def GetHeight(self):return self.__Height
     def GetRisk(self):return self.__Risk
 def main():
     Horses=[Horse('Beauty',150,72),Horse('Jet',160,65)]
     for horse in Horses:print(horse.GetName())
     Course=[]
     for _ in range(4):
         while True:
             try:
                 height=int(input('Fence height (70 to 180): '));risk=int(input('Risk (1 to 5): '))
                 if 70<=height<=180 and 1<=risk<=5:break
             except ValueError:pass
         Course.append(Fence(height,risk))
     averages=[]
     for horse in Horses:
         total=0
         for i,fence in enumerate(Course):
             chance=horse.Success(fence.GetHeight(),fence.GetRisk());total+=chance
             print('The horse',horse.GetName(),'at fence',i+1,'has a',chance,'% chance of success')
         averages.append(total/4)
         print('The horse',horse.GetName(),'has an average',total/4,'% chance of jumping over all four fences')
     print('Highest average:',Horses[0 if averages[0]>averages[1] else 1].GetName())
 if __name__ == '__main__':main()
 ''',{
 '2_aii':[case('beauty',"h=candidate.Horse('Beauty',150,72);print(h.GetName(),h.GetMaxFenceHeight())",'Beauty 150\n'),case('jet',"h=candidate.Horse('Jet',160,65);print(h.GetName(),h.GetMaxFenceHeight())",'Jet 160\n',False)],
 '2_ci':[case('fence-data',"f=candidate.Fence(152,5);print(f.GetHeight(),f.GetRisk())",'152 5\n'),case('fence-boundaries',"f=candidate.Fence(70,1);g=candidate.Fence(180,5);print(f.GetHeight(),f.GetRisk(),g.GetHeight(),g.GetRisk())",'70 1 180 5\n',False)],
 '2_d':[case('jet-example',"h=candidate.Horse('Jet',160,65);print(format(h.Success(140,3),'.4f'))",'52.0000\n'),case('height-and-risk',"h=candidate.Horse('Beauty',150,72)\nfor height,risk in [(150,1),(150,5),(151,1),(151,5)]:print(format(h.Success(height,risk),'.4f'))",'72.0000\n43.2000\n14.4000\n14.4000\n',False)]})
 setup="candidate.LinkedList=[[-1,i+1] for i in range(20)];candidate.LinkedList[-1][1]=-1\ncandidate.FirstEmpty=0;candidate.FirstNode=-1\n"
 walk="def walk():\n    p=candidate.FirstNode;seen=[]\n    while p!=-1 and len(seen)<=20:\n        seen.append(candidate.LinkedList[p][0]);p=candidate.LinkedList[p][1]\n    return seen\n"
 q3=question('Q3','An array-based linked list and free list','''A linked list of positive integers has capacity 20. Global `LinkedList` is a 20-by-2 array: column 0 is data and column 1 is next-node pointer. A pointer -1 terminates a list.
## 3(a) Initialise (2)
Set each data value to -1; link the empty nodes 0->1->...->19->-1. Initialise `FirstEmpty=0`, `FirstNode=-1`.
## 3(b) InsertData (6)
`InsertData()` takes five positive integers as input and inserts each at the **front** of the occupied list. When not full, use the node at FirstEmpty, move FirstEmpty to its old next pointer, point the inserted node at FirstNode and update FirstNode. If full, end the procedure.
## 3(c) Output
(i) `OutputLinkedList()` follows the links from FirstNode and outputs the data in list order. (2)
(ii) Main calls InsertData then OutputLinkedList. (1)
(iii) Run with 5,1,2,3,8 and retain output. (1)
## 3(d) RemoveData
(i) `RemoveData(value)` searches from FirstNode and removes only the **first occurrence** of value, updating the occupied links and putting that node back onto the free list. Assume value exists in the list. (5)
(ii) Main calls RemoveData(5), outputs `After`, then calls OutputLinkedList. (1)
(iii) Run separately with 5,6,8,9,5 and with 10,7,8,5,6; retain both outputs. (1)''',[
 stage('3(a)','Linked/free list initialisation',2),stage('3(b)','Five front insertions',6,'auto'),stage('3(c)(i)','Follow occupied links',2,'auto'),stage('3(c)(ii)','Insert/output main',1),stage('3(c)(iii)','Evidence',1,'evidence'),stage('3(d)(i)','Remove and recycle first match',5,'auto'),stage('3(d)(ii)','After main output',1),stage('3(d)(iii)','Two removal runs',1,'evidence')],'''
 LinkedList=[[-1,i+1] for i in range(20)]
 LinkedList[19][1]=-1
 FirstEmpty=0
 FirstNode=-1
 def InsertData():
     global FirstEmpty,FirstNode
     for _ in range(5):
         if FirstEmpty==-1:return
         data=int(input('Positive integer: '))
         index=FirstEmpty;FirstEmpty=LinkedList[index][1]
         LinkedList[index]=[data,FirstNode];FirstNode=index
 def OutputLinkedList():
     current=FirstNode
     while current!=-1:
         print(LinkedList[current][0]);current=LinkedList[current][1]
 def RemoveData(Data):
     global FirstNode,FirstEmpty
     current=FirstNode;previous=-1
     while LinkedList[current][0]!=Data:previous=current;current=LinkedList[current][1]
     if previous==-1:FirstNode=LinkedList[current][1]
     else:LinkedList[previous][1]=LinkedList[current][1]
     LinkedList[current][1]=FirstEmpty;FirstEmpty=current
 def main():
     InsertData();OutputLinkedList();RemoveData(5);print('After');OutputLinkedList()
 if __name__ == '__main__':main()
 ''',{
 '3_b':[case('front-insertion',setup+"import builtins\nvalues=iter(['5','1','2','3','8']);builtins.input=lambda prompt='':next(values)\ncandidate.InsertData()\n"+walk+"print(*walk());print(candidate.FirstEmpty)",'8 3 2 1 5\n5\n'),case('last-free-node',setup+"import builtins\ncandidate.LinkedList[:19]=[[100+i,i+1] for i in range(19)];candidate.LinkedList[18][1]=-1\ncandidate.FirstNode=0;candidate.FirstEmpty=19\nvalues=iter(['7']);builtins.input=lambda prompt='':next(values)\ncandidate.InsertData()\n"+walk+"items=walk();print(len(items),items[0],items[-1],candidate.FirstEmpty)",'20 7 118 -1\n',False)],
 '3_ci':[case('linked-order',setup+"candidate.LinkedList[4]=[8,2];candidate.LinkedList[2]=[3,0];candidate.LinkedList[0]=[5,-1];candidate.FirstNode=4;candidate.FirstEmpty=1;candidate.LinkedList[1][1]=3;candidate.LinkedList[3][1]=5\ncandidate.OutputLinkedList()",'8 3 5\n'),case('empty-output',setup+"candidate.OutputLinkedList()",'',False)],
 '3_di':[case('remove-head-duplicate',setup+"candidate.LinkedList[:5]=[[5,-1],[6,0],[8,1],[9,2],[5,3]];candidate.FirstNode=4;candidate.FirstEmpty=5\ncandidate.RemoveData(5)\n"+walk+"print(*walk());print(candidate.FirstEmpty,candidate.LinkedList[candidate.FirstEmpty][1])",'9 8 6 5\n4 5\n'),case('remove-middle',setup+"candidate.LinkedList[:5]=[[10,-1],[7,0],[8,1],[5,2],[6,3]];candidate.FirstNode=4;candidate.FirstEmpty=5\ncandidate.RemoveData(5)\n"+walk+"print(*walk());print(candidate.FirstEmpty,candidate.LinkedList[candidate.FirstEmpty][1])",'6 8 7 10\n3 5\n',False),case('remove-last-node',setup+"candidate.LinkedList[0]=[5,-1];candidate.FirstNode=0;candidate.FirstEmpty=1\ncandidate.RemoveData(5)\nprint(candidate.FirstNode,candidate.FirstEmpty,candidate.LinkedList[0][1])",'-1 0 1\n',False)]})
 return [q1,q2,q3]

def autumn42(src):
 f=src['files']['sf']['textFiles']
 q1=question('Q1','Characters competing in event groups','''Each group contains five events of type jump, swim, run or drive.
## 1(a) EventItem
(i) Declare `EventItem(EventName,Type,Difficulty)` with private string name/type and integer difficulty 1 (easiest) to 5 (hardest), initialised from parameters. Include declaration comments. (4)
(ii) Implement `GetName`, `GetDifficulty`, `GetEventType`. (3)
## 1(b) Event group
(i) Declare local array `Group` for five EventItem objects. (1)
(ii) Store these events in order: Bridge/jump/3, Water wade/swim/4, 100 mile run/run/5, Gridlock/drive/2, Wall on wall/jump/4. (3)
## 1(c) Character (4)
Declare `Character(CharacterName,Jump,Swim,Run,Drive)` with private string name and four integer skill levels (1..5); initialise from parameters and implement `GetName()`. Include declaration comments.
## 1(d) CalculateScore (4)
`CalculateScore(eventType,difficulty)` selects the character's skill for that type. Return 100 when skill>=difficulty. Otherwise use difference=difficulty-skill: differences 1,2,3,4 return 80,60,40,20 respectively. Return an integer percentage.
## 1(e) Main program
(i) Create characters Tarz (jump5,swim3,run5,drive1) and Geni (jump2,swim2,run3,drive4). (2)
(ii) For every event calculate both chances. Output the higher-chance character's name and a win message, and add 1 point to that character; equal chances produce a draw message and no points. At the end output the group winner and points, or a draw message if tied. (7)
(iii) Run and retain output. (1)''',[
 stage('1(a)(i)','EventItem constructor/privacy',4),stage('1(a)(ii)','Event getters',3,'auto'),stage('1(b)(i)','Group declaration',1),stage('1(b)(ii)','Five event objects',3),stage('1(c)','Character constructor/getter/privacy',4),stage('1(d)','CalculateScore',4,'auto'),stage('1(e)(i)','Tarz and Geni objects',2),stage('1(e)(ii)','Event and group winners',7),stage('1(e)(iii)','Evidence',1,'evidence')],'''
 class EventItem:
     # EventName,Type: str; Difficulty: int
     def __init__(self,EventName,Type,Difficulty):self.__EventName=EventName;self.__Type=Type;self.__Difficulty=Difficulty
     def GetName(self):return self.__EventName
     def GetDifficulty(self):return self.__Difficulty
     def GetEventType(self):return self.__Type
 class Character:
     # CharacterName: str; Jump,Swim,Run,Drive: int
     def __init__(self,CharacterName,Jump,Swim,Run,Drive):
         self.__CharacterName=CharacterName;self.__Jump=Jump;self.__Swim=Swim;self.__Run=Run;self.__Drive=Drive
     def GetName(self):return self.__CharacterName
     def CalculateScore(self,EventType,Difficulty):
         skill={'jump':self.__Jump,'swim':self.__Swim,'run':self.__Run,'drive':self.__Drive}[EventType]
         return 100 if skill>=Difficulty else 100-20*(Difficulty-skill)
 def main():
     Group=[EventItem('Bridge','jump',3),EventItem('Water wade','swim',4),EventItem('100 mile run','run',5),EventItem('Gridlock','drive',2),EventItem('Wall on wall','jump',4)]
     Tarz=Character('Tarz',5,3,5,1);Geni=Character('Geni',2,2,3,4)
     scores=[0,0]
     for event in Group:
         a=Tarz.CalculateScore(event.GetEventType(),event.GetDifficulty());b=Geni.CalculateScore(event.GetEventType(),event.GetDifficulty())
         if a>b:scores[0]+=1;print(Tarz.GetName(),'wins',event.GetName())
         elif b>a:scores[1]+=1;print(Geni.GetName(),'wins',event.GetName())
         else:print(event.GetName(),'is a draw')
     if scores[0]==scores[1]:print('The group is a draw')
     else:
         winner=0 if scores[0]>scores[1] else 1
         print([Tarz,Geni][winner].GetName(),'wins the group with',scores[winner],'points')
 if __name__ == '__main__':main()
 ''',{
 '1_aii':[case('bridge-getters',"e=candidate.EventItem('Bridge','jump',3);print(e.GetName(),e.GetEventType(),e.GetDifficulty())",'Bridge jump 3\n'),case('water-getters',"e=candidate.EventItem('Water wade','swim',4);print(e.GetName(),e.GetEventType(),e.GetDifficulty())",'Water wade swim 4\n',False)],
 '1_d':[case('example-score',"c=candidate.Character('Geni',2,2,3,4);print(c.CalculateScore('run',5))",'60\n'),case('all-types',"c=candidate.Character('A',1,2,3,4)\nprint(*[c.CalculateScore(t,5) for t in ['jump','swim','run','drive']])\nprint(c.CalculateScore('drive',4),c.CalculateScore('drive',1))",'20 40 60 80\n100 100\n',False)]})
 # Record fields in the QP use lower-case p while its examples also use HeadPointer.
 # A proxy keeps both spellings equivalent without imposing a record constructor.
 setup=code('''
 class QueueProxy:
     def __init__(self):self.QueueArray=[-1]*100;self.Headpointer=-1;self.Tailpointer=0
     def __getattr__(self,name):
         if name=='HeadPointer':return self.Headpointer
         if name=='TailPointer':return self.Tailpointer
         raise AttributeError(name)
     def __setattr__(self,name,value):
         if name=='HeadPointer':name='Headpointer'
         if name=='TailPointer':name='Tailpointer'
         object.__setattr__(self,name,value)
 candidate.TheQueue=QueueProxy()
 def value(result):
     return result[-1] if isinstance(result,tuple) else result
 def enqueue(n):return value(candidate.Enqueue(candidate.TheQueue,n))
 def queuecall(name):
     import inspect
     fn=getattr(candidate,name)
     result=fn() if not inspect.signature(fn).parameters else fn(candidate.TheQueue)
     return value(result)
 ''')
 q2=question('Q2','A linear queue record','''## 2(a) Queue record (3)
Declare record/class `Queue` containing `QueueArray` for 100 integers, `Headpointer` (first occupied index), `Tailpointer` (next free index), with type declaration comments.
## 2(b) Initial record (3)
Main creates `TheQueue`; fill QueueArray with -1, set Headpointer=-1 and Tailpointer=0.
## 2(c) Enqueue (5)
`Enqueue(AQueue,TheData)` inserts TheData. If Headpointer=-1 store at Tailpointer, set Headpointer=0, increment Tailpointer, return 1. Otherwise return -1 if Tailpointer>99, or insert and increment Tailpointer then return 1. Python may return the updated record along with the integer status.
## 2(d) ReturnAllData (3)
`ReturnAllData()` accesses TheQueue (or takes the record as a parameter), concatenates the occupied integer values from head to tail into a space-separated string and returns it. Do not remove or change data.
## 2(e) Main input
(i) Repeatedly input each of ten integers until it is at least 0, enqueue each valid value, and output a suitable full/added message based on its result. After the ten items output ReturnAllData. (5)
(ii) Test with 10,9,-1,8,7,6,5,4,3,2,1 and retain output. (2)
## 2(f) Dequeue (4)
`Dequeue()` accesses TheQueue (or takes it as a parameter), returns -1 when empty, otherwise returns the item at head and updates head. Do not delete or replace the data in the array. Python may return the updated record together with the data.
## 2(g)
(i) Main calls Dequeue twice and each time outputs `Queue empty` on -1, or outputs the return value. Then call ReturnAllData again and output it. (3)
(ii) Test with 10,9,8,7,6,5,4,3,2,1 and retain output. (1)''',[
 stage('2(a)','Queue record fields',3),stage('2(b)','TheQueue initialisation',3),stage('2(c)','Enqueue',5,'auto'),stage('2(d)','ReturnAllData',3,'auto'),stage('2(e)(i)','Validated ten inputs',5),stage('2(e)(ii)','Input evidence',2,'evidence'),stage('2(f)','Dequeue',4,'auto'),stage('2(g)(i)','Two dequeues and remaining values',3),stage('2(g)(ii)','Evidence',1,'evidence')],'''
 class Queue:
     # QueueArray: list[int]; Headpointer,Tailpointer: int
     def __init__(self):self.QueueArray=[-1]*100;self.Headpointer=-1;self.Tailpointer=0
 TheQueue=Queue()
 def Enqueue(AQueue,TheData):
     if AQueue.Headpointer==-1:
         AQueue.QueueArray[AQueue.Tailpointer]=TheData;AQueue.Headpointer=0;AQueue.Tailpointer+=1;return 1
     if AQueue.Tailpointer>99:return -1
     AQueue.QueueArray[AQueue.Tailpointer]=TheData;AQueue.Tailpointer+=1;return 1
 def ReturnAllData(AQueue):
     if AQueue.Headpointer==-1:return ''
     return ' '.join(str(AQueue.QueueArray[i]) for i in range(AQueue.Headpointer,AQueue.Tailpointer))
 def Dequeue(AQueue):
     if AQueue.Headpointer==-1 or AQueue.Headpointer>=AQueue.Tailpointer:return -1
     data=AQueue.QueueArray[AQueue.Headpointer];AQueue.Headpointer+=1;return data
 def main():
     global TheQueue
     TheQueue=Queue()
     for _ in range(10):
         number=-1
         while number<0:
             try:number=int(input('Non-negative integer: '))
             except ValueError:number=-1
         print('Queue full' if Enqueue(TheQueue,number)==-1 else 'Item added')
     print(ReturnAllData(TheQueue))
     for _ in range(2):
         data=Dequeue(TheQueue);print('Queue empty' if data==-1 else data)
     print(ReturnAllData(TheQueue))
 if __name__ == '__main__':main()
 ''',{
 '2_c':[case('enqueue-first',setup+"print(enqueue(10),candidate.TheQueue.Headpointer,candidate.TheQueue.Tailpointer,candidate.TheQueue.QueueArray[0])",'1 0 1 10\n'),case('queue-capacity',setup+"results=[enqueue(i) for i in range(101)]\nprint(results.count(1),results[-1],candidate.TheQueue.Tailpointer,candidate.TheQueue.QueueArray[-1])",'100 -1 100 99\n',False)],
 '2_d':[case('joined-values',setup+"for n in [10,9,8]:enqueue(n)\nprint(str(queuecall('ReturnAllData')).strip())\nprint(candidate.TheQueue.Headpointer,candidate.TheQueue.Tailpointer)",'10 9 8\n0 3\n'),case('head-offset',setup+"for n in [10,9,8,7]:enqueue(n)\ncandidate.TheQueue.Headpointer=2\nprint(str(queuecall('ReturnAllData')).strip())",'8 7\n',False)],
 '2_f':[case('two-removals',setup+"for n in [10,9,8]:enqueue(n)\nprint(queuecall('Dequeue'),queuecall('Dequeue'))\nprint(candidate.TheQueue.QueueArray[0],candidate.TheQueue.QueueArray[1],candidate.TheQueue.Headpointer)",'10 9\n10 9 2\n'),case('empty-return',setup+"print(queuecall('Dequeue'))\nenqueue(0);print(queuecall('Dequeue'),queuecall('Dequeue'))",'-1\n0 -1\n',False)]})
 q3=question('Q3','A high-score table sorted by two keys','''`HighScoreTable.txt` stores seven player records, each on three lines: player ID, game level, score. All items are read as strings.
## 3(a) Declare local 7-by-3 string array `HighScores` in main; initialise every entry to an empty string. (2)
## 3(b) ReadData (5)
`ReadData()` reads the file into a 2D array and returns it. Use exception handling when opening and reading the file.
## 3(c) OutputHighScores (2)
`OutputHighScores(array)` outputs records in array order, each in the format `GHEH reached level 3 with a score of 10`.
## 3(d) SortScores (4)
`SortScores(array)` uses bubble sort and returns the array sorted by game level descending, and within the same level by score descending. Compare numeric values although fields remain strings.
## 3(e) Main program
(i) Call ReadData into HighScores; output `Before`, call OutputHighScores; call SortScores into HighScores; output `After`, call OutputHighScores. (2)
(ii) Run and retain output. (2)''',[
 stage('3(a)','Local string array',2),stage('3(b)','ReadData and exception handling',5,'auto'),stage('3(c)','OutputHighScores',2,'auto'),stage('3(d)','SortScores two numeric keys',4,'auto'),stage('3(e)(i)','Before/After main output',2),stage('3(e)(ii)','Evidence',2,'evidence')],'''
 def ReadData():
     scores=[['']*3 for _ in range(7)]
     try:
         with open('HighScoreTable.txt') as f:
             for row in range(7):
                 for col in range(3):scores[row][col]=f.readline().strip()
     except OSError:print('Unable to read high score table')
     return scores
 def OutputHighScores(HighScores):
     for player,level,score in HighScores:print(player,'reached level',level,'with a score of',score)
 def SortScores(HighScores):
     for x in range(len(HighScores)-1):
         for y in range(len(HighScores)-x-1):
             a=HighScores[y];b=HighScores[y+1]
             if int(a[1])<int(b[1]) or (int(a[1])==int(b[1]) and int(a[2])<int(b[2])):
                 HighScores[y],HighScores[y+1]=b,a
     return HighScores
 def main():
     HighScores=[['']*3 for _ in range(7)]
     HighScores=ReadData();print('Before');OutputHighScores(HighScores)
     HighScores=SortScores(HighScores);print('After');OutputHighScores(HighScores)
 if __name__ == '__main__':main()
 ''',{
 '3_b':[case('original-table',"a=candidate.ReadData();print(len(a),*a[0],*a[-1]);print(all(isinstance(v,str) for r in a for v in r))",'7 GHEH 3 10 JGHF 5 22\nTrue\n'),case('read-as-strings',"a=candidate.ReadData();print(*a[0],*a[-1]);print(all(isinstance(v,str) for r in a for v in r))",'A 10 2 G 2 100\nTrue\n',False,{'HighScoreTable.txt':'A\n10\n2\nB\n2\n9\nC\n2\n8\nD\n2\n7\nE\n2\n6\nF\n2\n5\nG\n2\n100\n'})],
 '3_c':[case('formatted-player',"candidate.OutputHighScores(candidate.ReadData())",'GHEH reached level 3 with a score of 10\nKWQW reached level 4 with a score of 20\nMMND reached level 4 with a score of 18\nRFOO reached level 5 with a score of 20\nXXHD reached level 3 with a score of 19\nQWSD reached level 3 with a score of 15\nJGHF reached level 5 with a score of 22\n'),case('array-order',"candidate.OutputHighScores(list(reversed(candidate.ReadData())))",'JGHF reached level 5 with a score of 22\nQWSD reached level 3 with a score of 15\nXXHD reached level 3 with a score of 19\nRFOO reached level 5 with a score of 20\nMMND reached level 4 with a score of 18\nKWQW reached level 4 with a score of 20\nGHEH reached level 3 with a score of 10\n',False)],
 '3_d':[case('original-sort',"a=candidate.ReadData();a=candidate.SortScores(a)\nprint(*[r[0] for r in a])",'JGHF RFOO KWQW MMND XXHD QWSD GHEH\n'),case('numeric-order',"a=[['AAAA','2','100'],['BBBB','10','1'],['CCCC','2','9'],['DDDD','2','20'],['EEEE','1','1000'],['FFFF','5','8'],['GGGG','2','2']]\na=candidate.SortScores(a);print(*[r[0] for r in a]);print(all(isinstance(v,str) for r in a for v in r))",'BBBB FFFF AAAA DDDD CCCC GGGG EEEE\nTrue\n',False)]},f)
 return [q1,q2,q3]

BUILDERS={'s41':summer41,'s43':summer41,'s42':summer42,'w41':autumn41,'w43':autumn41,'w42':autumn42}
def build_all(directory):
 sources=json.loads((directory/'sources.json').read_text())
 for src in sources:
     manifest=assemble(src,BUILDERS[src['key'][5]+src['variant']](src))
     (directory/(src['key']+'.json')).write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
 print('Built',len(sources),'papers without executing candidate or reference programs.')
if __name__=='__main__':build_all(Path(__file__).resolve().parent)
