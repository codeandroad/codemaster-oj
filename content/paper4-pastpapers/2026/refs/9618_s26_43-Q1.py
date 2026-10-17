DataArray = [""] * 15

def CreateArray():
    for i in range(15): DataArray[i] = input("Enter string: ").lower()

def OutputArray(): print(" ".join(DataArray))

def FindWords():
    Word = input("Word to find: ").lower()
    Count = 0
    for Item in DataArray:
        if Item == Word: Count += 1
    print("Number of matches:", Count)

def SortLength():
    Last = len(DataArray) - 1
    Changed = True
    while Changed and Last > 0:
        Changed = False
        for i in range(Last):
            if len(DataArray[i]) > len(DataArray[i + 1]):
                DataArray[i], DataArray[i + 1] = DataArray[i + 1], DataArray[i]
                Changed = True
        Last -= 1

CreateArray()
OutputArray()
FindWords()
SortLength()
OutputArray()
