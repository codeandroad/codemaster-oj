from common import *

def summer41(src):
 f=src['files']['sf']['textFiles']
 q1=question('Q1','File data and frequency search','''A program reads 25 integers from `Data.txt` and searches them.

## 1(a) Read the data
(i) Declare a local integer array `DataArray` for 25 values. (1)
(ii) Read all 25 integers from `Data.txt` into it. (4)

## 1(b) Print the data
(i) Write `PrintArray(array)` to output its items on the same line, in stored order; for example `10 4 5 13 25`. (3)
(ii) Call it from the main program with `DataArray`. (1)
(iii) Run the program and retain its output. (1)

## 1(c) Count matches
Write `LinearSearch(array, searchValue)`, returning the number of occurrences of the integer search value. (3)

## 1(d) Finish the main program
(i) Prompt for a whole number, validate that it is in 0 to 100 inclusive, call `LinearSearch` and output in this format: `The number 7 is found 2 times.` (4)
(ii) Test with 12 and retain the output. (1)''',[
 stage('1(a)(i)','Local array',1),stage('1(a)(ii)','Read 25 integers',4),stage('1(b)(i)','PrintArray',3,'auto'),stage('1(b)(ii)','Print main array',1),stage('1(b)(iii)','Initial run',1,'evidence'),stage('1(c)','LinearSearch',3,'auto'),stage('1(d)(i)','Validated search main program',4),stage('1(d)(ii)','Search 12 evidence',1,'evidence')],'''
 def PrintArray(DataArray):
     print(*DataArray)
 def LinearSearch(DataArray, SearchValue):
     total = 0
     for value in DataArray:
         if value == SearchValue:
             total += 1
     return total
 def main():
     DataArray = [0] * 25
     with open('Data.txt') as source:
         for i in range(25):
             DataArray[i] = int(source.readline())
     PrintArray(DataArray)
     while True:
         try:
             value = int(input('Enter a whole number from 0 to 100: '))
             if 0 <= value <= 100:
                 break
         except ValueError:
             pass
     print(f'The number {value} is found {LinearSearch(DataArray, value)} times.')
 if __name__ == '__main__': main()
 ''',{'1_bi':[case('array-example',f"candidate.PrintArray({[int(x) for x in f['Data.txt'].splitlines()]!r})",' '.join(f['Data.txt'].splitlines())+'\n'),case('array-boundary',"candidate.PrintArray([0,100,0,100]+[7]*21)",'0 100 0 100 '+' '.join(['7']*21)+'\n',False)],'1_c':[case('search-12',f"print(candidate.LinearSearch({[int(x) for x in f['Data.txt'].splitlines()]!r},12))",'4\n'),case('search-boundaries','a=[0,100,0,100,0]+[50]*20\nprint(candidate.LinearSearch(a,0),candidate.LinearSearch(a,100),candidate.LinearSearch(a,99))','3 2 0\n',False)]},{'Data.txt':f['Data.txt']})
 q2=question('Q2','Vehicles and helicopters','''A game prototype uses object oriented programming.

## 2(a) Vehicle
(i) Declare `Vehicle(ID, MaxSpeed, IncreaseAmount)` with private attributes `ID: str`, `MaxSpeed: int`, `CurrentSpeed: int`, `IncreaseAmount: int`, `HorizontalPosition: int`. Set ID, maximum speed and increase amount from the constructor parameters, and current speed and horizontal position to 0. Include attribute declaration comments. (5)
(ii) Implement `GetCurrentSpeed()`, `GetIncreaseAmount()`, `GetMaxSpeed()` and `GetHorizontalPosition()`. (3)
(iii) Implement `SetCurrentSpeed(value)` and `SetHorizontalPosition(value)` to assign their attributes. (3)
(iv) `IncreaseSpeed()` adds IncreaseAmount to current speed, limiting it to MaxSpeed, then adds the updated speed to horizontal position. (3)

## 2(b) Helicopter
(i) Declare child class `Helicopter(ID, MaxSpeed, IncreaseAmount, VerticalChange, MaxHeight)`. Add private integer attributes `VerticalPosition`, `VerticalChange`, `MaxHeight`; vertical position starts at 0. Initialise the inherited values through the parent constructor. Include `GetVerticalPosition()` as shown in the class interface. (5)
(ii) Override `IncreaseSpeed()` to add VerticalChange to vertical position, capped at MaxHeight, and update speed and horizontal position using the Vehicle rules. (4)

## 2(c) Output
Write a procedure with a name of your choice that outputs a vehicle's speed and horizontal position, with suitable messages. For a helicopter, also output vertical position. (3)

## 2(d) Main program
(i) Create car `Vehicle("Tiger",100,20)` and helicopter `Helicopter("Lion",350,40,3,100)`. Increase the car's speed twice and output its details. Increase the helicopter's speed twice and output its details. (5)
(ii) Run the program and retain the output. (1)''',[
 stage('2(a)(i)','Vehicle constructor and privacy',5),stage('2(a)(ii)','Vehicle getters',3,'auto'),stage('2(a)(iii)','Vehicle setters',3,'auto'),stage('2(a)(iv)','Vehicle speed update',3,'auto'),stage('2(b)(i)','Helicopter constructor and inheritance',5),stage('2(b)(ii)','Helicopter speed update',4,'auto'),stage('2(c)','Output procedure',3),stage('2(d)(i)','Required main program',5),stage('2(d)(ii)','Run evidence',1,'evidence')],'''
 class Vehicle:
     # ID: str; MaxSpeed, CurrentSpeed, IncreaseAmount, HorizontalPosition: int
     def __init__(self, ID, MaxSpeed, IncreaseAmount):
         self.__ID=ID
         self.__MaxSpeed=MaxSpeed
         self.__IncreaseAmount=IncreaseAmount
         self.__CurrentSpeed=0
         self.__HorizontalPosition=0
     def GetCurrentSpeed(self): return self.__CurrentSpeed
     def GetIncreaseAmount(self): return self.__IncreaseAmount
     def GetMaxSpeed(self): return self.__MaxSpeed
     def GetHorizontalPosition(self): return self.__HorizontalPosition
     def SetCurrentSpeed(self,value): self.__CurrentSpeed=value
     def SetHorizontalPosition(self,value): self.__HorizontalPosition=value
     def IncreaseSpeed(self):
         self.__CurrentSpeed=min(self.__MaxSpeed,self.__CurrentSpeed+self.__IncreaseAmount)
         self.__HorizontalPosition+=self.__CurrentSpeed
 class Helicopter(Vehicle):
     # VerticalPosition, VerticalChange, MaxHeight: int
     def __init__(self, ID, MaxSpeed, IncreaseAmount, VerticalChange, MaxHeight):
         super().__init__(ID,MaxSpeed,IncreaseAmount)
         self.__VerticalPosition=0
         self.__VerticalChange=VerticalChange
         self.__MaxHeight=MaxHeight
     def GetVerticalPosition(self): return self.__VerticalPosition
     def IncreaseSpeed(self):
         self.__VerticalPosition=min(self.__MaxHeight,self.__VerticalPosition+self.__VerticalChange)
         super().IncreaseSpeed()
 def OutputVehicle(vehicle):
     print('Horizontal position',vehicle.GetHorizontalPosition(),'speed',vehicle.GetCurrentSpeed())
     if isinstance(vehicle,Helicopter): print('Vertical position',vehicle.GetVerticalPosition())
 def main():
     car=Vehicle('Tiger',100,20)
     helicopter=Helicopter('Lion',350,40,3,100)
     car.IncreaseSpeed(); car.IncreaseSpeed(); OutputVehicle(car)
     helicopter.IncreaseSpeed(); helicopter.IncreaseSpeed(); OutputVehicle(helicopter)
 if __name__ == '__main__': main()
 ''',{
 '2_aii':[case('tiger-getters',"v=candidate.Vehicle('Tiger',100,20)\nprint(v.GetCurrentSpeed(),v.GetIncreaseAmount(),v.GetMaxSpeed(),v.GetHorizontalPosition())",'0 20 100 0\n'),case('distinct-getters',"v=candidate.Vehicle('Slow',7,3)\nprint(v.GetMaxSpeed(),v.GetIncreaseAmount())",'7 3\n',False)],
 '2_aiii':[case('set-values',"v=candidate.Vehicle('T',100,20)\nv.SetCurrentSpeed(17);v.SetHorizontalPosition(38)\nprint(v.GetCurrentSpeed(),v.GetHorizontalPosition())",'17 38\n'),case('reset-values',"v=candidate.Vehicle('T',100,20)\nv.SetCurrentSpeed(17);v.SetHorizontalPosition(38)\nv.SetCurrentSpeed(0);v.SetHorizontalPosition(0)\nprint(v.GetCurrentSpeed(),v.GetHorizontalPosition())",'0 0\n',False)],
 '2_aiv':[case('tiger-two',"v=candidate.Vehicle('Tiger',100,20)\nv.IncreaseSpeed();v.IncreaseSpeed()\nprint(v.GetCurrentSpeed(),v.GetHorizontalPosition())",'40 60\n'),case('speed-cap',"v=candidate.Vehicle('T',25,20)\nfor _ in range(4):v.IncreaseSpeed()\nprint(v.GetCurrentSpeed(),v.GetHorizontalPosition())",'25 95\n',False)],
 '2_bii':[case('lion-two',"v=candidate.Helicopter('Lion',350,40,3,100)\nv.IncreaseSpeed();v.IncreaseSpeed()\nprint(v.GetCurrentSpeed(),v.GetHorizontalPosition(),v.GetVerticalPosition())",'80 120 6\n'),case('height-speed-caps',"v=candidate.Helicopter('H',50,30,4,7)\nfor _ in range(4):v.IncreaseSpeed()\nprint(v.GetCurrentSpeed(),v.GetHorizontalPosition(),v.GetVerticalPosition())",'50 180 7\n',False)]})
 setup="candidate.Animal=['']*20\ncandidate.Colour=['']*10\ncandidate.AnimalTopPointer=0\ncandidate.ColourTopPointer=0\n"
 q3=question('Q3','Animal and colour stacks','''Implement two global stacks with next-free pointers initially 0: `Animal` holds up to 20 animal names and `Colour` holds up to 10 colour names; the pointers are `AnimalTopPointer` and `ColourTopPointer`.

## 3(a) Declare the arrays and pointers. (3)

## 3(b) Stack operations and file input
(i) `PushAnimal(DataToPush)` returns False without changing the stack when its pointer is 20; otherwise store at the pointer, increment it and return True. (3)
(ii) `PopAnimal()` returns `""` when empty; otherwise return the top item and decrement the pointer. (3)
(iii) `ReadData()` reads `AnimalData.txt` and inserts each name with `PushAnimal`; handle a missing file with an appropriate exception handler. (5)
(iv) Implement `PushColour` and `PopColour` with the same rules, but capacity 10. (2)
(v) Extend `ReadData()` to read `ColourData.txt` using `PushColour`, also handling a missing file. (2)

## 3(c) OutputItem (5)
`OutputItem()` pops one animal and one colour and prints `colour animal` on one line, for example `black horse`. If there is no colour, restore the popped animal to its stack and output `No colour`. If there is no animal, restore the popped colour and output `No animal`.

## 3(d) Main program
(i) Call `ReadData()` then `OutputItem()` four times. (1)
(ii) Run the program and retain its output. (1)''',[
 stage('3(a)','Stack initialisation',3),stage('3(b)(i)','PushAnimal',3,'auto'),stage('3(b)(ii)','PopAnimal',3,'auto'),stage('3(b)(iii)','Read animal file and exception handling',5),stage('3(b)(iv)','Colour stack functions',2,'auto'),stage('3(b)(v)','Read colour file and exception handling',2),stage('3(c)','Output and rollback',5,'auto'),stage('3(d)(i)','Read and output four items',1),stage('3(d)(ii)','Run evidence',1,'evidence')],'''
 Animal=['']*20
 Colour=['']*10
 AnimalTopPointer=0
 ColourTopPointer=0
 def PushAnimal(DataToPush):
     global AnimalTopPointer
     if AnimalTopPointer==20:return False
     Animal[AnimalTopPointer]=DataToPush
     AnimalTopPointer+=1
     return True
 def PopAnimal():
     global AnimalTopPointer
     if AnimalTopPointer==0:return ''
     AnimalTopPointer-=1
     return Animal[AnimalTopPointer]
 def PushColour(DataToPush):
     global ColourTopPointer
     if ColourTopPointer==10:return False
     Colour[ColourTopPointer]=DataToPush
     ColourTopPointer+=1
     return True
 def PopColour():
     global ColourTopPointer
     if ColourTopPointer==0:return ''
     ColourTopPointer-=1
     return Colour[ColourTopPointer]
 def ReadData():
     try:
         with open('AnimalData.txt') as f:
             for line in f:PushAnimal(line.strip())
     except OSError:print('Animal file not found')
     try:
         with open('ColourData.txt') as f:
             for line in f:PushColour(line.strip())
     except OSError:print('Colour file not found')
 def OutputItem():
     animal=PopAnimal();colour=PopColour()
     if colour=='':
         if animal!='':PushAnimal(animal)
         print('No colour')
     elif animal=='':
         PushColour(colour);print('No animal')
     else:print(colour,animal)
 def main():
     ReadData()
     for _ in range(4):OutputItem()
 if __name__ == '__main__':main()
 ''',{
 '3_bi':[case('push-one',setup+"print(candidate.PushAnimal('horse'),candidate.Animal[0],candidate.AnimalTopPointer)",'True horse 1\n'),case('push-full',setup+"print(sum(candidate.PushAnimal('horse') for i in range(22)),candidate.AnimalTopPointer)",'20 20\n',False)],
 '3_bii':[case('pop-lifo',setup+"candidate.PushAnimal('horse');candidate.PushAnimal('lion')\nprint(candidate.PopAnimal(),candidate.PopAnimal(),candidate.AnimalTopPointer)",'lion horse 0\n'),case('pop-empty',setup+"print(repr(candidate.PopAnimal()),candidate.AnimalTopPointer)","'' 0\n",False)],
 '3_biv':[case('colours-lifo',setup+"candidate.PushColour('red');candidate.PushColour('blue')\nprint(candidate.PopColour(),candidate.PopColour(),repr(candidate.PopColour()),candidate.ColourTopPointer)","blue red '' 0\n"),case('colour-capacity',setup+"print(sum(candidate.PushColour(name) for name in ['red','green','black','grey','orange','purple','yellow','white','blue','pink','red','blue']),candidate.ColourTopPointer)\nprint(candidate.PopColour())",'10 10\npink\n',False)],
 '3_c':[case('pair-output',setup+"candidate.PushAnimal('horse');candidate.PushColour('black');candidate.OutputItem()\nprint(candidate.AnimalTopPointer,candidate.ColourTopPointer)",'black horse\n0 0\n'),case('rollback-animal',setup+"candidate.PushAnimal('horse');candidate.OutputItem()\nprint(candidate.PopAnimal())",'No colour\nhorse\n',False),case('rollback-colour',setup+"candidate.PushColour('red');candidate.OutputItem()\nprint(candidate.PopColour())",'No animal\nred\n',False)]},{k:f[k] for k in ('AnimalData.txt','ColourData.txt')})
 return [q1,q2,q3]

def summer42(src):
 f=src['files']['sf']['textFiles']
 animals=['horse','lion','rabbit','mouse','bird','deer','whale','elephant','kangaroo','tiger']
 q1=question('Q1','Sort animal names','''## 1(a) Declare `Animals`, a global string array for 10 items. (2)
## 1(b) Store these lower-case names in this order: horse, lion, rabbit, mouse, bird, deer, whale, elephant, kangaroo, tiger. (2)
## 1(c) SortDescending (6)
Complete a bubble-sort procedure `SortDescending()` that sorts the array in descending alphabetical order using **only the first character** of each name. Use adjacent comparisons: for each pass X, compare Animals[Y] and Animals[Y+1] with Y starting at 0 and ending before `len(Animals)-X-1`. Swap when the first character of Animals[Y] is less than that of Animals[Y+1].
## 1(d)
(i) Call `SortDescending()` in the main program, then output every animal on a separate line. (3)
(ii) Run the program and retain the output. (1)''',[
 stage('1(a)','Array declaration',2),stage('1(b)','Original animal data',2),stage('1(c)','Descending first-character bubble sort',6,'auto'),stage('1(d)(i)','Main sort and output',3),stage('1(d)(ii)','Evidence',1,'evidence')],f'''
 Animals={animals!r}
 def SortDescending():
     for X in range(len(Animals)):
         for Y in range(len(Animals)-X-1):
             if Animals[Y][0]<Animals[Y+1][0]:
                 Animals[Y],Animals[Y+1]=Animals[Y+1],Animals[Y]
 def main():
     SortDescending()
     for animal in Animals:print(animal)
 if __name__ == '__main__':main()
 ''',{'1_c':[case('animals',f"candidate.Animals={animals!r}\ncandidate.SortDescending()\nprint(*candidate.Animals)",'whale tiger rabbit mouse lion kangaroo horse elephant deer bird\n'),case('first-character-only',"candidate.Animals=['ant','ape','zebra','bear','bee','cat','cow','dog','deer','yak']\ncandidate.SortDescending()\nprint(*candidate.Animals)",'zebra yak dog deer cat cow bear bee ant ape\n',False)]})
 setup="candidate.CircularQueue=[candidate.SaleData('',-1) for _ in range(5)]\ncandidate.Head=0;candidate.Tail=0;candidate.NumberOfItems=0\n"
 q2=question('Q2','Sales in a circular queue','''## 2(a) Declare record/class `SaleData` with string field `ID` and integer field `Quantity`. (2)
## 2(b) Initialise `CircularQueue`, a global 5-item array of SaleData, to empty records (`ID=""`, `Quantity=-1`). Initialise globals `Head`, `Tail`, `NumberOfItems` to 0. (4)
## 2(c) Enqueue (6)
`Enqueue(record)` inserts at Tail, updates the circular pointers and count and returns 1; return -1 without changing the queue when full.
## 2(d) Dequeue (6)
`Dequeue()` returns an empty record if empty; otherwise remove and return the first record, updating pointers and count.
## 2(e) EnterRecord (5)
`EnterRecord()` inputs an ID and quantity, creates a sale record and calls Enqueue. Output `Full` on failure and `Stored` on success.
## 2(f) Main program
(i) Use EnterRecord to enter, in order: ADF/10, OOP/1, BXW/5, XXZ/22, HQR/6, LLP/3. Dequeue once and output the removed ID and quantity, or an empty-queue error. Enter LLP/3 again. Output the ID and quantity of every record currently in the physical CircularQueue array. (4)
(ii) Run with these records and retain the output. (1)''',[
 stage('2(a)','SaleData record',2),stage('2(b)','Circular queue state',4),stage('2(c)','Enqueue',6,'auto'),stage('2(d)','Dequeue',6,'auto'),stage('2(e)','Input and enqueue messages',5),stage('2(f)(i)','Original record sequence',4),stage('2(f)(ii)','Evidence',1,'evidence')],'''
 class SaleData:
     # ID: str; Quantity: int
     def __init__(self,ID='',Quantity=-1):self.ID=ID;self.Quantity=Quantity
 CircularQueue=[SaleData() for _ in range(5)]
 Head=0
 Tail=0
 NumberOfItems=0
 def Enqueue(record):
     global Tail,NumberOfItems
     if NumberOfItems==5:return -1
     CircularQueue[Tail]=record;Tail=(Tail+1)%5;NumberOfItems+=1
     return 1
 def Dequeue():
     global Head,NumberOfItems
     if NumberOfItems==0:return SaleData()
     result=CircularQueue[Head];Head=(Head+1)%5;NumberOfItems-=1
     return result
 def EnterRecord():
     record=SaleData(input('ID: '),int(input('Quantity: ')))
     print('Stored' if Enqueue(record)==1 else 'Full')
 def main():
     for _ in range(6):EnterRecord()
     record=Dequeue()
     if record.ID=='':print('Queue empty')
     else:print(record.ID,record.Quantity)
     EnterRecord()
     for record in CircularQueue:print(record.ID,record.Quantity)
 if __name__ == '__main__':main()
 ''',{
 '2_c':[case('store-sale',setup+"print(candidate.Enqueue(candidate.SaleData('ADF',10)))\nprint(candidate.CircularQueue[0].ID,candidate.CircularQueue[0].Quantity,candidate.Tail,candidate.NumberOfItems)",'1\nADF 10 1 1\n'),case('full-wrap',setup+"print(*[candidate.Enqueue(candidate.SaleData(str(i),i+1)) for i in range(6)])\nprint(candidate.Tail,candidate.NumberOfItems)",'1 1 1 1 1 -1\n0 5\n',False)],
 '2_d':[case('first-sale',setup+"candidate.Enqueue(candidate.SaleData('ADF',10));candidate.Enqueue(candidate.SaleData('OOP',1))\nr=candidate.Dequeue();print(r.ID,r.Quantity,candidate.Head,candidate.NumberOfItems)",'ADF 10 1 1\n'),case('empty-sale',setup+"r=candidate.Dequeue();print(repr(r.ID),r.Quantity,candidate.NumberOfItems)","'' -1 0\n",False),case('reuse-slots',setup+"for i in range(5):candidate.Enqueue(candidate.SaleData(str(i),i+1))\nfor _ in range(3):candidate.Dequeue()\nfor i in range(5,8):candidate.Enqueue(candidate.SaleData(str(i),i+1))\nprint(*[candidate.Dequeue().Quantity for _ in range(5)])",'4 5 6 7 8\n',False)]})
 q3=question('Q3','Employees and weekly pay','''## 3(a) Employee
(i) Declare `Employee` with a constructor taking hourly pay, employee number and job title with attributes of real, string, string types and real array `PayYear2022[0:51]`, initialised to 52 zeroes. Include declaration comments. (5)
(ii) `GetEmployeeNumber()` returns the number. (2)
(iii) `SetPay(weekNumber, hours)` stores hourly pay multiplied by hours in the array element for that week (week 1 is the first week). (3)
(iv) `GetTotalPay()` totals all 52 weeks. (2)

## 3(b) Manager
(i) Declare child class `Manager` with a constructor taking bonus value, hourly pay, employee number and job title with additional real BonusValue (a percentage). (4)
(ii) Override `SetPay`: increase hours by BonusValue percent, then call the parent SetPay. (3)

## 3(c) Load employees (7)
Declare global `EmployeeArray` for 8 objects. Read `Employees.txt`: each employee has hourly pay, employee number, optional numeric bonus, then job title, each on its own line. Create Employee if no bonus line exists, or Manager otherwise. Preserve leading zeroes in employee numbers.

## 3(d) EnterHours (4)
`EnterHours()` reads pairs of employee number and hours from `HoursWeek1.txt`; locate each employee in EmployeeArray and call SetPay for week 1.

## 3(e) Main output
(i) Call EnterHours, then output employee number and GetTotalPay for all 8 employees. (2)
(ii) Run and retain output. (1)''',[
 stage('3(a)(i)','Employee constructor',5),stage('3(a)(ii)','Employee number getter',2,'auto'),stage('3(a)(iii)','SetPay',3,'auto'),stage('3(a)(iv)','Annual total',2,'auto'),stage('3(b)(i)','Manager constructor',4),stage('3(b)(ii)','Manager bonus',3,'auto'),stage('3(c)','Read and instantiate eight employees',7),stage('3(d)','Read hours and match employee',4,'auto'),stage('3(e)(i)','Main totals',2),stage('3(e)(ii)','Evidence',1,'evidence')],'''
 class Employee:
     # HourlyPay: float; EmployeeNumber, JobTitle: str; PayYear2022: list[float]
     def __init__(self,HourlyPay,EmployeeNumber,JobTitle):
         self.HourlyPay=HourlyPay;self.EmployeeNumber=EmployeeNumber;self.JobTitle=JobTitle
         self.PayYear2022=[0.0]*52
     def GetEmployeeNumber(self):return self.EmployeeNumber
     def SetPay(self,WeekNumber,Hours):self.PayYear2022[WeekNumber-1]=self.HourlyPay*Hours
     def GetTotalPay(self):return sum(self.PayYear2022)
 class Manager(Employee):
     # BonusValue: float
     def __init__(self,BonusValue,HourlyPay,EmployeeNumber,JobTitle):
         super().__init__(HourlyPay,EmployeeNumber,JobTitle);self.BonusValue=BonusValue
     def SetPay(self,WeekNumber,Hours):
         super().SetPay(WeekNumber,Hours*(1+self.BonusValue/100))
 EmployeeArray=[]
 def EnterHours():
     with open('HoursWeek1.txt') as source:
         lines=[line.strip() for line in source]
     for i in range(0,len(lines),2):
         for employee in EmployeeArray:
             if employee.GetEmployeeNumber()==lines[i]:employee.SetPay(1,float(lines[i+1]))
 def main():
     global EmployeeArray
     EmployeeArray=[]
     with open('Employees.txt') as source:lines=[line.strip() for line in source]
     i=0
     for _ in range(8):
         pay=float(lines[i]);number=lines[i+1];i+=2
         try:bonus=float(lines[i])
         except ValueError:
             employee=Employee(pay,number,lines[i]);i+=1
         else:
             employee=Manager(bonus,pay,number,lines[i+1]);i+=2
         EmployeeArray.append(employee)
     EnterHours()
     for employee in EmployeeArray:print(employee.GetEmployeeNumber(),employee.GetTotalPay())
 if __name__ == '__main__':main()
 ''',{
 '3_aii':[case('number',"print(candidate.Employee(15.22,'12452','Developer').GetEmployeeNumber())",'12452\n'),case('leading-zero',"print(candidate.Employee(22.5,'02586','Manager').GetEmployeeNumber())",'02586\n',False)],
 '3_aiii':[case('week-pay',"e=candidate.Employee(15.22,'A','D');e.SetPay(1,48)\nprint(format(e.GetTotalPay(),'.4f'))",'730.5600\n'),case('replace-week',"e=candidate.Employee(10,'A','D');e.SetPay(1,3);e.SetPay(52,4);e.SetPay(1,2)\nprint(format(e.GetTotalPay(),'.4f'))",'60.0000\n',False)],
 '3_aiv':[case('zero-total',"print(format(candidate.Employee(10,'A','D').GetTotalPay(),'.4f'))",'0.0000\n'),case('several-weeks',"e=candidate.Employee(2.5,'A','D')\nfor w in range(1,53):e.SetPay(w,w)\nprint(format(e.GetTotalPay(),'.4f'))",'3445.0000\n',False)],
 '3_bii':[case('manager-bonus',"e=candidate.Manager(5.25,22.5,'02586','Manager');e.SetPay(1,28.5)\nprint(format(e.GetTotalPay(),'.5f'))",'674.91562\n'),case('bonus-reset',"e=candidate.Manager(10,20,'A','M');e.SetPay(1,10);e.SetPay(52,0)\nprint(format(e.GetTotalPay(),'.4f'))",'220.0000\n',False)],
 '3_d':[case('match-hours',"candidate.EmployeeArray=[candidate.Employee(10,number,'Developer') for number in ['12452','21548','02586','65912','42004','82610','51947','51847']]\ncandidate.EnterHours()\nprint(*[format(e.GetTotalPay(),'.2f') for e in candidate.EmployeeArray])",'480.00 500.00 285.00 380.00 225.00 475.00 510.00 100.00\n'),case('match-manager',"candidate.EmployeeArray=[candidate.Manager(25,10,'02586','Manager')]+[candidate.Employee(3,number,'Developer') for number in ['12452','21548','65912','42004','82610','51947','51847']]\ncandidate.EnterHours()\nprint(*[format(e.GetTotalPay(),'.2f') for e in candidate.EmployeeArray])",'25.00 0.00 0.00 0.00 0.00 0.00 0.00 0.00\n',False,{'HoursWeek1.txt':'12452\n0\n21548\n0\n02586\n2\n65912\n0\n42004\n0\n82610\n0\n51947\n0\n51847\n0\n'})]},f)
 return [q1,q2,q3]

def autumn41(src):
 f=src['files']['sf']['textFiles']
 q1=question('Q1','Iterative and recursive vowel counts','''The lower-case vowels are a, e, i, o, u; upper-case characters are not counted.

## 1(a)
(i) Implement `IterativeVowels(Value)` using iteration: repeatedly inspect the first character, increment a total if it is a vowel, then remove that character from the string. Return the total. (5)
(ii) From the main program output the return value for `"house"`. (2)
(iii) Run and retain output. (1)

## 1(b)
(i) Rewrite the algorithm as recursive function `RecursiveVowels(Value)`. (6)
(ii) From the main program output the return value for `"imagine"`. (1)
(iii) Run and retain output. (1)''',[
 stage('1(a)(i)','Iterative vowel count',5,'auto'),stage('1(a)(ii)','House main call',2),stage('1(a)(iii)','Evidence',1,'evidence'),stage('1(b)(i)','Recursive vowel count',6,'auto'),stage('1(b)(ii)','Imagine main call',1),stage('1(b)(iii)','Evidence',1,'evidence')],'''
 def IterativeVowels(Value):
     Total=0
     for _ in range(len(Value)):
         if Value[0] in 'aeiou':Total+=1
         Value=Value[1:]
     return Total
 def RecursiveVowels(Value):
     if Value=='':return 0
     return int(Value[0] in 'aeiou')+RecursiveVowels(Value[1:])
 def main():
     print(IterativeVowels('house'))
     print(RecursiveVowels('imagine'))
 if __name__ == '__main__':main()
 ''', {k:[case('original-word',f"print(candidate.{fn}('{word}'))",str(n)+'\n'),case('empty-and-case',f"print(candidate.{fn}(''),candidate.{fn}('AEIOU'),candidate.{fn}('aeeiou xyz'))",'0 0 6\n',False)] for k,fn,word,n in [('1_ai','IterativeVowels','house',3),('1_bi','RecursiveVowels','imagine',4)]})
 setup="candidate.Queue=['']*50\ncandidate.HeadPointer=-1;candidate.TailPointer=0\n"
 recordsetup=setup+"candidate.Records=[candidate.RecordData() for _ in range(50)]\ncandidate.NumberRecords=0\n"
 q2=question('Q2','Queue game IDs and count records','''## 2(a) Linear queue
(i) Declare global string array `Queue` of capacity 50, `HeadPointer=-1` (first item), `TailPointer=0` (next free slot). (2)
(ii) `Enqueue(ID)` inserts the string and updates the pointers, or outputs a suitable full message. (4)
(iii) `Dequeue()` returns the next string and updates the pointers; if empty, output a suitable message and return `"Empty"`. (4)

## 2(b) File input (6)
`ReadData()` reads every game ID from `QueueData.txt` and enqueues it.

## 2(c) Frequency records
(i) Declare record/class `RecordData` with fields `ID: str`, `Total: int`; include declaration comments. (2)
(ii) Declare global `Records` with space for 50 records and `NumberRecords=0`. (2)
(iii) `TotalData()` dequeues one ID, searches the occupied Records entries, increments Total if found, or creates a record with Total 1 and increments NumberRecords if new. Preserve first-seen ID order. (5)

## 2(d) OutputRecords (1)
Output each occupied record in the format `ID 1234 Total 4`.

## 2(e) Main program
(i) Call ReadData, call TotalData once per queued item, then call OutputRecords. (2)
(ii) Run with the supplied file and retain output. (1)''',[
 stage('2(a)(i)','Queue declarations',2),stage('2(a)(ii)','Enqueue',4,'auto'),stage('2(a)(iii)','Dequeue',4,'auto'),stage('2(b)','ReadData',6,'auto'),stage('2(c)(i)','RecordData',2),stage('2(c)(ii)','Records state',2),stage('2(c)(iii)','TotalData',5,'auto'),stage('2(d)','OutputRecords',1,'auto'),stage('2(e)(i)','Main processing loop',2),stage('2(e)(ii)','Evidence',1,'evidence')],'''
 Queue=['']*50
 HeadPointer=-1
 TailPointer=0
 def Enqueue(Data):
     global HeadPointer,TailPointer
     if TailPointer==50:print('Queue full');return
     Queue[TailPointer]=Data
     TailPointer+=1
     if HeadPointer==-1:HeadPointer=0
 def Dequeue():
     global HeadPointer
     if HeadPointer==-1 or HeadPointer>=TailPointer:
         print('Queue empty');return 'Empty'
     data=Queue[HeadPointer];HeadPointer+=1
     return data
 def ReadData():
     with open('QueueData.txt') as f:
         for line in f:Enqueue(line.strip())
 class RecordData:
     # ID: str; Total: int
     def __init__(self,ID='',Total=0):self.ID=ID;self.Total=Total
 Records=[RecordData() for _ in range(50)]
 NumberRecords=0
 def TotalData():
     global NumberRecords
     data=Dequeue()
     for i in range(NumberRecords):
         if Records[i].ID==data:Records[i].Total+=1;return
     Records[NumberRecords].ID=data;Records[NumberRecords].Total=1;NumberRecords+=1
 def OutputRecords():
     for i in range(NumberRecords):print('ID',Records[i].ID,'Total',Records[i].Total)
 def main():
     ReadData()
     for _ in range(TailPointer):TotalData()
     OutputRecords()
 if __name__ == '__main__':main()
 ''',{
 '2_aii':[case('insert-first',setup+"candidate.Enqueue('1234')\nprint(candidate.Queue[0],candidate.HeadPointer,candidate.TailPointer)",'1234 0 1\n'),case('capacity-50',setup+"import io,contextlib\nwith contextlib.redirect_stdout(io.StringIO()):\n    for i in range(51):candidate.Enqueue(str(i))\nprint(candidate.TailPointer,candidate.Queue[49])",'50 49\n',False)],
 '2_aiii':[case('fifo',setup+"candidate.Enqueue('A');candidate.Enqueue('B')\nprint(candidate.Dequeue(),candidate.Dequeue())",'A B\n'),case('empty-return',setup+"import contextlib,io\nwith contextlib.redirect_stdout(io.StringIO()):r=candidate.Dequeue()\nprint(r)",'Empty\n',False)],
 '2_b':[case('original-file',setup+"candidate.ReadData()\nprint(candidate.TailPointer,candidate.Queue[0],candidate.Queue[22])",'23 1234 2520\n'),case('changed-file',setup+"candidate.ReadData()\nprint(candidate.TailPointer,*candidate.Queue[:3])",'23 0001 0001 0002\n',False,{'QueueData.txt':'0001\n0001\n0002\n'+'0003\n'*20})],
 '2_ciii':[case('duplicate-ids',recordsetup+"for x in ['A','B','A']:candidate.Enqueue(x)\nfor _ in range(3):candidate.TotalData()\nprint(candidate.NumberRecords)\nfor r in candidate.Records[:candidate.NumberRecords]:print(r.ID,r.Total)",'2\nA 2\nB 1\n'),case('all-distinct',recordsetup+"for x in ['Z','Y','X','W']:candidate.Enqueue(x)\nfor _ in range(4):candidate.TotalData()\nprint(candidate.NumberRecords)\nfor r in candidate.Records[:candidate.NumberRecords]:print(r.ID,r.Total)",'4\nZ 1\nY 1\nX 1\nW 1\n',False)],
 '2_d':[case('format-record',recordsetup+"candidate.Records[0].ID='1234';candidate.Records[0].Total=4;candidate.NumberRecords=1\ncandidate.OutputRecords()",'ID 1234 Total 4\n'),case('active-records-only',recordsetup+"candidate.Records[0].ID='A';candidate.Records[0].Total=2;candidate.Records[1].ID='B';candidate.Records[1].Total=1;candidate.NumberRecords=2\ncandidate.OutputRecords()",'ID A Total 2\nID B Total 1\n',False)]},f)
 q3=question('Q3','Moving characters','''## 3(a) Character
(i) Declare `Character(Name, XPosition, YPosition)` with string name and integer coordinates, initialised from its parameters. Include attribute comments. (4)
(ii) Implement `GetXPosition()` and `GetYPosition()`. (3)
(iii) `SetXPosition(delta)` and `SetYPosition(delta)` **add** their parameter to the coordinate, clamping the result to 0 to 10000 inclusive. (4)
(iv) `Move(direction)` calls the appropriate setter: up adds 10 to Y; down subtracts 10 from Y; left subtracts 10 from X; right adds 10 to X. (4)

## 3(b) Create `Jack=Character("Jack",50,50)`. (2)

## 3(c) BikeCharacter
(i) Declare child class `BikeCharacter(Name,XPosition,YPosition)` calling the parent constructor. (3)
(ii) Override Move to use the same directions but distance 20. (2)

## 3(d) Create `Karla=BikeCharacter("Karla",100,50)`. (1)

## 3(e) Main program
(i) Prompt for and validate the selected character (jack or karla) and direction (up, down, left, right); move the selected character and output a suitable message with the character name and new X and Y values. (5)
(ii) Run separately with `jack right` and `karla down`; retain both outputs. (2)''',[
 stage('3(a)(i)','Character constructor',4),stage('3(a)(ii)','Get coordinates',3,'auto'),stage('3(a)(iii)','Add and clamp coordinates',4,'auto'),stage('3(a)(iv)','Move Character',4,'auto'),stage('3(b)','Jack instance',2),stage('3(c)(i)','Bike inheritance',3),stage('3(c)(ii)','Move BikeCharacter',2,'auto'),stage('3(d)','Karla instance',1),stage('3(e)(i)','Validated selection main program',5),stage('3(e)(ii)','Two runs',2,'evidence')],'''
 class Character:
     # Name: str; XPosition,YPosition: int
     def __init__(self,Name,XPosition,YPosition):self.Name=Name;self.XPosition=XPosition;self.YPosition=YPosition
     def GetXPosition(self):return self.XPosition
     def GetYPosition(self):return self.YPosition
     def SetXPosition(self,Value):self.XPosition=max(0,min(10000,self.XPosition+Value))
     def SetYPosition(self,Value):self.YPosition=max(0,min(10000,self.YPosition+Value))
     def Move(self,Direction):
         if Direction=='up':self.SetYPosition(10)
         elif Direction=='down':self.SetYPosition(-10)
         elif Direction=='left':self.SetXPosition(-10)
         elif Direction=='right':self.SetXPosition(10)
 class BikeCharacter(Character):
     def __init__(self,Name,XPosition,YPosition):super().__init__(Name,XPosition,YPosition)
     def Move(self,Direction):
         if Direction=='up':self.SetYPosition(20)
         elif Direction=='down':self.SetYPosition(-20)
         elif Direction=='left':self.SetXPosition(-20)
         elif Direction=='right':self.SetXPosition(20)
 def main():
     Jack=Character('Jack',50,50);Karla=BikeCharacter('Karla',100,50)
     name=''
     while name not in ['jack','karla']:name=input('Character (jack/karla): ').lower()
     direction=''
     while direction not in ['up','down','left','right']:direction=input('Direction: ').lower()
     player=Jack if name=='jack' else Karla
     player.Move(direction)
     print(name.title()+"'s new position is X =",player.GetXPosition(),'Y =',player.GetYPosition())
 if __name__ == '__main__':main()
 ''',{
 '3_aii':[case('jack-start',"c=candidate.Character('Jack',50,50)\nprint(c.GetXPosition(),c.GetYPosition())",'50 50\n'),case('different-start',"c=candidate.Character('Z',0,10000)\nprint(c.GetXPosition(),c.GetYPosition())",'0 10000\n',False)],
 '3_aiii':[case('add-values',"c=candidate.Character('Jack',50,50);c.SetXPosition(7);c.SetYPosition(-3)\nprint(c.GetXPosition(),c.GetYPosition())",'57 47\n'),case('clamp',"c=candidate.Character('Z',9998,3);c.SetXPosition(9);c.SetYPosition(-9)\nprint(c.GetXPosition(),c.GetYPosition())",'10000 0\n',False)],
 '3_aiv':[case('jack-right',"c=candidate.Character('Jack',50,50);c.Move('right')\nprint(c.GetXPosition(),c.GetYPosition())",'60 50\n'),case('all-directions',"c=candidate.Character('Z',5,9995)\nfor d in ['left','up','right','down']:c.Move(d)\nprint(c.GetXPosition(),c.GetYPosition())",'10 9990\n',False)],
 '3_cii':[case('karla-down',"c=candidate.BikeCharacter('Karla',100,50);c.Move('down')\nprint(c.GetXPosition(),c.GetYPosition())",'100 30\n'),case('bike-clamp',"c=candidate.BikeCharacter('Z',10,9990);c.Move('left');c.Move('up')\nprint(c.GetXPosition(),c.GetYPosition())",'0 10000\n',False)]})
 return [q1,q2,q3]

def autumn42(src):
 f=src['files']['sf']['textFiles']
 setup="candidate.StackVowel=['']*100;candidate.StackConsonant=['']*100\ncandidate.VowelTop=0;candidate.ConsonantTop=0\n"
 q1=question('Q1','Separate vowel and consonant stacks','''## 1(a)
(i) Declare global arrays `StackVowel` and `StackConsonant`, each for 100 letters at indices 0 to 99; include declaration comments. (2)
(ii) Declare next-free pointers `VowelTop=0` and `ConsonantTop=0`. (1)

## 1(b)
(i) `PushData(letter)` pushes lower-case vowels a/e/i/o/u onto StackVowel and other letters onto StackConsonant, updating the appropriate pointer. Output a suitable message if that stack is full; no letter validation is required. (6)
(ii) `ReadData()` reads all 100 lower-case letters from `StackData.txt` and calls PushData for each. Include exception handling for a missing file. (6)

## 1(c) Pop (5)
`PopVowel()` and `PopConsonant()` each return and remove their stack's top item and update its pointer, returning `"No data"` if empty.

## 1(d) Main program
(i) Call ReadData, then repeatedly prompt for vowel or consonant and call the matching pop function. Count only successful letters; output a suitable message for an empty stack. When 5 letters have been returned, output those letters together on one line, for example `abyti`. (6)
(ii) Test with vowel, consonant, consonant, vowel, vowel and retain output. (1)''',[
 stage('1(a)(i)','Arrays',2),stage('1(a)(ii)','Pointers',1),stage('1(b)(i)','PushData routing and capacity',6,'auto'),stage('1(b)(ii)','ReadData and exception handler',6,'auto'),stage('1(c)','Pop functions',5,'auto'),stage('1(d)(i)','Five successful letters',6),stage('1(d)(ii)','Evidence',1,'evidence')],'''
 StackVowel=['']*100
 StackConsonant=['']*100
 VowelTop=0
 ConsonantTop=0
 def PushData(Letter):
     global VowelTop,ConsonantTop
     if Letter in 'aeiou':
         if VowelTop==100:print('Vowel stack full')
         else:StackVowel[VowelTop]=Letter;VowelTop+=1
     else:
         if ConsonantTop==100:print('Consonant stack full')
         else:StackConsonant[ConsonantTop]=Letter;ConsonantTop+=1
 def ReadData():
     try:
         with open('StackData.txt') as f:
             for line in f:PushData(line.strip())
     except OSError:print('File not found')
 def PopVowel():
     global VowelTop
     if VowelTop==0:return 'No data'
     VowelTop-=1;return StackVowel[VowelTop]
 def PopConsonant():
     global ConsonantTop
     if ConsonantTop==0:return 'No data'
     ConsonantTop-=1;return StackConsonant[ConsonantTop]
 def main():
     ReadData();letters=''
     while len(letters)<5:
         choice=input('Vowel or consonant: ').lower()
         if choice=='vowel':value=PopVowel()
         elif choice=='consonant':value=PopConsonant()
         else:continue
         if value=='No data':print('Stack empty')
         else:letters+=value
     print(letters)
 if __name__ == '__main__':main()
 ''',{
 '1_bi':[case('route-letters',setup+"for x in 'abcde':candidate.PushData(x)\nprint(candidate.VowelTop,candidate.ConsonantTop,*candidate.StackVowel[:2],*candidate.StackConsonant[:3])",'2 3 a e b c d\n'),case('full-stack',setup+"import io,contextlib\nwith contextlib.redirect_stdout(io.StringIO()):\n    for _ in range(101):candidate.PushData('a')\n    candidate.PushData('z')\nprint(candidate.VowelTop,candidate.ConsonantTop)",'100 1\n',False)],
 '1_bii':[case('file-routing',setup+"candidate.ReadData()\nprint(candidate.VowelTop,candidate.ConsonantTop)",f"{sum(x in 'aeiou' for x in f['StackData.txt'].splitlines())} {sum(x not in 'aeiou' for x in f['StackData.txt'].splitlines())}\n"),case('changed-file',setup+"candidate.ReadData()\nprint(candidate.VowelTop,candidate.ConsonantTop,*candidate.StackVowel[:2],*candidate.StackConsonant[:2])",'50 50 i o z k\n',False,{'StackData.txt':'i\nz\no\nk\n'*25})],
 '1_c':[case('lifo',setup+"for x in 'abec':candidate.PushData(x)\nprint(candidate.PopVowel(),candidate.PopConsonant(),candidate.PopVowel(),candidate.PopConsonant())",'e c a b\n'),case('empty',setup+"print(candidate.PopVowel(),candidate.PopConsonant(),candidate.VowelTop,candidate.ConsonantTop)",'No data No data 0 0\n',False)]},f)
 q2=question('Q2','Sum divisors iteratively and recursively','''A divisor divides an integer with no remainder: the divisors of 10 are 1,2,5,10 and their total is 18.

## 2(a)
(i) `IterativeCalculate(Number)` stores the original Number in ToFind, starts Total at 0, and while Number is not 0, adds Number when `ToFind % Number == 0`, then decrements Number. Return Total. (5)
(ii) Call it with 10 in the main program and output the result. (2)
(iii) Run and retain output. (1)

## 2(b)
(i) Complete recursive function `RecursiveValue(Number, ToFind)`: return 0 when Number is 0; otherwise return Number plus `RecursiveValue(Number-1, ToFind)` if Number divides ToFind, or just that recursive call if it does not. (7)
(ii) Call it with 50,50 in the main program and output the result. (1)
(iii) Run and retain output. (1)''',[
 stage('2(a)(i)','IterativeCalculate',5,'auto'),stage('2(a)(ii)','Call with 10',2),stage('2(a)(iii)','Evidence',1,'evidence'),stage('2(b)(i)','RecursiveValue',7,'auto'),stage('2(b)(ii)','Call with 50,50',1),stage('2(b)(iii)','Evidence',1,'evidence')],'''
 def IterativeCalculate(Number):
     ToFind=Number;Total=0
     while Number!=0:
         if ToFind%Number==0:Total+=Number
         Number-=1
     return Total
 def RecursiveValue(Number,ToFind):
     if Number==0:return 0
     if ToFind%Number==0:return Number+RecursiveValue(Number-1,ToFind)
     return RecursiveValue(Number-1,ToFind)
 def main():
     print(IterativeCalculate(10));print(RecursiveValue(50,50))
 if __name__ == '__main__':main()
 ''',{
 '2_ai':[case('divisors-ten','print(candidate.IterativeCalculate(10))','18\n'),case('divisor-boundaries','print(candidate.IterativeCalculate(0),candidate.IterativeCalculate(1),candidate.IterativeCalculate(13),candidate.IterativeCalculate(36))','0 1 14 91\n',False)],
 '2_bi':[case('divisors-fifty','print(candidate.RecursiveValue(50,50))','93\n'),case('recursive-boundaries','print(candidate.RecursiveValue(0,10),candidate.RecursiveValue(1,1),candidate.RecursiveValue(5,10))','0 1 8\n',False)]})
 q3=question('Q3','Learning characters and magic elements','''## 3(a) Character
(i) Declare `Character(CharacterName, DateOfBirth, Intelligence, Speed)` with string name, date of birth, real intelligence, integer speed, initialised from constructor parameters. Include declaration comments. (5)
(ii) `GetIntelligence()` and `GetName()` return the attributes. (3)
(iii) `SetIntelligence(value)` assigns the intelligence. (2)
(iv) `Learn()` increases intelligence by 10%. (1)
(v) `ReturnAge()` returns integer `2023 - birth year`; ignore month and day and keep the paper's fixed year 2023. (2)

## 3(b)
(i) Create FirstCharacter for Royal, born 1 January 2019, intelligence 70, speed 30. (2)
(ii) Call Learn and output its name, age and intelligence with suitable messages. (3)
(iii) Run and retain output. (1)

## 3(c) MagicCharacter
(i) Declare child `MagicCharacter(Element, CharacterName, DateOfBirth, Intelligence, Speed)` with additional string Element, calling the parent constructor. (5)
(ii) Override Learn: fire or water increases intelligence by 20%; earth by 30%; all other elements by 10%. (3)

## 3(d)
(i) Create FirstMagic for Light, born 3 March 2018, intelligence 75, speed 22, element fire. (2)
(ii) Call Learn and output name, age and intelligence. (1)
(iii) Run and retain output. (1)

Use your chosen Python date representation consistently. The teacher reviews date representation and ReturnAge in source; automatic learning tests do not impose a particular date constructor.''',[
 stage('3(a)(i)','Character constructor',5),stage('3(a)(ii)','Get methods',3,'auto'),stage('3(a)(iii)','Set intelligence',2,'auto'),stage('3(a)(iv)','Learn 10 percent',1,'auto'),stage('3(a)(v)','Fixed 2023 age',2),stage('3(b)(i)','Royal object',2),stage('3(b)(ii)','Royal learning output',3),stage('3(b)(iii)','Evidence',1,'evidence'),stage('3(c)(i)','Magic constructor',5),stage('3(c)(ii)','Element learning',3,'auto'),stage('3(d)(i)','Light object',2),stage('3(d)(ii)','Light learning output',1),stage('3(d)(iii)','Evidence',1,'evidence')],'''
 from datetime import date
 class Character:
     # CharacterName: str; DateOfBirth: date; Intelligence: float; Speed: int
     def __init__(self,CharacterName,DateOfBirth,Intelligence,Speed):
         self.CharacterName=CharacterName;self.DateOfBirth=DateOfBirth;self.Intelligence=Intelligence;self.Speed=Speed
     def GetIntelligence(self):return self.Intelligence
     def GetName(self):return self.CharacterName
     def SetIntelligence(self,Value):self.Intelligence=Value
     def Learn(self):self.SetIntelligence(self.Intelligence*1.1)
     def ReturnAge(self):return 2023-self.DateOfBirth.year
 class MagicCharacter(Character):
     # Element: str
     def __init__(self,Element,CharacterName,DateOfBirth,Intelligence,Speed):
         super().__init__(CharacterName,DateOfBirth,Intelligence,Speed);self.Element=Element
     def Learn(self):
         if self.Element in ['fire','water']:increase=0.2
         elif self.Element=='earth':increase=0.3
         else:increase=0.1
         self.SetIntelligence(self.GetIntelligence()*(1+increase))
 def main():
     FirstCharacter=Character('Royal',date(2019,1,1),70,30);FirstCharacter.Learn()
     print(FirstCharacter.GetName(),'age',FirstCharacter.ReturnAge(),'intelligence',FirstCharacter.GetIntelligence())
     FirstMagic=MagicCharacter('fire','Light',date(2018,3,3),75,22);FirstMagic.Learn()
     print(FirstMagic.GetName(),'age',FirstMagic.ReturnAge(),'intelligence',FirstMagic.GetIntelligence())
 if __name__ == '__main__':main()
 ''',{
 '3_aii':[case('royal-getters',"c=candidate.Character('Royal',None,70,30)\nprint(c.GetName(),format(c.GetIntelligence(),'.4f'))",'Royal 70.0000\n'),case('different-getters',"c=candidate.Character('Z',None,12.5,1)\nprint(c.GetName(),format(c.GetIntelligence(),'.4f'))",'Z 12.5000\n',False)],
 '3_aiii':[case('set-intelligence',"c=candidate.Character('R',None,70,30);c.SetIntelligence(80)\nprint(c.GetIntelligence())",'80\n'),case('zero-set',"c=candidate.Character('R',None,70,30);c.SetIntelligence(0)\nprint(c.GetIntelligence())",'0\n',False)],
 '3_aiv':[case('royal-learn',"c=candidate.Character('Royal',None,70,30);c.Learn()\nprint(format(c.GetIntelligence(),'.4f'))",'77.0000\n'),case('repeat-learn',"c=candidate.Character('R',None,50,1);c.Learn();c.Learn()\nprint(format(c.GetIntelligence(),'.4f'))",'60.5000\n',False)],
 '3_cii':[case('fire-learn',"c=candidate.MagicCharacter('fire','Light',None,75,22);c.Learn()\nprint(format(c.GetIntelligence(),'.4f'))",'90.0000\n'),case('other-elements',"for e in ['water','earth','air']:\n    c=candidate.MagicCharacter(e,'L',None,100,1);c.Learn();print(format(c.GetIntelligence(),'.4f'))",'120.0000\n130.0000\n110.0000\n',False)]})
 return [q1,q2,q3]

BUILDERS={'s41':summer41,'s43':summer41,'s42':summer42,'w41':autumn41,'w43':autumn41,'w42':autumn42}
def build_all(directory):
 sources=json.loads((directory/'sources.json').read_text())
 for src in sources:
     manifest=assemble(src,BUILDERS[src['key'][5]+src['variant']](src))
     (directory/(src['key']+'.json')).write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
 if __name__=='__main__':print('Built',len(sources),'papers without executing candidate or reference programs.')
if __name__=='__main__':build_all(Path(__file__).resolve().parent)
