BinaryTree = [[-1, -1, -1] for i in range(100)]
TreeRootPointer = -1
FirstFreeNodePointer = 0

def AddNode(Data):
    global TreeRootPointer, FirstFreeNodePointer
    if FirstFreeNodePointer >= 100:
        print("The tree is full")
        return
    New = FirstFreeNodePointer
    BinaryTree[New] = [-1, Data, -1]
    FirstFreeNodePointer += 1
    if TreeRootPointer == -1:
        TreeRootPointer = New
        return
    Current = TreeRootPointer
    while True:
        Side = 0 if Data < BinaryTree[Current][1] else 2
        if BinaryTree[Current][Side] == -1:
            BinaryTree[Current][Side] = New
            return
        Current = BinaryTree[Current][Side]

def OutputArray():
    for Node in BinaryTree[:10]: print(*Node)

def InOrder(Root):
    if BinaryTree[Root][0] != -1: InOrder(BinaryTree[Root][0])
    print(BinaryTree[Root][1])
    if BinaryTree[Root][2] != -1: InOrder(BinaryTree[Root][2])

for i in range(10): AddNode(int(input("Enter positive integer: ")))
OutputArray()
InOrder(TreeRootPointer)
