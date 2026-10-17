TreeArray = [[-1, -1, -1] for i in range(50)]
RootPointer = -1
FreeNode = 0

def AddNode(Data):
    global RootPointer, FreeNode
    if FreeNode >= 50:
        print("The tree is full")
        return
    New = FreeNode
    TreeArray[New] = [-1, Data, -1]
    FreeNode += 1
    if RootPointer == -1:
        RootPointer = New
        return
    Current = RootPointer
    while True:
        Column = 0 if Data < TreeArray[Current][1] else 2
        if TreeArray[Current][Column] == -1:
            TreeArray[Current][Column] = New
            return
        Current = TreeArray[Current][Column]

def WriteAllToFile():
    try:
        with open("Tree.txt", "w", encoding="utf-8") as f:
            for Node in TreeArray: f.write(",".join(str(value) for value in Node) + "\n")
    except OSError:
        print("Could not write file")

with open("TreeData.txt", encoding="utf-8") as SourceFile:
    for Line in SourceFile: AddNode(int(Line.strip()))
WriteAllToFile()
