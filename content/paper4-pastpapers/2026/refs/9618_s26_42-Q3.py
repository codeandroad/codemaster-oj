LinkedList = [[9512, 5], [5541, 3], [1999, 0], [6651, -1], [-1, 6], [5612, 1], [-1, -1], [-1, 4]]
StartLinkedList = 2
StartEmptyList = 7

def PrintListItems():
    Current = StartLinkedList
    while Current != -1:
        print(LinkedList[Current][0])
        Current = LinkedList[Current][1]

def PrintEmptyList():
    Current = StartEmptyList
    while Current != -1:
        print(Current)
        Current = LinkedList[Current][1]

def AddItem(Data):
    global StartLinkedList, StartEmptyList
    if StartEmptyList == -1:
        print("List is full")
        return
    New = StartEmptyList
    StartEmptyList = LinkedList[New][1]
    LinkedList[New] = [Data, -1]
    if StartLinkedList == -1:
        StartLinkedList = New
        return
    Current = StartLinkedList
    while LinkedList[Current][1] != -1: Current = LinkedList[Current][1]
    LinkedList[Current][1] = New

print("Linked list")
PrintListItems()
print("Empty list")
PrintEmptyList()
AddItem(8451)
print("Updated linked list")
PrintListItems()
print("Updated empty list")
PrintEmptyList()
