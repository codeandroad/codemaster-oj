Queue = [-1] * 10
HeadPointer = -1
TailPointer = -1

def Enqueue(Data):
    global HeadPointer, TailPointer
    if TailPointer == 9: return False
    TailPointer += 1
    Queue[TailPointer] = Data
    if HeadPointer == -1: HeadPointer = 0
    return True

def Dequeue():
    global HeadPointer
    if HeadPointer == -1 or HeadPointer > TailPointer: return -1
    Data = Queue[HeadPointer]
    HeadPointer += 1
    return Data

# Final main program, amended by part (e). Part (c)'s earlier 11-input run is evidence.
for i in range(6):
    Value = int(input("Enter integer: "))
    if not Enqueue(Value): print("Queue is full")
for i in range(4): print(Dequeue())
