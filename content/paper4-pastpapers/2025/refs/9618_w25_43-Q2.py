Queue = [""] * 100
QueueHead = -1
QueueTail = -1
NumberItems = 0
NewString = ""

def Enqueue(Data):
    global QueueHead, QueueTail, NumberItems
    if QueueTail == 99: return False
    QueueTail += 1
    Queue[QueueTail] = Data
    if NumberItems == 0: QueueHead = QueueTail
    NumberItems += 1
    return True

def Dequeue():
    global QueueHead, NumberItems
    if NumberItems == 0: return "False"
    Data = Queue[QueueHead]
    QueueHead += 1
    NumberItems -= 1
    return Data

def ReadData():
    with open("BinaryData.txt", encoding="utf-8") as f:
        for line in f: Enqueue(line.rstrip("\r\n"))

def Compress():
    global NewString
    Previous = Dequeue()
    Count = 1
    NewString = ""
    while NumberItems > 0:
        Current = Dequeue()
        if Current == Previous: Count += 1
        else:
            NewString += Previous + str(Count)
            Previous = Current
            Count = 1
    NewString += Previous + str(Count)

ReadData()
Compress()
print(NewString)
