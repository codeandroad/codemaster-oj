def InsertionSort(DataArray):
    for i in range(1, len(DataArray)):
        Data = DataArray[i]
        j = i - 1
        while j >= 0 and DataArray[j] > Data:
            DataArray[j + 1] = DataArray[j]
            j -= 1
        DataArray[j + 1] = Data
    return DataArray

def OutputArray(DataArray):
    print(" ".join(str(value) for value in DataArray))

def Search(DataArray, ItemToFind):
    Lower = 0
    Upper = len(DataArray) - 1
    while Lower <= Upper:
        Middle = (Lower + Upper) // 2
        if DataArray[Middle] == ItemToFind: return Middle
        if DataArray[Middle] < ItemToFind: Lower = Middle + 1
        else: Upper = Middle - 1
    return -1

def main():
    DataArray = [0, 3, 4, 56, 67, 44, 43, 32, 31, 345, 45, 6, 54, 1]
    OutputArray(DataArray)
    DataArray = InsertionSort(DataArray)
    OutputArray(DataArray)
    for value in [0, 345, 67, 2]:
        Index = Search(DataArray, value)
        if Index == -1: print("Not found")
        else: print("Found at position", Index)
main()
