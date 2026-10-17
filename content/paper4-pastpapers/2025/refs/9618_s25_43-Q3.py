class Node:
    def __init__(self, TheData):
        self.TheData = TheData  # integer
        self.NextNode = None  # Node
    def GetData(self): return self.TheData
    def GetNextNode(self): return self.NextNode
    def SetNextNode(self, NextNode): self.NextNode = NextNode

class LinkedList:
    def __init__(self):
        self.HeadNode = None  # Node
    def InsertNode(self, Data):
        NewNode = Node(Data)
        NewNode.SetNextNode(self.HeadNode)
        self.HeadNode = NewNode
    def Traverse(self):
        Current = self.HeadNode
        Values = []
        while Current is not None:
            Values.append(str(Current.GetData()))
            Current = Current.GetNextNode()
        return " ".join(Values)
    def RemoveNode(self, Data):
        if self.HeadNode is None: return False
        if self.HeadNode.GetData() == Data:
            self.HeadNode = self.HeadNode.GetNextNode()
            return True
        Current = self.HeadNode
        while Current.GetNextNode() is not None:
            if Current.GetNextNode().GetData() == Data:
                Current.SetNextNode(Current.GetNextNode().GetNextNode())
                return True
            Current = Current.GetNextNode()
        return False

MyList = LinkedList()
for value in [10, 20, 30, 40, 50]: MyList.InsertNode(value)
print(MyList.Traverse())
MyList.RemoveNode(30)
print(MyList.Traverse())
