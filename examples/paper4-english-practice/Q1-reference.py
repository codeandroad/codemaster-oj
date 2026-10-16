"""Reference for Question 1 of the original English practice package."""

Queue = [-1] * 20
HeadPointer = -1
TailPointer = -1
NumberItems = 0


def Enqueue(InputData):
    global HeadPointer, TailPointer, NumberItems
    if NumberItems == 20:
        return False
    TailPointer = (TailPointer + 1) % 20
    Queue[TailPointer] = InputData
    if NumberItems == 0:
        HeadPointer = TailPointer
    NumberItems += 1
    return True


def Dequeue():
    global HeadPointer, TailPointer, NumberItems
    if NumberItems == 0:
        return -1
    value = Queue[HeadPointer]
    NumberItems -= 1
    if NumberItems == 0:
        HeadPointer = -1
        TailPointer = -1
    else:
        HeadPointer = (HeadPointer + 1) % 20
    return value


def main():
    for number in range(1, 26):
        result = Enqueue(number)
        print(f'{number} {"Successful" if result else "Unsuccessful"}')
    print(Dequeue())
    print(Dequeue())


if __name__ == '__main__':
    main()
