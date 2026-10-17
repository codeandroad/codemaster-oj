class TheObject:
    def __init__(self, ObjectType, Amount):
        self.ObjectType = ObjectType  # string
        self.Amount = Amount  # integer

class Path:
    def __init__(self, NumberSpaces):
        self.NumberSpaces = NumberSpaces  # integer
        self.BoardArray = [TheObject("", -1) for i in range(100)]  # array of TheObject
    def GetNumberSpaces(self): return self.NumberSpaces
    def InitialiseData(self, Data):
        if len(Data) > self.NumberSpaces: return False
        for i in range(len(Data)): self.BoardArray[i] = Data[i]
        return True
    def ReturnPath(self):
        Values = []
        for Item in self.BoardArray:
            if Item.ObjectType != "": Values.append(Item.ObjectType + "-" + str(Item.Amount))
        return " ".join(Values)
    def GetPathObject(self, Index): return self.BoardArray[Index]

ArrayOfObjects = [TheObject("Money", 50), TheObject("Experience", 100), TheObject("Money", 200), TheObject("Money", 20), TheObject("Experience", 30)]
Path1 = Path(5)
Path1.InitialiseData(ArrayOfObjects)
print(Path1.ReturnPath())
