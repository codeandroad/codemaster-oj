class NewRecord:
    def __init__(self, Key=-1, Item1=-1, Item2=-1):
        self.Key = Key  # integer
        self.Item1 = Item1  # integer
        self.Item2 = Item2  # integer

HashTable = [None] * 200
Spare = [None] * 100

def Initialise():
    for i in range(200): HashTable[i] = NewRecord()
    for i in range(100): Spare[i] = NewRecord()

def CalculateHash(Key):
    return Key % 200

def InsertIntoHash(TheRecord):
    Index = CalculateHash(TheRecord.Key)
    if HashTable[Index].Key == -1:
        HashTable[Index] = TheRecord
    else:
        for i in range(100):
            if Spare[i].Key == -1:
                Spare[i] = TheRecord
                return

def CreateHashTable():
    with open("HashData.txt", encoding="utf-8") as f:
        for line in f:
            Key, Item1, Item2 = [int(value) for value in line.strip().split(",")]
            InsertIntoHash(NewRecord(Key, Item1, Item2))

def PrintSpare():
    for record in Spare:
        if record.Key != -1: print(record.Key)

Initialise()
CreateHashTable()
PrintSpare()
