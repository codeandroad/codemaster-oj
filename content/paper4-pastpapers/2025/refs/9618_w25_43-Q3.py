def RecursiveCount(ArrayCopy, NumberElements, DataToFind):
    if NumberElements == 0: return 0
    Count = 1 if ArrayCopy[0] == DataToFind else 0
    return Count + RecursiveCount(ArrayCopy[1:], NumberElements - 1, DataToFind)

def SplitData(Data):
    Lines = []
    Line = ""
    for Character in Data:
        if Character == ";":
            Lines.append(Line)
            Line = ""
        else: Line += Character
    return Lines

def main():
    DataArray = [0, 5, 1, 2, 5, 9, 9, 6, 5, 0]
    print(RecursiveCount(DataArray, 10, 0))
    DataString = "x=0;y=1;x=x+y;y++;"
    for Line in SplitData(DataString): print(Line)
main()
