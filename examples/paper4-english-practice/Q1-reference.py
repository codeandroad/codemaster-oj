"""Original classroom sample: a fixed-capacity positive-integer circular queue."""

Capacity = 20
Queue = [-1] * Capacity
HeadPointer = -1
TailPointer = -1
NumberItems = 0


def Enqueue(value):
    global HeadPointer, TailPointer, NumberItems
    if not isinstance(value, int) or value <= 0 or NumberItems == Capacity:
        return False
    TailPointer = (TailPointer + 1) % Capacity
    Queue[TailPointer] = value
    if NumberItems == 0:
        HeadPointer = TailPointer
    NumberItems += 1
    return True


def Dequeue():
    global HeadPointer, TailPointer, NumberItems
    if NumberItems == 0:
        return -1
    value = Queue[HeadPointer]
    Queue[HeadPointer] = -1
    NumberItems -= 1
    if NumberItems == 0:
        HeadPointer = -1
        TailPointer = -1
    else:
        HeadPointer = (HeadPointer + 1) % Capacity
    return value


if __name__ == '__main__':
    accepted = sum(Enqueue(number) for number in range(1, 26))
    first, second = Dequeue(), Dequeue()
    print(f'Accepted: {accepted}')
    print(f'Rejected: {25 - accepted}')
    print(f'Removed: {first}, {second}')
