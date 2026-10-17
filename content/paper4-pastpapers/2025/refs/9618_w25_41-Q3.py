class Record:
    def __init__(self, Key, Data):
        self.Key = Key
        self.Data = Data

HashTable = [[None for column in range(10)] for row in range(100)]

def InitialiseHashTable():
    for row in range(100):
        for column in range(10): HashTable[row][column] = None

def Hash(Key): return Key % 100

def InsertData(TheRecord):
    Index = Hash(TheRecord.Key)
    for Column in range(10):
        if HashTable[Index][Column] is None:
            HashTable[Index][Column] = TheRecord
            return

def ReadData():
    with open("HashTableData.txt", encoding="utf-8") as f:
        for line in f:
            Key, Data = line.rstrip("\r\n").split(",")
            InsertData(Record(int(Key), Data))

def GetRecord(Key):
    Index = Hash(Key)
    for Item in HashTable[Index]:
        if Item is not None and Item.Key == Key: return Item.Data
    return "Not found"

InitialiseHashTable()
ReadData()
for i in range(5): print(GetRecord(int(input("Enter key: "))))
