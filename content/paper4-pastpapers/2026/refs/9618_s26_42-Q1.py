def FindLongestShortest(Data):
    Shortest = Data[0]
    Longest = Data[0]
    for Value in Data:
        if len(Value) < len(Shortest): Shortest = Value
        if len(Value) > len(Longest): Longest = Value
    print("Longest string:", Longest)
    print("Shortest string:", Shortest)

def InsertionSort(Data):
    for i in range(1, len(Data)):
        Value = Data[i]
        j = i - 1
        while j >= 0 and Data[j] > Value:
            Data[j + 1] = Data[j]
            j -= 1
        Data[j + 1] = Value
    return Data

def main():
    TheData = ["laptop", "tablet", "printer", "computer", "processor", "monitor", "memory", "cable", "touchscreen"]
    FindLongestShortest(TheData)
    print("Before sorting")
    print(" ".join(TheData))
    TheData = InsertionSort(TheData)
    print("After sorting")
    print(" ".join(TheData))
main()
