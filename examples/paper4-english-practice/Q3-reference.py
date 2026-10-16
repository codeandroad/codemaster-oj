"""Teacher reference for the binary-tree task in 9618/41/M/J/25 Q3."""


class Node:
    def __init__(self, pNodeData):
        self.NodeData = pNodeData  # integer
        self.LeftNode = None  # Node or None
        self.RightNode = None  # Node or None

    def GetLeft(self):
        return self.LeftNode

    def GetRight(self):
        return self.RightNode

    def GetData(self):
        return self.NodeData

    def SetLeft(self, NewNode):
        self.LeftNode = NewNode

    def SetRight(self, NewNode):
        self.RightNode = NewNode


class Tree:
    def __init__(self, FirstNode):
        self.FirstNode = FirstNode  # Node

    def GetRootNode(self):
        return self.FirstNode

    def Insert(self, NewNode):
        CurrentNode = self.FirstNode
        while True:
            if NewNode.GetData() < CurrentNode.GetData():
                if CurrentNode.GetLeft() is None:
                    CurrentNode.SetLeft(NewNode)
                    return
                CurrentNode = CurrentNode.GetLeft()
            else:
                if CurrentNode.GetRight() is None:
                    CurrentNode.SetRight(NewNode)
                    return
                CurrentNode = CurrentNode.GetRight()


def OutputInOrder(RootNode):
    if RootNode.GetLeft() is not None:
        OutputInOrder(RootNode.GetLeft())
    print(RootNode.GetData())
    if RootNode.GetRight() is not None:
        OutputInOrder(RootNode.GetRight())


# The paper asks for a main program, without requiring a particular guard.
FirstNode = Node(10)
SecondNode = Node(20)
ThirdNode = Node(5)
FourthNode = Node(15)
FifthNode = Node(7)
MyTree = Tree(FirstNode)
MyTree.Insert(SecondNode)
MyTree.Insert(ThirdNode)
MyTree.Insert(FourthNode)
MyTree.Insert(FifthNode)
OutputInOrder(MyTree.GetRootNode())
