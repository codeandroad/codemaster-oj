import random

def PrintArray(DataArray): print(" ".join(str(value) for value in DataArray))

def BubbleSort(DataArray):
    for Last in range(len(DataArray) - 1, 0, -1):
        Changed = False
        for i in range(Last):
            if DataArray[i] > DataArray[i + 1]:
                DataArray[i], DataArray[i + 1] = DataArray[i + 1], DataArray[i]
                Changed = True
        if not Changed: break
    return DataArray

def RecursiveBinarySearch(DataArray, Lower, Upper, Value):
    if Lower > Upper: return -1
    Middle = (Lower + Upper) // 2
    if DataArray[Middle] == Value: return Middle
    if DataArray[Middle] > Value: return RecursiveBinarySearch(DataArray, Lower, Middle - 1, Value)
    return RecursiveBinarySearch(DataArray, Middle + 1, Upper, Value)

def main():
    DataArray = []
    while len(DataArray) < 20:
        Value = random.randint(0, 100)
        if Value not in DataArray: DataArray.append(Value)
    PrintArray(DataArray)
    DataArray = BubbleSort(DataArray)
    print("Sorted")
    PrintArray(DataArray)
    Value = int(input("Enter integer: "))
    Index = RecursiveBinarySearch(DataArray, 0, len(DataArray) - 1, Value)
    if Index == -1: print("Not found")
    else: print("Found at position", Index)
main()
