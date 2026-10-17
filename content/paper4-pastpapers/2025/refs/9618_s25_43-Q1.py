Queue = [-1] * 50
HeadPointer = -1
TailPointer = -1

def Enqueue(Data):
    global HeadPointer, TailPointer
    if TailPointer == 49: return False
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

def CreateQueue():
    try:
        with open("QueueData.txt", encoding="utf-8") as f:
            for line in f:
                if not Enqueue(int(line.strip())): print("Queue full")
    except OSError:
        print("Could not read file")

CreateQueue()
Total = 0
Data = Dequeue()
while Data != -1:
    Total += Data
    Data = Dequeue()
print(Total)
