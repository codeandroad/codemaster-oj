class BoardObject:
    def __init__(self, Code, Value):
        self.Code = Code  # string
        self.Value = Value  # integer
    def GetCode(self): return self.Code
    def GetValue(self): return self.Value

class Board:
    def __init__(self):
        self.TheBoard = [[BoardObject("-", 0) for column in range(10)] for row in range(10)]  # array of BoardObject
    def GetObject(self, Row, Column): return self.TheBoard[Row][Column]
    def SetObject(self, Object, Row, Column): self.TheBoard[Row][Column] = Object
    def DisplayBoard(self):
        for Row in self.TheBoard: print(" ".join(Object.GetCode() for Object in Row))

Object1 = BoardObject("A", 2)
Object2 = BoardObject("B", 3)
Object3 = BoardObject("C", 5)
Object4 = BoardObject("D", 2)
Object5 = BoardObject("E", 7)
MyBoard = Board()
for Object, Row, Column in [(Object1, 0, 0), (Object2, 9, 9), (Object3, 4, 5), (Object4, 2, 2), (Object5, 8, 7)]:
    MyBoard.SetObject(Object, Row, Column)
MyBoard.DisplayBoard()
while True:
    try:
        Row = int(input("Enter row 0 to 9: "))
        if 0 <= Row <= 9: break
    except ValueError:
        pass
while True:
    try:
        Column = int(input("Enter column 0 to 9: "))
        if 0 <= Column <= 9: break
    except ValueError:
        pass
Object = MyBoard.GetObject(Row, Column)
if Object.GetCode() == "-": print("Miss")
else: print("Object code:", Object.GetCode(), "Value:", Object.GetValue())
