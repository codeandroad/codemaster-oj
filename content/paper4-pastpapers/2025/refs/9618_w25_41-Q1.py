import random
Stack = [None] * 30
TopOfStack = -1

def Push(Data):
    global TopOfStack
    if TopOfStack == 29: return False
    TopOfStack += 1
    Stack[TopOfStack] = Data
    return True

def Pop():
    global TopOfStack
    if TopOfStack == -1: return -999
    Data = Stack[TopOfStack]
    TopOfStack -= 1
    return Data

def FindValues():
    Value = Pop()
    if Value == -999: return
    Largest = Value
    Smallest = Value
    Value = Pop()
    while Value != -999:
        if Value > Largest: Largest = Value
        if Value < Smallest: Smallest = Value
        Value = Pop()
    print("Largest number:", Largest)
    print("Smallest number:", Smallest)

for i in range(40):
    Value = random.randint(0, 1000)
    if not Push(Value):
        print("Stack full")
        break
FindValues()
